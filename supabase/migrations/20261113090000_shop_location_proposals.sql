-- Shop locations captured at the shop. A Supervisor, Sales Representative or
-- Merchandiser standing at a shop on their list suggests its location from the
-- phone's GPS. Nothing changes on the shop until HR accepts the suggestion.

create table public.shop_location_proposals (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops (shop_id),
  company_id text not null references public.companies (id),
  staff_id text not null references public.employees (staff_id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m integer not null check (accuracy_m >= 0),
  -- How far the reading was from the shop's location at the time, if it had one.
  distance_from_current_m integer,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  proposed_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  -- A new reading replaces the person's earlier one for that shop.
  unique (shop_id, staff_id)
);
create index shop_location_proposals_company_status_idx on public.shop_location_proposals (company_id, status);

alter table public.shop_location_proposals enable row level security;
alter table public.shop_location_proposals force row level security;
revoke all on public.shop_location_proposals from public, anon, authenticated;
grant all on public.shop_location_proposals to service_role;
grant select on public.shop_location_proposals to authenticated;
create policy hr_read on public.shop_location_proposals for select to authenticated
  using (company_id = any ((select app_private.hr_company_ids())::text[]));

-- A shop's location can now come from a reading taken at the shop.
alter table public.shops drop constraint shops_location_source_check;
alter table public.shops add constraint shops_location_source_check
  check (location_source in ('geocoded', 'map-adjusted', 'manual', 'captured'));

-- apply_change can write shop_location_proposals.
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
    'employee_shops', 'employee_shop_changes',
    'tracking_sessions', 'location_points', 'tracking_latest', 'tracking_day_summaries', 'tracking_flags',
    'outlet_visits', 'shop_location_proposals'
  ];
  deletable constant text[] := array['holidays', 'display_secrets', 'employee_shops',
    'location_points', 'tracking_latest', 'tracking_sessions'];
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
