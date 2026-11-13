-- Every Supervisor, Sales Representative and Merchandiser has a list of 1 to 7
-- shops from their company. It is also their daily visit list.
-- employees.assigned_shop_id always equals the first shop on the list.

create table public.employee_shops (
  staff_id    text not null references public.employees (staff_id),
  shop_id     text not null references public.shops (shop_id),
  company_id  text not null references public.companies (id),
  position    smallint not null check (position between 1 and 7),
  assigned_at timestamptz not null default now(),
  assigned_by text,
  primary key (staff_id, shop_id),
  unique (staff_id, position)
);
create index employee_shops_company_idx on public.employee_shops (company_id);

-- One snapshot per change, so HR can see who changed a list and how.
create table public.employee_shop_changes (
  id          uuid primary key default gen_random_uuid(),
  staff_id    text not null references public.employees (staff_id),
  company_id  text not null references public.companies (id),
  at          timestamptz not null default now(),
  by_name     text not null,
  by_role     text,
  previous    text[] not null,
  next        text[] not null
);
create index employee_shop_changes_staff_idx on public.employee_shop_changes (staff_id, at desc);

do $$
declare
  t text;
begin
  foreach t in array array['employee_shops', 'employee_shop_changes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy hr_read on public.%I for select to authenticated
         using (company_id = any ((select app_private.hr_company_ids())::text[]))', t);
  end loop;
end;
$$;

-- Today every field employee has one shop: it becomes the first on their list.
insert into public.employee_shops (staff_id, shop_id, company_id, position, assigned_by)
select staff_id, assigned_shop_id, company_id, 1, 'Backfill'
  from public.employees
 where assigned_shop_id is not null
on conflict do nothing;

-- register_employee takes a list of picked shops and a list of new shops in
-- place of one shop.
drop function public.register_employee(jsonb, jsonb, text, jsonb, jsonb);

create function public.register_employee(
  p_employee jsonb,
  p_template jsonb,
  p_shop_ids text[] default null,
  p_new_shops jsonb default null,
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
  v_new jsonb;
  v_ids text[] := '{}';
  v_employee public.employees;
  -- HR adding an employee is recorded under HR's name; self-registration under the employee's.
  v_actor_name text := coalesce(p_added_by ->> 'name', p_employee ->> 'full_name');
  v_actor_role text := coalesce(p_added_by ->> 'role', 'Employee registration');
begin
  select * into v_company from public.companies where id = v_company_id;
  if not found then
    raise exception 'Unknown company' using errcode = 'P0001';
  end if;

  -- Picked shops: active shops of this company only, without repeats, in order.
  if exists (
    select 1 from unnest(coalesce(p_shop_ids, '{}')) as picked(id)
     where not exists (
       select 1 from public.shops s
        where s.shop_id = picked.id and s.company_id = v_company_id and s.status = 'active'
     )
  ) then
    raise exception 'Choose shops from your company’s shop list.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(id order by first_at), '{}') into v_ids
    from (select id, min(n) as first_at from unnest(coalesce(p_shop_ids, '{}')) with ordinality as picked(id, n) group by id) as d;

  update public.company_counters
     set last_number = last_number + 1
   where company_id = v_company_id
   returning last_number into v_number;

  v_staff_id := v_company.staff_id_prefix || '-' || lpad(v_number::text, 4, '0');

  for v_new in select value from jsonb_array_elements(coalesce(p_new_shops, '[]'::jsonb)) loop
    v_shop := null;
    insert into public.shops (shop_id, company_id, shop_name, town, area, address, geofence_radius, source, created_by)
    values (
      v_new ->> 'shop_id',
      v_company_id,
      v_new ->> 'shop_name',
      v_new ->> 'town',
      v_new ->> 'area',
      coalesce(v_new ->> 'address', ''),
      coalesce((v_new ->> 'geofence_radius')::integer, 150),
      case when p_added_by is null then 'registration' else 'HR' end,
      v_actor_name
    )
    on conflict do nothing
    returning * into v_shop;

    if v_shop.shop_id is null then
      select * into v_shop from public.shops
       where company_id = v_company_id
         and lower(shop_name) = lower(v_new ->> 'shop_name')
         and lower(town) = lower(v_new ->> 'town')
         and lower(area) = lower(v_new ->> 'area');
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

    if v_shop.shop_id is null or v_shop.company_id <> v_company_id then
      raise exception 'Please choose an allocated shop for this position to continue.'
        using errcode = 'P0001';
    end if;
    if not (v_shop.shop_id = any (v_ids)) then
      v_ids := v_ids || v_shop.shop_id;
    end if;
  end loop;

  if cardinality(v_ids) > 7 then
    raise exception 'Choose at most 7 shops.' using errcode = 'P0001';
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
    v_ids[1],
    p_employee ->> 'face_photo_path',
    case when p_template is null then null else now() end
  )
  returning * into v_employee;

  if p_template is not null then
    insert into public.face_templates (employee_id, algorithm, template)
    values (v_staff_id, p_template ->> 'algorithm', p_template ->> 'template');
  end if;

  if cardinality(v_ids) > 0 then
    insert into public.shop_assignments (company_id, employee_id, shop_id)
    values (v_company_id, v_staff_id, v_ids[1]);

    insert into public.employee_shops (staff_id, shop_id, company_id, position, assigned_by)
    select v_staff_id, id, v_company_id, n, v_actor_name
      from unnest(v_ids) with ordinality as list(id, n);

    insert into public.employee_shop_changes (staff_id, company_id, by_name, by_role, previous, next)
    values (v_staff_id, v_company_id, v_actor_name, v_actor_role, '{}', v_ids);
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

revoke all on function public.register_employee(jsonb, jsonb, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.register_employee(jsonb, jsonb, text[], jsonb, jsonb) to service_role;

-- apply_change can now write the shop list tables, and delete list rows when a
-- list is replaced.
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
    'employee_shops', 'employee_shop_changes'
  ];
  deletable constant text[] := array['holidays', 'display_secrets', 'employee_shops'];
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
