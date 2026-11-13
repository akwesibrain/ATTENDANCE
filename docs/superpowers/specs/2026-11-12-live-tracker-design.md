# Live Tracker backend — design

**Date:** 12 November 2026
**Branch:** `live-tracker`, built on `shop-lists`
**Project 2 of 3:**
- project 1, shop lists, gives each field employee 1 to 7 shops, which this project measures stays against;
- project 3, outlet visits, adds the visit scans this project's report counts.

**Sources:**
- the Live Tracker backend specification the user pasted on 12 November 2026, quoted below as "the tracker spec";
- the frontend on `origin/frontend/live-tracker-updates`: `locationTrackingService.js`, `liveTrackerService.js`, `trackingReportService.js` and `visitListService.js`.

Where the tracker spec and the older `docs/backend-live-tracker-and-sms-verification.md` disagree, the tracker spec wins.

## Goal

HR sees where field staff are while on duty, through a live map and a daily report. The location trail is kept only for the day.
- The server opens a tracking session at clock-in and accepts the phone's points only while the session is open.
- It keeps one latest position per person, pushed to HR through Realtime.
- Each night it summarises the day, without coordinates, and deletes the trail.

## Decisions

| # | Decision |
|---|---|
| 1 | **Tracked roles:** Supervisors, Sales Representatives and Merchandisers, using `needsShopList(position)` from project 1. No one else is ever given a token. |
| 2 | **Live map, option B:** a `tracking_latest` table with company RLS, in the `supabase_realtime` publication. The frontend builds the map JSON itself. |
| 3 | **End of day, "job plus backups":** a nightly job does the summary through the existing scheduled-jobs secret. As a backup, a past day without a summary is summarised on demand, when HR asks for its report or when anyone's first point of a new day arrives. A database-only sweep deletes points older than 48 hours whatever else happened. |
| 4 | **Workplace QR code:** none of the three tracked roles needs it. Today's rule exempts only Sales Representatives and Merchandisers. SMS checks are unchanged. |
| 5 | **Session closing:** a session closes on clock-out or face lockout, through a database trigger on `attendance_events`. Without either, it closes at `closes_at`: the working day's end plus the clock-out window, fixed when the session opens. |
| 6 | **Alerts:** fake-location and impossible-speed points are kept, flagged and counted in `tracking_flags`. Two new high-severity HR alerts are raised from that table. They never change attendance. |
| 7 | **The tracker spec's §11 defaults:** no past-day routes; a proven stay is at least 10 minutes; summaries are kept 6 years, with no automatic deletion yet; background tracking waits for the native app. |
| 8 | **HR access:** any active HR user of the company can read, as for every other HR table. The backend has no per-permission grants. |

Out of scope:
- frontend changes, because the frontend developer switches the services;
- outlet visits (project 3);
- deleting summaries after 6 years;
- removing the radius from SMS checks.

## Shared rules: `supabase/functions/_shared/rules/tracking.js`

These are copied from the frontend so the numbers match. The tracker spec's §8 checks are the tests.

**Constants:**
- `MIN_SECONDS = 20` and `MIN_METRES = 15` (thinning);
- `MAX_POINTS_PER_DAY = 2000`;
- `LIVE_STALE_MINUTES = 5`;
- `NOISY_ACCURACY_M = 100`;
- `GPS_TOLERANCE_M = 100`;
- `STAY_GAP_MINUTES = 5`;
- `MIN_STAY_MINUTES = 10`;
- `MAX_FUTURE_MS = 120000`;
- `MAX_AGE_MS = 12 h`;
- `MAX_SPEED_KMH = 200`.

