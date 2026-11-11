-- Workforce Pro core schema.
--
-- Security model:
--   * Browsers never write. anon and authenticated have no write grants; every
--     change goes through the `api` Edge Function using the service role.
--   * HR reads under RLS, limited to their companies, and only with MFA (aal2).
--   * anon has no table access at all.
--   * Tables with no RLS policy (face templates, the SMS schedule, tokens,
--     rate limits) can only be reached by the service role.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

/* ------------------------------------------------------------------ Companies */

create table public.companies (
  id text primary key,
  name text not null,
  staff_id_prefix text not null unique
);

create table public.company_counters (
  company_id text primary key references public.companies (id),
  last_number integer not null default 0 check (last_number >= 0)
);

/* ------------------------------------------------------------------ HR users */

create table public.hr_users (
  id uuid primary key references auth.users (id) on delete restrict,
  name text not null,
  email text not null unique,
  role_id text not null default 'hr-manager',
  company_ids text[] not null,
  grants jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

/* ------------------------------------------------------------------ Shops */

create table public.shops (
  shop_id text primary key,
  company_id text not null references public.companies (id),
  shop_name text not null,
  town text not null default '',
  area text not null default '',
  address text not null default '',
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location_source text check (location_source in ('geocoded', 'map-adjusted', 'manual')),
  location_label text,
  location_confirmed_by text,
  location_confirmed_at timestamptz,
  geofence_radius integer not null default 150 check (geofence_radius > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  source text not null default 'HR',
  created_by text,
  created_at timestamptz not null default now(),
  -- Coordinates are all-or-nothing and must say where they came from.
  constraint shops_location_complete check (
    (latitude is null and longitude is null and location_source is null)
    or (latitude is not null and longitude is not null and location_source is not null)
  )
);

create unique index shops_unique_outlet
  on public.shops (company_id, lower(shop_name), lower(town), lower(area));

/* ------------------------------------------------------------------ Employees */

create table public.employees (
  staff_id text primary key,
  company_id text not null references public.companies (id),
  company_name text not null,
  full_name text not null,
  position text not null,
  payment_method text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  emergency_contact_name text not null default '',
  emergency_contact_phone text not null default '',
  assigned_shop_id text references public.shops (shop_id),
  face_photo_path text,
  biometric_consent_at timestamptz,
  joined_on date,
  registered_at timestamptz not null default now(),
  status text not null default 'ACTIVE',
  details_updated_at timestamptz,
  details_updated_by text
);

create index employees_company_idx on public.employees (company_id);

-- Service role only. No RLS policy on purpose.
create table public.face_templates (
  employee_id text primary key references public.employees (staff_id),
  algorithm text not null,
  template text not null,
  updated_at timestamptz not null default now()
);

create table public.shop_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies (id),
  employee_id text not null references public.employees (staff_id),
  shop_id text not null references public.shops (shop_id),
  previous_shop_id text references public.shops (shop_id),
  effective_date timestamptz not null default now(),
  assigned_at timestamptz not null default now(),
  assigned_by text,
  assigned_by_role text,
  active boolean not null default true
);

-- History is kept, but an employee has at most one active shop.
create unique index shop_assignments_one_active
  on public.shop_assignments (employee_id) where active;
create index shop_assignments_company_idx on public.shop_assignments (company_id);

create table public.leave_records (
  leave_id text primary key default ('LV-' || replace(gen_random_uuid()::text, '-', '')),
  company_id text not null references public.companies (id),
  employee_id text not null references public.employees (staff_id),
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('approved', 'pending', 'rejected')),
  approved_by text,
  check (end_date >= start_date)
);

create index leave_records_employee_idx on public.leave_records (employee_id, start_date);

/* ------------------------------------------------------------------ Attendance */

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  company_name text not null,
  full_name text not null,
  type text not null check (type in ('check-in', 'check-out', 'absent')),
  status text not null,
  date date not null,
  occurred_at timestamptz not null default now(),
  weekend boolean not null default false,
  overtime_hours numeric(6, 1),
  source text not null default 'face',
  verification_score real,
  photo_path text,
  reason text,
  -- One check-in, one check-out and one absent mark per employee per day.
  unique (employee_id, date, type)
);

