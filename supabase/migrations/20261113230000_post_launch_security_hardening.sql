-- Post-launch backend & database security hardening:
-- 1. Allow 'deactivated' on tracking_sessions.closed_reason and 'result' on verification_schedule.
-- 2. Refuse face enrolment links for inactive employees inside public.enroll_face.
-- 3. Enforce live unexpired auth.sessions (not_after) in app_private.hr_company_ids().
-- 4. Restrict company-less audit_events (cardinality(company_ids) = 0) to HR users with all companies.
-- 5. Narrow public.apply_change writable/deletable tables to those actually mutated via applyChange,
--    and match null fields safely with IS NOT DISTINCT FROM.
-- 6. Enforce append-only triggers on public.employee_shop_changes and revoke direct write_audit access.

alter table public.tracking_sessions
  drop constraint if exists tracking_sessions_closed_reason_check;
alter table public.tracking_sessions
  add constraint tracking_sessions_closed_reason_check
  check (closed_reason in ('clock-out', 'face-lockout', 'day-end', 'deactivated'));

alter table public.verification_schedule
  add column if not exists result text;

-- Refuse one-time face setup links if HR deactivated the employee after issuing the link.
create or replace function public.enroll_face(p_token_hash text, p_template jsonb, p_photo_path text) returns jsonb
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
  if not found or v_employee.status <> 'ACTIVE' then
    raise exception 'This link has expired or was already used. Ask HR for a new one.' using errcode = 'P0001';
  end if;
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

revoke all on function public.enroll_face(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.enroll_face(text, jsonb, text) to service_role;

-- Direct database reads require an active HR account, AAL2 MFA, and a live unexpired auth.sessions row.
create or replace function app_private.hr_company_ids() returns text[]
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
        and exists (
          select 1 from auth.sessions s
          where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
            and s.user_id = u.id
            and (s.not_after is null or s.not_after > now())
        )
    ),
    '{}'::text[]
  );
$$;

revoke all on function app_private.hr_company_ids() from public;
grant execute on function app_private.hr_company_ids() to authenticated, service_role;

-- Evaluated inside SECURITY DEFINER because public.companies has an hr_read RLS policy
-- that otherwise filters public.companies down to the caller's own company_ids.
create or replace function app_private.hr_has_all_companies() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(app_private.hr_company_ids()) > 0
    and coalesce(
      (select array_agg(id order by id) from public.companies),
      '{}'::text[]
    ) <@ (select app_private.hr_company_ids());
$$;

revoke all on function app_private.hr_has_all_companies() from public, anon;
grant execute on function app_private.hr_has_all_companies() to authenticated, service_role;

drop policy if exists hr_read on public.audit_events;
create policy hr_read on public.audit_events for select to authenticated
  using (
    case when cardinality(company_ids) = 0
      then (select app_private.hr_has_all_companies())
      else company_ids && (select app_private.hr_company_ids())::text[]
    end
  );

-- Narrow writable/deletable lists to tables genuinely modified through applyChange,
-- and compare match_data keys with IS NOT DISTINCT FROM so null filters match SQL NULLs.
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
    'employee_shops', 'employee_shop_changes', 'shop_location_proposals'
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
      select string_agg(format('t.%1$I is not distinct from m.%1$I', k), ' and ') into conditions
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

-- Append-only protection for employee_shop_changes, matching audit_events / *_history.
drop trigger if exists employee_shop_changes_append_only on public.employee_shop_changes;
create trigger employee_shop_changes_append_only
  before update or delete on public.employee_shop_changes
  for each row execute function app_private.reject_change();

drop trigger if exists employee_shop_changes_no_truncate on public.employee_shop_changes;
create trigger employee_shop_changes_no_truncate
  before truncate on public.employee_shop_changes
  for each statement execute function app_private.reject_change();

revoke all on function app_private.write_audit(jsonb) from public, anon, authenticated;
