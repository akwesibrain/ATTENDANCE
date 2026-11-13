-- HR onboarding: HR adds employees (face now or by a one-time link) and invites
-- people to the HR portal. Every one-time link lives in setup_links; only the
-- SHA-256 hash of each token is stored.

create table public.hr_invites (
  id text primary key,
  name text not null,
  email text not null,
  phone text not null default '',
  -- The inviting HR user's name, shown on the setup page.
  invited_by text not null,
  invited_by_id uuid not null references public.hr_users (id),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  accepted_user_id uuid references auth.users (id)
);

create unique index hr_invites_one_pending_per_email on public.hr_invites (email) where status = 'pending';

create table public.setup_links (
  token_hash text primary key,
  kind text not null check (kind in ('face', 'hr-invite')),
  staff_id text references public.employees (staff_id),
  invite_id text references public.hr_invites (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (
    (kind = 'face' and staff_id is not null and invite_id is null)
    or (kind = 'hr-invite' and invite_id is not null and staff_id is null)
  )
);

create index setup_links_staff_idx on public.setup_links (staff_id);
create index setup_links_invite_idx on public.setup_links (invite_id);

-- Service role only. No RLS policy on purpose.
do $$
declare
  t text;
begin
  foreach t in array array['hr_invites', 'setup_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- register_employee gains p_added_by (HR adding someone) and accepts a null
-- template (no face yet). Self-registration calls it exactly as before.
drop function public.register_employee(jsonb, jsonb, text, jsonb);

create function public.register_employee(
  p_employee jsonb,
  p_template jsonb,
  p_shop_id text default null,
  p_new_shop jsonb default null,
  p_added_by jsonb default null
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
  -- HR adding an employee is recorded under HR's name; self-registration under the employee's.
  v_actor_name text := coalesce(p_added_by ->> 'name', p_employee ->> 'full_name');
  v_actor_role text := coalesce(p_added_by ->> 'role', 'Employee registration');
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
      case when p_added_by is null then 'registration' else 'HR' end,
      v_actor_name
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
        'actorName', v_actor_name,
        'actorRole', v_actor_role,
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
    case when p_template is null then null else now() end
  )
  returning * into v_employee;

  if p_template is not null then
    insert into public.face_templates (employee_id, algorithm, template)
    values (v_staff_id, p_template ->> 'algorithm', p_template ->> 'template');
  end if;

  if v_shop.shop_id is not null then
    insert into public.shop_assignments (company_id, employee_id, shop_id)
    values (v_company_id, v_staff_id, v_shop.shop_id);
  end if;

  perform app_private.write_audit(jsonb_build_object(
    'source', case when p_added_by is null then 'Employee registration' else 'Employee onboarding' end,
    'action', case when p_added_by is null then 'Employee registered' else 'Employee added by HR' end,
    'category', 'Employee Management',
    'actorName', v_actor_name,
    'actorRole', v_actor_role,
    'companyIds', jsonb_build_array(v_company_id),
    'affected', v_employee.full_name || ' (' || v_staff_id || ')',
    'description', case
      when p_added_by is null then 'Self-registered with biometric consent recorded.'
      when p_template is null then 'Added by HR. Face not set up yet.'
      else 'Added by HR with the face scanned in person and biometric consent recorded.'
    end
  ));

  return to_jsonb(v_employee);
end;
$$;

-- Saves a face through a one-time link. Locking the link row means a second
-- submission of the same link waits, then finds it used.
create function public.enroll_face(p_token_hash text, p_template jsonb, p_photo_path text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.setup_links;
  v_employee public.employees;
  v_previous text;
begin
  select * into v_link from public.setup_links
   where token_hash = p_token_hash and kind = 'face'
   for update;
  if not found or v_link.used_at is not null or v_link.cancelled_at is not null or v_link.expires_at <= now() then
    raise exception 'This link has expired or was already used. Ask HR for a new one.' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees where staff_id = v_link.staff_id for update;
  v_previous := v_employee.face_photo_path;

  insert into public.face_templates (employee_id, algorithm, template, updated_at)
  values (v_employee.staff_id, p_template ->> 'algorithm', p_template ->> 'template', now())
  on conflict (employee_id) do update
    set algorithm = excluded.algorithm, template = excluded.template, updated_at = now();

  update public.employees
     set face_photo_path = p_photo_path, biometric_consent_at = now()
   where staff_id = v_employee.staff_id;

  update public.setup_links set used_at = now() where token_hash = p_token_hash;

  perform app_private.write_audit(jsonb_build_object(
    'source', 'Employee onboarding',
    'action', 'Face set up by link',
    'category', 'Employee Management',
    'actorName', v_employee.full_name,
    'actorRole', 'Employee',
    'companyIds', jsonb_build_array(v_employee.company_id),
    'affected', v_employee.full_name || ' (' || v_employee.staff_id || ')',
    'description', 'Face saved through a setup link, with biometric consent recorded.'
  ));

  return jsonb_build_object(
    'staff_id', v_employee.staff_id,
    'full_name', v_employee.full_name,
    'company_id', v_employee.company_id,
    'previous_photo_path', v_previous
  );
end;
$$;

-- The sign-in account for an email, or null. Emails are compared lowercase.
create function public.auth_user_id_for_email(p_email text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

-- Changes a person's HR access. Locking every active row first means two HR
-- users removing each other at once cannot both succeed.
create function public.set_hr_user_status(p_actor uuid, p_target uuid, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
  v_target public.hr_users;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Unknown status' using errcode = 'P0001';
  end if;

  perform 1 from public.hr_users where status = 'active' for update;
  select count(*) into v_active from public.hr_users where status = 'active';

  select * into v_target from public.hr_users where id = p_target for update;
  if not found then
    raise exception 'HR user not found.' using errcode = 'P0001';
  end if;

  if p_status = 'inactive' and v_target.status = 'active' then
    if p_actor = p_target then
      raise exception 'You cannot remove your own access.' using errcode = 'P0001';
    end if;
    if v_active <= 1 then
      raise exception 'At least one person must keep HR access.' using errcode = 'P0001';
    end if;
  end if;

  update public.hr_users set status = p_status where id = p_target returning * into v_target;
  return to_jsonb(v_target);
end;
$$;

do $$
declare
  f text;
begin
  for f in select unnest(array[
    'public.register_employee(jsonb, jsonb, text, jsonb, jsonb)',
    'public.enroll_face(text, jsonb, text)',
    'public.auth_user_id_for_email(text)',
    'public.set_hr_user_status(uuid, uuid, text)'
  ]) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- The same function as before, now also allowed to write the onboarding tables.
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
    'workplace_displays', 'display_secrets', 'hr_invites', 'setup_links', 'hr_users'
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