**Functions:**
- `distanceMetres(a, b)`: haversine distance, rounded.
- `summariseTrail(points, startIso, endIso)`: the frontend's algorithm, unchanged. Points are `{ latitude, longitude, accuracy, at }`. It returns `{ points, firstAt, lastAt, trackedMinutes, coveredMinutes, coverage, signalLost, longestGapMinutes, distanceM }`.
- `shopStays(points, shops)`: the frontend's algorithm. It returns `{ [shopId]: { minutes, longestMinutes, closestM } }`. The field is renamed from `closest` to `closestM`, as in the tracker spec §5.
- `visitProof({ listIds, shopsById, visits, stays, dayOver })`: the frontend's algorithm, with the shops passed in instead of read from the browser. Until project 3, `visits` is always `[]`.
- `trackingResult({ clockIn, summary })`: returns `good` (coverage of at least 0.9), `partial` (at least 0.6), `poor`, `no-signal` (clocked in with no points) or `not-clocked-in`.
- `screenPoints({ session, last, storedToday, points, now })` decides which points to keep. It returns `{ keep: Point[], rejected: number, flags: { mock: number, speed: number } }`. In order:
  - **Rejected** when:
    - the point is not finite, or its latitude or longitude is out of range;
    - `recordedAt` is before `session.clock_in_at`;
    - `recordedAt` is after `session.clock_out_at`, when the session has one;
    - `recordedAt` is more than 2 minutes after `now`, or more than 12 hours before it.
  - Points are sorted by `recordedAt`.
  - **Thinned:** a point is skipped as "not stored" when it is under 20 s and under 15 m from the last kept point (or `last`). Skipped points are counted as accepted, matching the phone.
  - **Capped:** points stop once `storedToday + keep.length` reaches 2,000. Points over the cap count as rejected.
  - **Flagged, not dropped:** `isMock: true` gives `flagged = 'mock'`. A speed from the previous kept point above 200 km/h gives `flagged = 'speed'`, and needs at least 1 s between the points.

## Database: one migration

```sql
create table public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  date date not null,
  clock_in_at timestamptz not null,
  closes_at timestamptz not null,          -- working day end + clock-out window
  clock_out_at timestamptz,
  token_hash text not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_reason text check (closed_reason in ('clock-out', 'face-lockout', 'day-end')),
  closed_at timestamptz,
  unique (staff_id, date)
);

create table public.location_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.tracking_sessions (id) on delete cascade,
  staff_id text not null, company_id text not null, date date not null,
  latitude double precision not null, longitude double precision not null,
  accuracy real, recorded_at timestamptz not null, received_at timestamptz not null default now(),
  is_mock boolean not null default false,
  flagged text check (flagged in ('mock', 'speed'))
);
create index location_points_staff_time_idx on public.location_points (staff_id, recorded_at);

create table public.tracking_latest (
  staff_id text primary key references public.employees (staff_id),
  company_id text not null, date date not null,
  latitude double precision not null, longitude double precision not null,
  accuracy real, recorded_at timestamptz not null,
  session_status text not null check (session_status in ('open', 'closed')),
  updated_at timestamptz not null default now()
);

create table public.tracking_day_summaries (
  staff_id text not null references public.employees (staff_id),
  company_id text not null, date date not null,
  clock_in timestamptz, clock_out timestamptz,
  tracked_minutes integer not null, points integer not null,
  first_at timestamptz, last_at timestamptz,
  covered_minutes integer not null, coverage real, signal_lost integer not null,
  longest_gap_minutes integer not null, distance_m integer not null,
  shop_stays jsonb not null default '{}',   -- { shopId: { minutes, longestMinutes, closestM } }; no coordinates
  mock_points integer not null default 0, speed_points integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (staff_id, date)
);

create table public.tracking_flags (
  staff_id text not null references public.employees (staff_id),
  company_id text not null, date date not null,
  kind text not null check (kind in ('mock', 'speed')),
  points integer not null, first_at timestamptz not null, last_at timestamptz not null,
  primary key (staff_id, date, kind)
);
```

- **Indexes:** the tracker spec's `tracking_sessions (staff_id, date)` is covered by the unique constraint.
- **RLS on all five tables:**
  - Enable and force RLS, revoke from `anon` and `authenticated`, grant to `service_role`.
  - Add an `hr_read` select policy for `authenticated`: `company_id = any (app_private.hr_company_ids())`.
  - On `tracking_sessions`, `authenticated` gets **column** grants that leave out `token_hash`, so HR never reads it.
