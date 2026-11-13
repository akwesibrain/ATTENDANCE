-- set_hr_user_status: refuse an actor whose own access was removed while
-- they waited for the lock. Without this, with three or more HR users, two
-- people removing each other at the same moment could both succeed.

-- Changes a person's HR access. Locking every active row first means two HR
-- users removing each other at once cannot both succeed.
create or replace function public.set_hr_user_status(p_actor uuid, p_target uuid, p_status text) returns jsonb
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

  -- Re-checked after the lock: someone removed a moment ago can no longer act.
  if not exists (select 1 from public.hr_users where id = p_actor and status = 'active') then
    raise exception 'This account does not have access.' using errcode = 'P0001';
  end if;

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
