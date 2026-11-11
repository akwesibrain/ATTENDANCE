-- Runs the `api` function's scheduled work.
--
-- The shared secret lives in Vault under the name `jobs_secret`, never in this
-- file. It must match the function's JOBS_SECRET. Until it exists, the jobs do
-- nothing.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function app_private.call_job(p_path text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret' limit 1;
  if v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://aiiglvsvrbtahihttwge.supabase.co/functions/v1/api/jobs/' || p_path,
    headers := jsonb_build_object('content-type', 'application/json', 'x-job-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function app_private.call_job(text) from public;

-- All times are UTC, which is Accra time. Today's checks are chosen before the
-- working day starts.
select cron.schedule('generate-verification-schedule', '30 4 * * *', $$select app_private.call_job('generate-schedule')$$);
select cron.schedule('dispatch-verification-checks', '* * * * *', $$select app_private.call_job('dispatch')$$);
select cron.schedule('close-missed-checks', '*/5 * * * *', $$select app_private.call_job('close-missed')$$);
select cron.schedule('sync-notifications', '*/15 * * * *', $$select app_private.call_job('sync-notifications')$$);