- **Realtime:** `alter publication supabase_realtime add table public.tracking_latest`.
- **Trigger** `app_private.close_tracking_session()`, run after insert on `attendance_events`:
  - for a `check-out`: set `status = 'closed'`, `closed_reason = 'clock-out'`, `clock_out_at = new.occurred_at` and `closed_at = now()`;
  - for a `face-lockout`: the same with `closed_reason = 'face-lockout'`, and `clock_out_at = new.occurred_at` only if the session is open;
  - in both cases, update `tracking_latest.session_status` to `closed`.
- **`apply_change`:** gains writes to the five tables, and deletes from `location_points` and `tracking_latest`.
- **Database-only sweep** (`pg_cron`, 03:15 UTC daily, plain SQL with no secret):
  - delete `location_points` where `received_at < now() - interval '48 hours'`;
  - delete `tracking_latest` where `date < (now() at time zone 'Africa/Accra')::date - 1`.
- **RPC** `public.record_points(p_session uuid, p_points jsonb, p_flags jsonb, p_latest jsonb) returns void`, service role only. In one transaction it:
  - inserts the points;
  - upserts `tracking_flags` (adding to counts, keeping the earliest `first_at` and latest `last_at`);
  - upserts `tracking_latest`.

  This keeps a batch atomic.

## API

### Check-in (`POST /attendance/events`, changed)

After `record_attendance_event` returns a `check-in` for a position where `needsShopList` is true:
1. Generate a 32-byte token.
2. Insert a `tracking_sessions` row with:
   - `token_hash = sha256Hex(token)`;
   - `clock_in_at = event.occurred_at`;
   - `closes_at = working day end + clockOutWindowMinutes`, using the same rules `records.js` uses for `expectedEnd` and the clock-out window.
3. Add `trackingToken` and `trackingClosesAt` to the response.

If the insert fails, log the error and return the check-in without a token. Other roles and `check-out` responses are unchanged.

The kiosk's `siteRequired` uses `needsShopList(position)` instead of `requiresShop`.

### `POST /tracking/points` (new, public, token-authenticated)

- **Auth:** `Authorization: Bearer <trackingToken>`. Rate limit `points:token:<hash prefix>` at 120 requests per 600 s, plus the existing per-IP limit pattern.
- **Request size:** a body over 64 KB, or more than 500 points, gets 400.
- **Refusals:**
  - an unknown token gets `401 {code: 'invalid_token'}`;
  - a session that is `closed`, or where `now >= closes_at`, gets `409 {code: 'session_closed'}`. In the second case the session is first closed with `closed_reason = 'day-end'`.
- **Flow:**
  - Load `last`, the latest stored point for the session, and `storedToday`, its point count.
  - Run `screenPoints`, then `record_points`.
  - When this is the first point of a new Accra day, run the backup summary of past days in the background with `later(closePastDays())`.
- **Response:** `{ accepted, rejected, sessionOpen: true }`.

### `GET /hr/tracking/reports/daily?companyId=&date=&role=` (new)

- **Access:** `requireHr` plus `assertCompany`.
- **Validation:** `date` is a date key no later than today, and `role` is optional (`supervisor`, `sales-rep` or `merchandiser`).
- **Past days:** any past day that still has points or open sessions is closed first, by calling `closeDay(date)` for every company, because deleting trails sooner is always allowed.
- **Rows:** come from the attendance records (`buildRecord`) of tracked employees.
  - The summary comes from `tracking_day_summaries` for past days, or from `summariseTrail` over today's points up to now while the person is still clocked in.
  - `shops` (Sales Reps and Supervisors only) comes from `visitProof` with the employee's list and stays.
  - The response is in the tracker spec §4.3 shape, with no coordinates.

### Jobs