create index attendance_events_company_date_idx on public.attendance_events (company_id, date);

-- Service role only. No RLS policy on purpose.
create table public.face_attempts (
  employee_id text not null references public.employees (staff_id),
  date date not null,
  failed integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (employee_id, date)
);

-- The current override for one employee on one day, whether it came from a
-- correction or a manual entry. Keeping both here means a day can only ever
-- have one.
create table public.attendance_corrections (
  employee_id text not null references public.employees (staff_id),
  date date not null,
  company_id text not null references public.companies (id),
  manual_type text not null check (manual_type in ('corrected', 'created')),
  entry_method text not null check (entry_method in ('correction', 'manual-entry')),
  clock_in timestamptz,
  clock_out timestamptz,
  updated_at timestamptz not null default now(),
  primary key (employee_id, date)
);

create index attendance_corrections_company_idx on public.attendance_corrections (company_id, date);

create table public.attendance_correction_history (
  id text primary key,
  employee_id text not null references public.employees (staff_id),
  date date not null,
  company_id text not null references public.companies (id),
  action text not null,
  changed_at timestamptz not null default now(),
  changed_by text not null,
  changed_by_role text,
  reason text not null,
  remarks text not null default '',
  entry_method text,
  entry_batch_id text,
  manual_type text,
  previous jsonb,
  next jsonb
);

create index attendance_correction_history_key_idx
  on public.attendance_correction_history (employee_id, date, changed_at);

/* ------------------------------------------------------------------ SMS verification */

-- Service role only. No RLS policy on purpose: this is the only place a future
-- check time exists, and no client can read it.
create table public.verification_schedule (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  date date not null,
  verification_number integer not null check (verification_number between 1 and 3),
  scheduled_at timestamptz not null,
  dispatched_at timestamptz,
  unique (employee_id, date, verification_number)
);

create index verification_schedule_due_idx
  on public.verification_schedule (scheduled_at) where dispatched_at is null;

-- A row is created only when a check is dispatched.
create table public.verification_events (
  event_id text primary key,
  employee_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  shop_id text references public.shops (shop_id),
  date date not null,
  verification_number integer not null check (verification_number between 1 and 3),
  dispatched_at timestamptz not null default now(),
  delivery_status text not null,
  responded_at timestamptz,
  face_verification_status text not null default 'pending',
  liveness_status text not null default 'pending',
  gps_verification_status text not null default 'pending',
  distance_from_shop integer,
  gps_accuracy integer,
  result text,
  unique (employee_id, date, verification_number)
);

create index verification_events_company_date_idx on public.verification_events (company_id, date);

-- Service role only. No RLS policy on purpose.
create table public.verification_tokens (
  token_hash text primary key,
  event_id text not null references public.verification_events (event_id),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.monitoring_alert_reviews (
  exception_id text primary key,
  company_id text not null references public.companies (id),
  status text not null,
  resolution_note text not null default '',
  reviewed_at timestamptz not null default now(),
  reviewed_by text
);

/* ------------------------------------------------------------------ Holidays and settings */

-- Ghana public holidays are built into the shared rules. This table holds the
-- ones HR sets.
create table public.holidays (
  id text primary key default ('hol-' || replace(gen_random_uuid()::text, '-', '')),
  date date not null unique,
  name text not null check (char_length(name) between 3 and 80),
  created_by text not null,
  created_at timestamptz not null default now()
);

-- One row per section: general, monitoring, notifications, security, data.
create table public.settings_general (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table public.settings_company (
  company_id text primary key references public.companies (id),
  profile jsonb not null,
  vat_rate numeric(5, 2) not null default 5.5 check (vat_rate between 0 and 100),
  vat_updated_by text,
  vat_updated_at timestamptz
);

-- Effective-dated versions. A change never rewrites earlier days.
create table public.settings_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('attendance', 'working-hours', 'pay')),
  company_id text references public.companies (id),
  effective_from date not null,
  "values" jsonb not null,
  changed_by text not null,
  changed_at timestamptz not null default now(),
  check ((kind = 'attendance') = (company_id is null))
);

