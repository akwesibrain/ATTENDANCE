-- Live tracking for Supervisors, Sales Representatives and Merchandisers,
-- only between clock-in and clock-out. The detailed trail is deleted after
-- each day; only a summary without coordinates is kept.

create table public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  date date not null,
  clock_in_at timestamptz not null,
  closes_at timestamptz not null,          -- working day end + clock-out window
  clock_out_at timestamptz,
  token_hash text not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_reason text check (closed_reason in ('clock-out', 'face-lockout', 'day-end')),
  closed_at timestamptz,
  unique (staff_id, date)
);
create index tracking_sessions_company_date_idx on public.tracking_sessions (company_id, date);

create table public.location_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.tracking_sessions (id) on delete cascade,
  staff_id text not null,
  company_id text not null,
  date date not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  is_mock boolean not null default false,
  flagged text check (flagged in ('mock', 'speed'))
);
create index location_points_staff_time_idx on public.location_points (staff_id, recorded_at);
create index location_points_session_idx on public.location_points (session_id, recorded_at);
create index location_points_date_idx on public.location_points (date);

create table public.tracking_latest (
  staff_id text primary key references public.employees (staff_id),
  company_id text not null,
  date date not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy real,
  recorded_at timestamptz not null,
  session_status text not null check (session_status in ('open', 'closed')),
  updated_at timestamptz not null default now()
);

create table public.tracking_day_summaries (
  staff_id text not null references public.employees (staff_id),
  company_id text not null,
  date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  tracked_minutes integer not null,
  points integer not null,
  first_at timestamptz,
  last_at timestamptz,
  covered_minutes integer not null,
  coverage real,
  signal_lost integer not null,
  longest_gap_minutes integer not null,
  distance_m integer not null,
  shop_stays jsonb not null default '{}'::jsonb,   -- { shopId: { minutes, longestMinutes, closestM } }; no coordinates
  mock_points integer not null default 0,
  speed_points integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (staff_id, date)
);
create index tracking_day_summaries_company_date_idx on public.tracking_day_summaries (company_id, date);

create table public.tracking_flags (
  staff_id text not null references public.employees (staff_id),
  company_id text not null,
  date date not null,
  kind text not null check (kind in ('mock', 'speed')),
  points integer not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  primary key (staff_id, date, kind)
);

-- HR reads its own companies' rows; only the Edge Function writes.
do $$
declare
  t text;
begin
  foreach t in array array['tracking_sessions', 'location_points', 'tracking_latest', 'tracking_day_summaries', 'tracking_flags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy hr_read on public.%I for select to authenticated
         using (company_id = any ((select app_private.hr_company_ids())::text[]))', t);
  end loop;
end;
$$;

grant select on public.location_points, public.tracking_latest, public.tracking_day_summaries, public.tracking_flags to authenticated;
-- Every column except the token hash.
grant select (id, staff_id, company_id, date, clock_in_at, closes_at, clock_out_at, status, closed_reason, closed_at)
  on public.tracking_sessions to authenticated;

-- The live map updates without polling.
alter publication supabase_realtime add table public.tracking_latest;

-- Clock-out or a face lockout ends tracking, whichever route wrote the event.
create function app_private.close_tracking_session() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type not in ('check-out', 'face-lockout') then
    return new;
  end if;
  update public.tracking_sessions
     set status = 'closed',
         closed_reason = case when new.type = 'check-out' then 'clock-out' else 'face-lockout' end,
         clock_out_at = coalesce(clock_out_at, new.occurred_at),
         closed_at = now()
   where staff_id = new.employee_id and date = new.date and status = 'open';
  update public.tracking_latest
     set session_status = 'closed', updated_at = now()
   where staff_id = new.employee_id and date = new.date;
  return new;
end;
$$;

create trigger close_tracking_session
  after insert on public.attendance_events
  for each row execute function app_private.close_tracking_session();

-- Stores one batch atomically. Points after clock-out never get in, even if
-- the clock-out committed while the batch was being checked.
create function public.record_points(p_session uuid, p_points jsonb, p_flags jsonb, p_latest jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tracking_sessions;
  v_stored integer;
begin
  select * into v_session from public.tracking_sessions where id = p_session for update;
  if not found or (v_session.status = 'closed' and v_session.clock_out_at is null) then
    return 0;
  end if;

  insert into public.location_points (session_id, staff_id, company_id, date, latitude, longitude, accuracy, recorded_at, is_mock, flagged)
  select v_session.id, v_session.staff_id, v_session.company_id, v_session.date,
         p.latitude, p.longitude, p.accuracy, p.recorded_at, coalesce(p.is_mock, false), p.flagged
    from jsonb_to_recordset(coalesce(p_points, '[]'::jsonb))
         as p(latitude double precision, longitude double precision, accuracy real, recorded_at timestamptz, is_mock boolean, flagged text)
   where p.recorded_at >= v_session.clock_in_at
     and (v_session.clock_out_at is null or p.recorded_at <= v_session.clock_out_at);
  get diagnostics v_stored = row_count;

  insert into public.tracking_flags (staff_id, company_id, date, kind, points, first_at, last_at)
  select v_session.staff_id, v_session.company_id, v_session.date, f.kind, f.points, f.first_at, f.last_at
    from jsonb_to_recordset(coalesce(p_flags, '[]'::jsonb)) as f(kind text, points integer, first_at timestamptz, last_at timestamptz)
   where f.points > 0
  on conflict (staff_id, date, kind) do update
     set points = public.tracking_flags.points + excluded.points,
         first_at = least(public.tracking_flags.first_at, excluded.first_at),
         last_at = greatest(public.tracking_flags.last_at, excluded.last_at);

  if p_latest is not null and v_stored > 0 then
    insert into public.tracking_latest (staff_id, company_id, date, latitude, longitude, accuracy, recorded_at, session_status, updated_at)
    select v_session.staff_id, v_session.company_id, v_session.date,
           (p_latest ->> 'latitude')::double precision, (p_latest ->> 'longitude')::double precision,
           (p_latest ->> 'accuracy')::real, (p_latest ->> 'recorded_at')::timestamptz, v_session.status, now()
     where (p_latest ->> 'recorded_at')::timestamptz >= v_session.clock_in_at
       and (v_session.clock_out_at is null or (p_latest ->> 'recorded_at')::timestamptz <= v_session.clock_out_at)
    on conflict (staff_id) do update
       set company_id = excluded.company_id, date = excluded.date,
           latitude = excluded.latitude, longitude = excluded.longitude, accuracy = excluded.accuracy,
           recorded_at = excluded.recorded_at, session_status = excluded.session_status, updated_at = now()
     where public.tracking_latest.date < excluded.date or public.tracking_latest.recorded_at <= excluded.recorded_at;
  end if;

  return v_stored;
end;
$$;

revoke all on function public.record_points(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_points(uuid, jsonb, jsonb, jsonb) to service_role;

-- Nightly: summarise each day's trail, then delete it (needs the jobs secret).
select cron.schedule('tracking-close-day', '20 0 * * *', $$select app_private.call_job('tracking-close-day')$$);
-- Safety net with no secret: no trail outlives 48 hours, whatever else ran.
select cron.schedule('tracking-sweep', '15 3 * * *', $$
  delete from public.location_points where received_at < now() - interval '48 hours';
  delete from public.tracking_latest where date < (now() at time zone 'Africa/Accra')::date - 1;
$$);

-- apply_change can now write the tracking tables (summaries, closing sessions,
-- deleting a summarised day's points).
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
    'tracking_sessions', 'location_points', 'tracking_latest', 'tracking_day_summaries', 'tracking_flags'
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
