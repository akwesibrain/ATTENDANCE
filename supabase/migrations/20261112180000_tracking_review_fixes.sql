-- Fixes from the Live Tracker review.
--  1. A session is summarised exactly once, under a lock, so two end-of-day
--     runs at the same moment can never overwrite a summary with an empty one.
--  2. The 48-hour sweep marks any trail it removes before it was summarised,
--     so the report says "unavailable" instead of blaming the employee. The
--     live map keeps only today's positions.
--  3. A retried or late batch stores nothing twice, and flags are counted
--     only for points actually stored.

alter table public.tracking_sessions
  add column summarised_at timestamptz,
  add column trail_expired boolean not null default false;

grant select (summarised_at, trail_expired) on public.tracking_sessions to authenticated;

create unique index location_points_session_time_key on public.location_points (session_id, recorded_at);

create or replace function public.record_points(p_session uuid, p_points jsonb, p_flags jsonb, p_latest jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tracking_sessions;
  v_stored integer;
begin
  select * into v_session from public.tracking_sessions where id = p_session for update;
  if not found or (v_session.status = 'closed' and v_session.clock_out_at is null) then
    return 0;
  end if;

  -- p_flags is no longer used: flags are counted from the rows really stored.
  with inserted as (
    insert into public.location_points (session_id, staff_id, company_id, date, latitude, longitude, accuracy, recorded_at, is_mock, flagged)
    select v_session.id, v_session.staff_id, v_session.company_id, v_session.date,
           p.latitude, p.longitude, p.accuracy, p.recorded_at, coalesce(p.is_mock, false), p.flagged
      from jsonb_to_recordset(coalesce(p_points, '[]'::jsonb))
           as p(latitude double precision, longitude double precision, accuracy real, recorded_at timestamptz, is_mock boolean, flagged text)
     where p.recorded_at >= v_session.clock_in_at
       and (v_session.clock_out_at is null or p.recorded_at <= v_session.clock_out_at)
    on conflict (session_id, recorded_at) do nothing
    returning flagged, recorded_at
  ), counted as (
    insert into public.tracking_flags (staff_id, company_id, date, kind, points, first_at, last_at)
    select v_session.staff_id, v_session.company_id, v_session.date, flagged, count(*)::integer, min(recorded_at), max(recorded_at)
      from inserted where flagged is not null group by flagged
    on conflict (staff_id, date, kind) do update
       set points = public.tracking_flags.points + excluded.points,
           first_at = least(public.tracking_flags.first_at, excluded.first_at),
           last_at = greatest(public.tracking_flags.last_at, excluded.last_at)
  )
  select count(*)::integer into v_stored from inserted;

  if p_latest is not null and v_stored > 0 then
    insert into public.tracking_latest (staff_id, company_id, date, latitude, longitude, accuracy, recorded_at, session_status, updated_at)
    select v_session.staff_id, v_session.company_id, v_session.date,
           (p_latest ->> 'latitude')::double precision, (p_latest ->> 'longitude')::double precision,
           (p_latest ->> 'accuracy')::real, (p_latest ->> 'recorded_at')::timestamptz, v_session.status, now()
     where (p_latest ->> 'recorded_at')::timestamptz >= v_session.clock_in_at
       and (v_session.clock_out_at is null or (p_latest ->> 'recorded_at')::timestamptz <= v_session.clock_out_at)
    on conflict (staff_id) do update
       set company_id = excluded.company_id, date = excluded.date,
           latitude = excluded.latitude, longitude = excluded.longitude, accuracy = excluded.accuracy,
           recorded_at = excluded.recorded_at, session_status = excluded.session_status, updated_at = now()
     where public.tracking_latest.date < excluded.date or public.tracking_latest.recorded_at <= excluded.recorded_at;
  end if;

  return v_stored;
end;
$$;

-- Saves one session's day summary and deletes its trail, once. Returns false
-- (and changes nothing) when the session was already summarised, its trail was
-- swept, or its points changed since the caller read them.
create function public.save_session_summary(p_session uuid, p_summary jsonb, p_points integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tracking_sessions;
  v_count integer;
  v_row public.tracking_day_summaries;
begin
  select * into v_session from public.tracking_sessions where id = p_session for update;
  if not found or v_session.summarised_at is not null or v_session.trail_expired then
    return false;
  end if;
  select count(*)::integer into v_count from public.location_points where session_id = p_session;
  if v_count <> p_points then
    return false;
  end if;

  v_row := jsonb_populate_record(null::public.tracking_day_summaries, p_summary);
  insert into public.tracking_day_summaries (
    staff_id, company_id, date, clock_in, clock_out, tracked_minutes, points, first_at, last_at,
    covered_minutes, coverage, signal_lost, longest_gap_minutes, distance_m, shop_stays, mock_points, speed_points
  ) values (
    v_session.staff_id, v_session.company_id, v_session.date, v_session.clock_in_at, v_session.clock_out_at,
    v_row.tracked_minutes, v_row.points, v_row.first_at, v_row.last_at, v_row.covered_minutes, v_row.coverage,
    v_row.signal_lost, v_row.longest_gap_minutes, v_row.distance_m, coalesce(v_row.shop_stays, '{}'::jsonb),
    coalesce(v_row.mock_points, 0), coalesce(v_row.speed_points, 0)
  )
  on conflict (staff_id, date) do update set
    clock_in = excluded.clock_in, clock_out = excluded.clock_out, tracked_minutes = excluded.tracked_minutes,
    points = excluded.points, first_at = excluded.first_at, last_at = excluded.last_at,
    covered_minutes = excluded.covered_minutes, coverage = excluded.coverage, signal_lost = excluded.signal_lost,
    longest_gap_minutes = excluded.longest_gap_minutes, distance_m = excluded.distance_m,
    shop_stays = excluded.shop_stays, mock_points = excluded.mock_points, speed_points = excluded.speed_points;

  delete from public.location_points where session_id = p_session;
  update public.tracking_sessions set summarised_at = now() where id = p_session;
  return true;
end;
$$;

revoke all on function public.save_session_summary(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_session_summary(uuid, jsonb, integer) to service_role;

-- No trail outlives 48 hours. A trail removed before it was summarised is
-- marked, so its day reads "unavailable" rather than "no location received".
create function app_private.sweep_tracking() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  update public.tracking_sessions s
     set trail_expired = true
   where s.summarised_at is null
     and exists (select 1 from public.location_points p
                  where p.session_id = s.id and p.received_at < now() - interval '48 hours');
  delete from public.location_points where received_at < now() - interval '48 hours';
  get diagnostics v_deleted = row_count;
  delete from public.tracking_latest where date < (now() at time zone 'Africa/Accra')::date;
  return v_deleted;
end;
$$;

revoke all on function app_private.sweep_tracking() from public;

select cron.unschedule('tracking-sweep');
select cron.schedule('tracking-sweep', '15 3 * * *', $$select app_private.sweep_tracking()$$);