create unique index settings_versions_unique
  on public.settings_versions (kind, coalesce(company_id, ''), effective_from);

/* ------------------------------------------------------------------ Notifications */

create table public.notifications (
  id text primary key,
  source_key text not null unique,
  type text not null,
  category text not null,
  kind text not null,
  severity text not null,
  title text not null,
  description text not null default '',
  employee_id text,
  employee_name text,
  company_id text not null references public.companies (id),
  company_name text,
  position text,
  related_date date,
  sms_event_id text,
  sales_exception_id text,
  correction_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  read boolean not null default false,
  status text not null default 'new',
  assigned_to jsonb,
  resolution jsonb,
  dismissal jsonb,
  condition_cleared_at timestamptz,
  sales_synced_at timestamptz
);

create index notifications_company_idx on public.notifications (company_id, occurred_at desc);

create table public.notification_history (
  id text primary key default ('H-' || replace(gen_random_uuid()::text, '-', '')),
  notification_id text not null references public.notifications (id),
  company_id text not null references public.companies (id),
  at timestamptz not null default now(),
  action text not null,
  by text not null,
  note text not null default '',
  is_comment boolean not null default false
);

create index notification_history_notification_idx on public.notification_history (notification_id, at);

/* ------------------------------------------------------------------ Audit */

create table public.audit_events (
  event_id text primary key default ('AUD-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  at timestamptz not null default now(),
  origin text not null default 'action',
  source text not null default 'System',
  action text not null,
  category text not null,
  actor_name text not null default 'System',
  actor_role text not null default '',
  company_ids text[] not null default '{}',
  affected text not null default '',
  description text not null default '',
  previous jsonb,
  next jsonb
);

create index audit_events_at_idx on public.audit_events (at desc);

/* ------------------------------------------------------------------ Service-only support tables */

create table public.geocode_cache (
  query_key text primary key,
  results jsonb not null,
  fetched_at timestamptz not null default now()
);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

/* ------------------------------------------------------------------ Append-only guard */

create function app_private.reject_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function app_private.reject_change();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function app_private.reject_change();

create trigger correction_history_append_only
  before update or delete on public.attendance_correction_history
  for each row execute function app_private.reject_change();
create trigger correction_history_no_truncate
  before truncate on public.attendance_correction_history
  for each statement execute function app_private.reject_change();

create trigger notification_history_append_only
  before update or delete on public.notification_history
  for each row execute function app_private.reject_change();
create trigger notification_history_no_truncate
  before truncate on public.notification_history
  for each statement execute function app_private.reject_change();

/* ------------------------------------------------------------------ RLS helper */

-- The companies the caller may read: empty unless they are an active HR user
-- who has completed MFA. A stolen password alone reads nothing.
create function app_private.hr_company_ids() returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select u.company_ids
      from public.hr_users u
      where u.id = auth.uid()
        and u.status = 'active'
        and (auth.jwt() ->> 'aal') = 'aal2'
    ),
    '{}'::text[]
  );
$$;

revoke all on function app_private.hr_company_ids() from public;
grant execute on function app_private.hr_company_ids() to authenticated, service_role;

/* ------------------------------------------------------------------ Grants and RLS */

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  -- Company-scoped tables HR can read.
  for t in select unnest(array[
    'employees', 'shops', 'shop_assignments', 'leave_records',
    'attendance_events', 'attendance_corrections', 'attendance_correction_history',
    'monitoring_alert_reviews', 'notifications', 'notification_history'
  ]) loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy hr_read on public.%I for select to authenticated
         using (company_id = any ((select app_private.hr_company_ids())::text[]))', t);
  end loop;

  -- Shared reference data, readable by any active HR user.
  for t in select unnest(array['holidays', 'settings_general']) loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy hr_read on public.%I for select to authenticated
         using (cardinality((select app_private.hr_company_ids())) > 0)', t);
  end loop;
end;
$$;

grant select on public.companies to authenticated;
create policy hr_read on public.companies for select to authenticated
  using (id = any ((select app_private.hr_company_ids())::text[]));

grant select on public.settings_company to authenticated;
create policy hr_read on public.settings_company for select to authenticated
  using (company_id = any ((select app_private.hr_company_ids())::text[]));

