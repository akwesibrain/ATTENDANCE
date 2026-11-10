-- Kiosk rules review.
--   1. Too many failed face scans lock the Staff ID for the day and alert HR.
--      They no longer mark the employee absent: anyone can type a Staff ID.
--   2. HR can deactivate a leaver from their last working day.
--   3. Check-out stays open six hours after the working day by default, so
--      late work is recorded as overtime. The unused grace period is dropped;
--      lateness comes from the late-coming time in Working Hours.

alter table public.attendance_events drop constraint attendance_events_type_check;
alter table public.attendance_events
  add constraint attendance_events_type_check check (type in ('check-in', 'check-out', 'face-lockout'));

create or replace function public.record_face_failure(p_staff_id text, p_max integer) returns integer
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
      'face-lockout', 'review', v_today, 'system',
      'The kiosk locked this Staff ID for the day after ' || p_max || ' failed face scans.'
    )
    on conflict (employee_id, date, type) do nothing;
  end if;

  return v_failed;
end;
$$;

revoke all on function public.record_face_failure(text, integer) from public, anon, authenticated;
grant execute on function public.record_face_failure(text, integer) to service_role;

alter table public.employees add column left_on date;
alter table public.employees
  add constraint employees_status_check check (status in ('ACTIVE', 'INACTIVE')),
  add constraint employees_left_on_check check ((status = 'INACTIVE') = (left_on is not null));

update public.settings_versions
set "values" = ("values" - 'graceMinutes') || '{"clockOutWindowMinutes": 360}'::jsonb
where kind = 'attendance' and effective_from = '2000-01-01' and ("values" ->> 'clockOutWindowMinutes')::int = 120;

update public.settings_versions
set "values" = "values" - 'graceMinutes'
where kind = 'attendance' and "values" ? 'graceMinutes';
