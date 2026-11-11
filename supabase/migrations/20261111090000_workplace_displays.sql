-- Workplace QR displays.
--
-- A tablet at a workplace shows a QR code that changes every 30 seconds,
-- signed with a secret only that tablet and the server hold. Scanning it opens
-- the check-in page with proof the phone is at that workplace. Each company can
-- require the scan for office staff; field staff keep their SMS and GPS checks.

create table public.workplace_displays (
  id text primary key,
  company_id text not null references public.companies (id),
  name text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- A one-time link that turns a device into this display.
  setup_token_hash text unique,
  setup_expires_at timestamptz,
  paired_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null
);

create index workplace_displays_company_idx on public.workplace_displays (company_id);

-- Service role only. No RLS policy on purpose.
create table public.display_secrets (
  display_id text primary key references public.workplace_displays (id),
  secret text not null,
  created_at timestamptz not null default now()
);

alter table public.attendance_events add column display_id text references public.workplace_displays (id);
alter table public.settings_company add column require_workplace_code boolean not null default false;

do $$
declare
  t text;
begin
  foreach t in array array['workplace_displays', 'display_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

grant select on public.workplace_displays to authenticated;
create policy hr_read on public.workplace_displays for select to authenticated
  using (company_id = any ((select app_private.hr_company_ids())::text[]));

drop function public.record_attendance_event(text, text, text, real, text, boolean, numeric);

create function public.record_attendance_event(
  p_staff_id text,
  p_type text,
  p_status text,
  p_score real,
  p_photo_path text,
  p_weekend boolean,
  p_overtime_hours numeric default null,
  p_display_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_employee public.employees;
  v_event public.attendance_events;
begin
  if p_type not in ('check-in', 'check-out') then
    raise exception 'Unknown attendance action' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees where staff_id = p_staff_id;
  if not found then
    raise exception 'Staff ID not found. Please register first.' using errcode = 'P0001';
  end if;

  insert into public.attendance_events (
    employee_id, company_id, company_name, full_name, type, status, date,
    weekend, overtime_hours, source, verification_score, photo_path, display_id
  ) values (
    v_employee.staff_id, v_employee.company_id, v_employee.company_name, v_employee.full_name,
    p_type, p_status, (now() at time zone 'Africa/Accra')::date,
    p_weekend, p_overtime_hours, 'face', p_score, p_photo_path, p_display_id
  )
  returning * into v_event;

  return to_jsonb(v_event);
exception
  when unique_violation then
    raise exception '%', case p_type
      when 'check-in' then 'You are already checked in for today.'
      else 'You have already checked out for today.'
    end using errcode = 'P0001';
end;
$fn$;

revoke all on function public.record_attendance_event(text, text, text, real, text, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.record_attendance_event(text, text, text, real, text, boolean, numeric, text) to service_role;

-- The same function as before, now also allowed to write the display tables.
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
    'workplace_displays', 'display_secrets'
  ];
  deletable constant text[] := array['holidays', 'display_secrets'];
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
