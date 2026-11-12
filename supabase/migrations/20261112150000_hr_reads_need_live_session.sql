-- Direct database reads (tables and photo links) also need the sign-in
-- session to still exist. Without this, a token from a session that was ended
-- by a password or authenticator reset kept reading data until it expired.
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
        )
    ),
    '{}'::text[]
  );
$$;

revoke all on function app_private.hr_company_ids() from public;
grant execute on function app_private.hr_company_ids() to authenticated, service_role;