grant select on public.settings_versions to authenticated;
create policy hr_read on public.settings_versions for select to authenticated
  using (
    case when company_id is null
      then cardinality((select app_private.hr_company_ids())) > 0
      else company_id = any ((select app_private.hr_company_ids())::text[])
    end
  );

-- Only checks that have actually been dispatched are ever visible.
grant select on public.verification_events to authenticated;
create policy hr_read on public.verification_events for select to authenticated
  using (
    company_id = any ((select app_private.hr_company_ids())::text[])
    and dispatched_at <= now()
  );

grant select on public.audit_events to authenticated;
create policy hr_read on public.audit_events for select to authenticated
  using (
    case when cardinality(company_ids) = 0
      then cardinality((select app_private.hr_company_ids())) > 0
      else company_ids && (select app_private.hr_company_ids())
    end
  );

-- HR can see their own account before MFA, so the sign-in screen can route them.
grant select on public.hr_users to authenticated;
create policy hr_read_self on public.hr_users for select to authenticated
  using (id = (select auth.uid()));

/* ------------------------------------------------------------------ Write functions */

create function app_private.write_audit(p_audit jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_audit is null then
    return;
  end if;
  insert into public.audit_events
    (source, action, category, actor_name, actor_role, company_ids, affected, description, previous, next)
  values (
    coalesce(p_audit ->> 'source', 'System'),
    p_audit ->> 'action',
    p_audit ->> 'category',
    coalesce(p_audit ->> 'actorName', 'System'),
    coalesce(p_audit ->> 'actorRole', ''),
    coalesce(array(select jsonb_array_elements_text(p_audit -> 'companyIds')), '{}'),
    coalesce(p_audit ->> 'affected', ''),
    coalesce(p_audit ->> 'description', ''),
    p_audit -> 'previous',
    p_audit -> 'next'
  );
end;
$$;

-- Applies a list of writes and their audit entries in one transaction. The
-- Edge Function has already checked permissions and validated the values.
create function public.apply_change(p_ops jsonb, p_audit jsonb default null) returns void
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
    'verification_schedule', 'verification_tokens', 'geocode_cache'
  ];
  deletable constant text[] := array['holidays'];
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

