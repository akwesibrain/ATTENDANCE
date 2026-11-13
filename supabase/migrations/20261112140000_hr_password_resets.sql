-- HR password resets: a one-time "password-reset" link for an HR user, and a
-- way to sign someone out everywhere after their password or authenticator is
-- reset.

alter table public.setup_links
  add column if not exists hr_user_id uuid references public.hr_users(id) on delete cascade;

create index if not exists setup_links_hr_user_idx on public.setup_links (hr_user_id) where hr_user_id is not null;

alter table public.setup_links drop constraint if exists setup_links_kind_check;
alter table public.setup_links add constraint setup_links_kind_check
  check (kind in ('face', 'hr-invite', 'password-reset'));

alter table public.setup_links drop constraint if exists setup_links_check;
alter table public.setup_links add constraint setup_links_check check (
  (kind = 'face' and staff_id is not null and invite_id is null and hr_user_id is null)
  or (kind = 'hr-invite' and invite_id is not null and staff_id is null and hr_user_id is null)
  or (kind = 'password-reset' and hr_user_id is not null and staff_id is null and invite_id is null)
);

-- Ends every sign-in session for one user. Their refresh tokens go with the
-- sessions, and the API refuses access tokens whose session is gone.
create or replace function public.end_user_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics ended = row_count;
  return ended;
end;
$$;

revoke all on function public.end_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.end_user_sessions(uuid) to service_role;
