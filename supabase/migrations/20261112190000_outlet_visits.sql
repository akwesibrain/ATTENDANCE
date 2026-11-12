-- Outlet visits: a Sales Representative or Supervisor records each visit on
-- the phone they clocked in with, with a face scan. A visit keeps how far the
-- phone was from the shop, never the phone's coordinates, and no photo.

create table public.outlet_visits (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  session_id uuid references public.tracking_sessions (id) on delete set null,
  date date not null,
  occurred_at timestamptz not null default now(),
  shop_id text references public.shops (shop_id),
  outlet_name text,
  outlet_town text,
  on_list boolean not null,
  status text not null check (status in ('recorded', 'location-unavailable')),
  distance_m integer,
  gps_accuracy real,
  face_score real,
  check ((shop_id is not null) <> (outlet_name is not null))
);
create index outlet_visits_company_date_idx on public.outlet_visits (company_id, date);
create index outlet_visits_staff_date_idx on public.outlet_visits (staff_id, date);

-- Failed visit face scans. Separate from the kiosk's counter, so a visit lock
-- never stops anyone clocking out. No client can read it.
create table public.visit_face_attempts (
  staff_id text not null references public.employees (staff_id),
  date date not null,
  failed integer not null default 0,
  primary key (staff_id, date)
);

do $$
declare
  t text;
begin
  foreach t in array array['outlet_visits', 'visit_face_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

grant select on public.outlet_visits to authenticated;
create policy hr_read on public.outlet_visits for select to authenticated
  using (company_id = any ((select app_private.hr_company_ids())::text[]));

create function public.record_visit_face_failure(p_staff text, p_date date) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed integer;
begin
  insert into public.visit_face_attempts (staff_id, date, failed) values (p_staff, p_date, 1)
  on conflict (staff_id, date) do update set failed = public.visit_face_attempts.failed + 1
  returning failed into v_failed;
  return v_failed;
end;
$$;

-- Stores a visit only while the session is open, checked under a lock, so a
-- visit can never land after clock-out. Server time decides.
create function public.record_visit(p_session uuid, p_visit jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tracking_sessions;
  v_row public.outlet_visits;
begin
  select * into v_session from public.tracking_sessions where id = p_session for update;
  if not found or v_session.status <> 'open' or now() >= v_session.closes_at then
    return null;
  end if;
  insert into public.outlet_visits (staff_id, company_id, session_id, date, occurred_at, shop_id, outlet_name, outlet_town, on_list, status, distance_m, gps_accuracy, face_score)
  values (
    v_session.staff_id, v_session.company_id, v_session.id, v_session.date, now(),
    p_visit ->> 'shop_id', p_visit ->> 'outlet_name', p_visit ->> 'outlet_town',
    coalesce((p_visit ->> 'on_list')::boolean, false), p_visit ->> 'status',
    (p_visit ->> 'distance_m')::integer, (p_visit ->> 'gps_accuracy')::real, (p_visit ->> 'face_score')::real
  )
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.record_visit_face_failure(text, date) from public, anon, authenticated;
grant execute on function public.record_visit_face_failure(text, date) to service_role;
revoke all on function public.record_visit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_visit(uuid, jsonb) to service_role;

-- apply_change can write outlet_visits.
create or replace function public.apply_change(p_ops jsonb, p_audit jsonb default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  writable constant text[] := array[
    'employees', 'shops', 'shop_assignments', 'attendance_corrections',
    'attendance_correction_history', 'monitoring_alert_reviews', 'holidays',
    'settings_general', 'settings_company', 'settings_versions',
    'notifications', 'notification_history', 'verification_events',
    'verification_schedule', 'verification_tokens', 'geocode_cache',
    'workplace_displays', 'display_secrets', 'hr_invites', 'setup_links', 'hr_users',
    'employee_shops', 'employee_shop_changes',
    'tracking_sessions', 'location_points', 'tracking_latest', 'tracking_day_summaries', 'tracking_flags',
    'outlet_visits'
  ];
  deletable constant text[] := array['holidays', 'display_secrets', 'employee_shops',
    'location_points', 'tracking_latest', 'tracking_sessions'];
  op jsonb;
  tbl text;
  kind text;
  row_data jsonb;
  match_data jsonb;
  conflict_cols text[];
  cols text;
  updates text;
  conditions text;
  entry jsonb;
begin
  for op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    tbl := op ->> 'table';
    kind := op ->> 'op';
    row_data := op -> 'row';
    match_data := op -> 'match';

    if tbl is null or not (tbl = any (writable)) then
      raise exception 'Table % cannot be written', coalesce(tbl, '(none)');
    end if;

    if kind in ('insert', 'upsert') then
      select string_agg(format('%I', k), ', ') into cols
      from jsonb_object_keys(row_data) as k;
      if kind = 'insert' then
        execute format(
          'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
          tbl, cols
        ) using row_data;
      else
        conflict_cols := array(select jsonb_array_elements_text(op -> 'conflict'));
        if coalesce(cardinality(conflict_cols), 0) = 0 then
          raise exception 'Upsert on % needs conflict columns', tbl;
        end if;
        select string_agg(format('%1$I = excluded.%1$I', k), ', ') into updates
        from jsonb_object_keys(row_data) as k
        where not (k = any (conflict_cols));
        execute format(
          'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
           on conflict (%3$s) %4$s',
          tbl,
          cols,
          (select string_agg(format('%I', c), ', ') from unnest(conflict_cols) as c),
          case when updates is null then 'do nothing' else 'do update set ' || updates end
        ) using row_data;
      end if;

    elsif kind in ('update', 'delete') then
      if match_data is null or match_data = '{}'::jsonb then
        raise exception '% on % needs a match', kind, tbl;
      end if;
      select string_agg(format('t.%1$I = m.%1$I', k), ' and ') into conditions
      from jsonb_object_keys(match_data) as k;

      if kind = 'update' then
        select string_agg(format('%1$I = r.%1$I', k), ', ') into updates
        from jsonb_object_keys(row_data) as k;
        execute format(
          'update public.%1$I t set %2$s
             from jsonb_populate_record(null::public.%1$I, $1) r,
                  jsonb_populate_record(null::public.%1$I, $2) m
            where %3$s',
          tbl, updates, conditions
        ) using row_data, match_data;
      else
        if not (tbl = any (deletable)) then
          raise exception 'Rows in % cannot be deleted', tbl;
        end if;
        execute format(
          'delete from public.%1$I t
            using jsonb_populate_record(null::public.%1$I, $1) m
            where %2$s',
          tbl, conditions
        ) using match_data;
      end if;

    else
      raise exception 'Unknown operation %', coalesce(kind, '(none)');
    end if;
  end loop;

  if jsonb_typeof(p_audit) = 'array' then
    for entry in select value from jsonb_array_elements(p_audit) loop
      perform app_private.write_audit(entry);
    end loop;
  else
    perform app_private.write_audit(p_audit);
  end if;
end;
$$;

revoke all on function public.apply_change(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_change(jsonb, jsonb) to service_role;