-- Creates an employee and issues the Staff ID. Locking the company's counter
-- row makes IDs sequential under concurrent registrations, and a failure rolls
-- the number back, so IDs are never skipped or reused.
create function public.register_employee(
  p_employee jsonb,
  p_template jsonb,
  p_shop_id text default null,
  p_new_shop jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id text := p_employee ->> 'company_id';
  v_company public.companies;
  v_number integer;
  v_staff_id text;
  v_shop public.shops;
  v_employee public.employees;
begin
  select * into v_company from public.companies where id = v_company_id;
  if not found then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;

  update public.company_counters
     set last_number = last_number + 1
   where company_id = v_company_id
   returning last_number into v_number;

  v_staff_id := v_company.staff_id_prefix || '-' || lpad(v_number::text, 4, '0');

  if p_new_shop is not null then
    insert into public.shops (shop_id, company_id, shop_name, town, area, address, geofence_radius, source, created_by)
    values (
      p_new_shop ->> 'shop_id',
      v_company_id,
      p_new_shop ->> 'shop_name',
      p_new_shop ->> 'town',
      p_new_shop ->> 'area',
      coalesce(p_new_shop ->> 'address', ''),
      coalesce((p_new_shop ->> 'geofence_radius')::integer, 150),
      'registration',
      p_employee ->> 'full_name'
    )
    on conflict do nothing
    returning * into v_shop;

    if v_shop.shop_id is null then
      select * into v_shop from public.shops
       where company_id = v_company_id
         and lower(shop_name) = lower(p_new_shop ->> 'shop_name')
         and lower(town) = lower(p_new_shop ->> 'town')
         and lower(area) = lower(p_new_shop ->> 'area');
    else
      perform app_private.write_audit(jsonb_build_object(
        'source', 'Employee registration',
        'action', 'Shop created',
        'category', 'Shifts & Shops',
        'actorName', p_employee ->> 'full_name',
        'actorRole', 'Employee registration',
        'companyIds', jsonb_build_array(v_company_id),
        'affected', v_shop.shop_name,
        'description', 'Added during employee registration. Location not set yet.'
      ));
    end if;
  elsif p_shop_id is not null then
    select * into v_shop from public.shops where shop_id = p_shop_id;
  end if;

  if (p_new_shop is not null or p_shop_id is not null)
     and (v_shop.shop_id is null or v_shop.company_id <> v_company_id) then
    raise exception 'Please choose an allocated shop for this position to continue.'
      using errcode = 'P0001';
  end if;

  insert into public.employees (
    staff_id, company_id, company_name, full_name, position, payment_method, phone, email, address,
    emergency_contact_name, emergency_contact_phone, assigned_shop_id, face_photo_path, biometric_consent_at
  ) values (
    v_staff_id,
    v_company_id,
    v_company.name,
    p_employee ->> 'full_name',
    p_employee ->> 'position',
    coalesce(p_employee ->> 'payment_method', ''),
    coalesce(p_employee ->> 'phone', ''),
    coalesce(p_employee ->> 'email', ''),
    coalesce(p_employee ->> 'address', ''),
    coalesce(p_employee ->> 'emergency_contact_name', ''),
    coalesce(p_employee ->> 'emergency_contact_phone', ''),
    v_shop.shop_id,
    p_employee ->> 'face_photo_path',
    now()
  )
  returning * into v_employee;

  insert into public.face_templates (employee_id, algorithm, template)
  values (v_staff_id, p_template ->> 'algorithm', p_template ->> 'template');

  if v_shop.shop_id is not null then
    insert into public.shop_assignments (company_id, employee_id, shop_id)
    values (v_company_id, v_staff_id, v_shop.shop_id);
  end if;

  perform app_private.write_audit(jsonb_build_object(
    'source', 'Employee registration',
    'action', 'Employee registered',
    'category', 'Employee Management',
    'actorName', v_employee.full_name,
    'actorRole', 'Employee registration',
    'companyIds', jsonb_build_array(v_company_id),
    'affected', v_employee.full_name || ' (' || v_staff_id || ')',
    'description', 'Self-registered with biometric consent recorded.'
  ));

  return to_jsonb(v_employee);
end;
$$;

-- Records a check-in or check-out using the database clock. The unique
-- constraint refuses a duplicate even if two requests arrive together.
create function public.record_attendance_event(
  p_staff_id text,
  p_type text,
  p_status text,
  p_score real,
  p_photo_path text,
  p_weekend boolean,
  p_overtime_hours numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    weekend, overtime_hours, source, verification_score, photo_path
  ) values (
    v_employee.staff_id, v_employee.company_id, v_employee.company_name, v_employee.full_name,
    p_type, p_status, (now() at time zone 'Africa/Accra')::date,
    p_weekend, p_overtime_hours, 'face', p_score, p_photo_path
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
$$;

-- Counts a failed face attempt today and, at the limit, marks the day absent.
create function public.record_face_failure(p_staff_id text, p_max integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Accra')::date;
  v_failed integer;
  v_employee public.employees;
begin
  insert into public.face_attempts (employee_id, date, failed)
  values (p_staff_id, v_today, 1)
  on conflict (employee_id, date)
  do update set failed = public.face_attempts.failed + 1, updated_at = now()
  returning failed into v_failed;

  if v_failed >= p_max then
    select * into v_employee from public.employees where staff_id = p_staff_id;
    insert into public.attendance_events (
      employee_id, company_id, company_name, full_name, type, status, date, source, reason
    ) values (
      v_employee.staff_id, v_employee.company_id, v_employee.company_name, v_employee.full_name,
      'absent', 'absent', v_today, 'system',
      'Marked absent after ' || p_max || ' failed face-verification attempts (possible attempt to cheat the system).'
    )
    on conflict (employee_id, date, type) do nothing;
  end if;

  return v_failed;
end;
$$;

-- Fixed-window rate limit. Returns true while the caller is under the limit.
create function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
  do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

-- These run only from the Edge Function.
do $$
declare
  f text;
begin
  for f in select unnest(array[
    'public.apply_change(jsonb, jsonb)',
    'public.register_employee(jsonb, jsonb, text, jsonb)',
    'public.record_attendance_event(text, text, text, real, text, boolean, numeric)',
    'public.record_face_failure(text, integer)',
    'public.rate_limit_hit(text, integer, integer)'
  ]) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

/* ------------------------------------------------------------------ Storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('face-enrollment', 'face-enrollment', false, 2097152, array['image/jpeg', 'image/png']),
  ('attendance-photos', 'attendance-photos', false, 2097152, array['image/jpeg', 'image/png']);

-- Paths start with the company ID. HR can create signed URLs for its companies.
create policy hr_read_photos on storage.objects for select to authenticated
  using (
    bucket_id in ('face-enrollment', 'attendance-photos')
    and (storage.foldername(name))[1] = any ((select app_private.hr_company_ids())::text[])
  );

/* ------------------------------------------------------------------ Seed */

insert into public.companies (id, name, staff_id_prefix) values
  ('box-for-less', 'Box For Less', 'BFL'),
  ('double-a', 'Double A', 'DAA');

insert into public.company_counters (company_id) values ('box-for-less'), ('double-a');

insert into public.settings_company (company_id, profile) values
  ('box-for-less', '{"displayName": "Box For Less", "code": "BFL", "phone": "", "email": "", "address": "", "logo": null, "status": "active"}'),
  ('double-a', '{"displayName": "Double A", "code": "DAA", "phone": "", "email": "", "address": "", "logo": null, "status": "active"}');

insert into public.settings_general (key, value, updated_by) values
  ('general', '{"systemName": "Workforce Pro", "logo": null, "description": "Workforce management for Box For Less and Double A.", "language": "en-GB", "dateFormat": "d MMM yyyy", "timeFormat": "12h", "landingPage": "dashboard"}', 'System default'),
  ('monitoring', '{"defaultGeofenceRadius": 150, "responseWindowMinutes": 15, "faceRequired": true, "gpsRequired": true, "smsEnabled": true, "repeatedExceptionThreshold": 2, "locationProvider": "none"}', 'System default'),
  ('security', '{"sessionTimeoutMinutes": 60, "loginAttemptLimit": 5, "passwordMinLength": 12, "passwordRequireMixed": true, "mfaPolicy": "required-in-production"}', 'System default'),
  ('notifications', '{}', 'System default'),
  ('data', '{"lastConfigExportAt": null}', 'System default');

insert into public.settings_versions (kind, company_id, effective_from, "values", changed_by) values
  ('attendance', null, '2000-01-01', '{"graceMinutes": 60, "clockOutWindowMinutes": 120, "missingClockIn": "absent-after-shift-end", "incompleteHandling": "flag-and-notify", "minCorrectionRemarks": 10, "correctionApproval": "not-required"}', 'System default'),
  ('working-hours', 'box-for-less', '2000-01-01', '{"workingDays": [1, 2, 3, 4, 5], "startTime": "08:00", "lateAfter": "09:00", "endTime": "17:00", "overtimeStart": "17:01", "breakStart": "12:30", "breakMinutes": 0}', 'System default'),
  ('working-hours', 'double-a', '2000-01-01', '{"workingDays": [1, 2, 3, 4, 5], "startTime": "08:00", "lateAfter": "09:00", "endTime": "17:00", "overtimeStart": "17:01", "breakStart": "12:30", "breakMinutes": 0}', 'System default'),
  ('pay', 'box-for-less', '2000-01-01', '{"overtimeRate": 60}', 'System default'),
  ('pay', 'double-a', '2000-01-01', '{"overtimeRate": 60}', 'System default');

-- The one outlet with real coordinates, supplied by HR.
insert into public.shops (
  shop_id, company_id, shop_name, town, area, latitude, longitude,
  location_source, location_label, source, created_by
) values (
  'shop-bfl-china-mall-ashaiman', 'box-for-less', 'China Mall', 'Ashaiman', 'Ashaiman Main Station',
  5.68486, -0.02419, 'manual', 'Coordinates provided by HR', 'HR', 'System default'
);