- **`POST /jobs/tracking-close-day`:** behind the existing jobs secret, scheduled by `pg_cron` at 00:20 UTC (00:20 Accra) through `app_private.call_job('tracking-close-day')`.
- **`closePastDays()`** runs `closeDay(d)` for every date before today that still has points or open sessions. For each one:
  1. Close the date's open sessions with `closed_reason = 'day-end'`.
  2. For each staff member with a session that day, build the summary:
     - `summariseTrail(points, clock_in_at, clock_out_at ?? last point ?? clock_in_at)`;
     - `shopStays` over the employee's list shops;
     - the flag counts.
  3. Upsert the summary, delete that staff-date's points, and delete `tracking_latest` rows dated before today.

  Each staff-date is one `apply_change` call. The summary and the deletion succeed or fail together.

## Alerts

- **New notification types** in `notificationTypes.js`, both `category: 'sales-monitoring'`, `severity: 'high'`, `kind: 'exception'`:
  - `tracking-mock-location`, labelled "Fake location reported";
  - `tracking-impossible-speed`, labelled "Impossible movement speed".
- **Detection:** `detectTrackingFlags(flags, push, rosterById)` raises one issue per row, with source key `tracking-<kind>:<staffId>:<date>`.
- **Wiring:** `syncNotifications` loads `tracking_flags` for the scanned dates.
- **Wording:** the description says "This is a reason to ask, not proof of misconduct. Attendance is not changed."

## Error handling

- A bad point inside a batch rejects that point only. A bad body gets 400.
- A database failure while recording points gives 500 and stores nothing (the RPC is one transaction). The phone resends.
- **Races:**
  - Clock-out arriving during a batch: the trigger closes the session. A batch already being screened may still store points recorded before clock-out, which is correct.
  - Points recorded after clock-out are always rejected, because `clock_out_at` is checked again inside `record_points`. It filters `recorded_at <= clock_out_at` when the session is closed.
- If summarising a day fails, its points stay. The next run, or the 48-hour sweep, handles them.

## Testing

**Unit tests** (`tests/tracking.test.js`), using the tracker spec §8 values:
- A 60-minute day with one point a minute for 30 minutes (points at minutes 0 to 30) gives coverage of about 0.58, `coveredMinutes` 35, `signalLost` 1 and `longestGapMinutes` 30.
- No points gives coverage 0 and result `no-signal`.
- A point with 500 m accuracy is left out of the distance.
- Points every 3 minutes from 09:00 to 09:12 within 100 m give a 12-minute stay, and the shop is `proven`.
- Points at 0, 4, 15 and 19 minutes give a longest stay of 4 minutes, so the shop is not proven.
- `screenPoints`:
  - a point 1 s before clock-out is kept and one 1 s after is rejected;
  - a point 2 minutes ahead is kept and one 2 min 1 s ahead is rejected;
  - a point older than 12 h is rejected;
  - thinning works, and the cap stops at 2,000;
  - a mock point is flagged, and a 300 km/h jump is flagged.
- `needsShopList` decides who gets a token.

**Live smoke** (`scripts/smoke-live-tracker.mjs`):
- **Setup:** a real check-in needs a face match, which the live `FACE_PROVIDER` blocks. So the script makes the session the way the server does, with SQL: a check-in event, plus a session with a known token hash.
- **Points:**
  - points are accepted;
  - a point 1 s after `clock_out_at` is rejected and one 1 s before is accepted;
  - a check-out event inserted by SQL closes the session, through the trigger, and the next call gets `409 session_closed`;
  - an unknown token gets 401.
- **Live data:**
  - `tracking_latest` is updated;
  - an HR Realtime subscription receives the change;
  - an HR user limited to Double A reads no Box For Less rows from any of the five tables;
  - `token_hash` cannot be selected.
- **Report and end of day:**
  - with a session dated yesterday, the report closes the day: the points are gone, and the summary row has stay minutes and no latitude or longitude;
  - a fake-location point creates a `tracking_flags` row.
- **Clean-up:** all test rows are deleted.
- **Not covered live** until `FACE_PROVIDER=faceapi`: a token issued by a real check-in. A unit test covers the helper that builds the session row.
