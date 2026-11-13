# Live Tracker Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Field staff's phones send location points only between clock-in and clock-out. HR sees the latest position live through Realtime, and a daily report. Each day's trail is summarised without coordinates, then deleted.

**Architecture:**
- **Shared rules:** `_shared/rules/tracking.js`, copied from the frontend's algorithms, so the numbers match the tracker spec's §8.
- **Database:** five new tables with company RLS. A trigger on `attendance_events` closes sessions. One RPC, `record_points`, stores a batch atomically. Two `pg_cron` jobs: the nightly close through the jobs secret, and a plain-SQL 48-hour sweep.
- **Edge Function:** issues the token at check-in, receives points, closes days and serves the daily report.

**Tech Stack:**
- Postgres (Supabase) with RLS, `pg_cron` and the Realtime publication;
- an Edge Function on Deno with Hono 4.6.14;
- vitest for unit tests;
- a Node smoke script for live checks, with `@supabase/supabase-js` Realtime.

**Spec:** `docs/superpowers/specs/2026-11-12-live-tracker-design.md`

## Global Constraints

- **Tracked roles:** `needsShopList(position)` from `_shared/rules/categories.js` decides who is tracked. Nobody else ever gets a token.
- **Constants**, verbatim from the spec:
  - `MIN_SECONDS = 20` and `MIN_METRES = 15` (thinning);
  - `MAX_POINTS_PER_DAY = 2000`;
  - `LIVE_STALE_MINUTES = 5`;
  - `NOISY_ACCURACY_M = 100`;
  - `GPS_TOLERANCE_M = 100`;
  - `STAY_GAP_MINUTES = 5`;
  - `MIN_STAY_MINUTES = 10`;
  - `MAX_FUTURE_MS = 120000`;
  - `MAX_AGE_MS = 43200000`;
  - `MAX_SPEED_KMH = 200`.
- **Server time decides.** `clock_in_at`, `clock_out_at` and `received_at` are server times. The phone's `recordedAt` is checked only against the session window.
- **No coordinates are kept after the day.** `tracking_day_summaries` and `tracking_flags` have no latitude or longitude.
- **Error codes:**
  - `409 { code: 'session_closed' }` after the session ends;
  - `401 { code: 'invalid_token' }` for an unknown token.
- **The token** is 32 random bytes in base64url. Only `sha256Hex(token)` is stored, and HR can never select `token_hash`.
- **Alert wording:** alerts say "This is a reason to ask, not proof of misconduct. Attendance is not changed." They never touch attendance.
- **Commands:**
  - Type check: `cd supabase/functions && npx -y deno check --node-modules-dir=none api/index.ts`, then `rm -f deno.lock`.
  - Migrations: `npx supabase db query --remote=aiiglvsvrbtahihttwge --yes -f <file>`.
  - Deploy: `npx supabase functions deploy api --project-ref aiiglvsvrbtahihttwge --yes`.
  - Unit tests: `npx vitest run`.
- **Live state:** `FACE_PROVIDER` is `rekognition` live, so a real check-in cannot run. The smoke script makes check-ins and sessions with SQL, the way the server does.
- **Audit:** `audit_events` is append-only.

## Review Focus

1. **A batch with points out of order, or two points with the same `recordedAt`:** the points are sorted before thinning, and the speed check never divides by zero, because the 1 s minimum applies.
2. **Two batches for one session at the same moment:** the 2,000-a-day cap and the thinning may slip by at most one batch. Nothing errors, and nothing is stored after clock-out.
3. **Clock-out committing while a batch is being screened:** `record_points` re-filters on `recorded_at <= clock_out_at`, so no point after clock-out is ever stored.
4. **An overnight shift,** where `closes_at` falls on the next calendar day: points keep the session's `date`, and the nightly close for the next date does not cut the session short before `closes_at`.
5. **Today's report for someone who has clocked out:** it summarises up to `clock_out_at`, not up to now. For someone still clocked in, it summarises up to now.

---

### Task 1: Shared tracking rules

**Files:**
- Create: `supabase/functions/_shared/rules/tracking.js`
- Test: `tests/tracking.test.js`

**Interfaces:**
- Produces:
  - All the constants in Global Constraints.
  - `distanceMetres(a, b): number | null`
  - `summariseTrail(points: {latitude, longitude, accuracy, at}[], startIso, endIso)` → `{ points, firstAt, lastAt, trackedMinutes, coveredMinutes, coverage, signalLost, longestGapMinutes, distanceM }`
  - `shopStays(points, shops: {shopId, latitude, longitude}[])` → `{ [shopId]: { minutes, longestMinutes, closestM } }`
  - `visitProof({ listIds, shopsById: Map, visits, stays, dayOver })` → `{ listed, offList, counts: { listed, proven, visited, missed, flagged } }`
  - `trackingResult({ clockIn, summary })` → `'good'|'partial'|'poor'|'no-signal'|'not-clocked-in'`
  - `screenPoints({ session: {clock_in_at, clock_out_at}, last: {latitude, longitude, recorded_at} | null, storedToday: number, points: unknown[], now: Date })` → `{ keep: {latitude, longitude, accuracy, recorded_at, is_mock, flagged}[], rejected: number, flags: { mock: number, speed: number } }`. Accepted equals the input length minus `rejected`.
  - `sessionClosesAt(dateKey, hours, rules): string`, the ISO time `accraIso(dateKey, shiftWindowMinutes(hours).end) + rules.clockOutWindowMinutes` minutes.

- [ ] **Step 1: Write the failing tests.** Use a helper `pt(minute, metresEast = 0, extra = {})` that places a point near (5.6, -0.18), moved `metresEast` east, at `2026-11-12T09:00Z` plus `minute`.
  - **`summariseTrail`:**
    - 31 points at minutes 0–30 over 09:00–10:00 → `coveredMinutes` 35, coverage about 0.583 (`toBeCloseTo(0.583, 2)`), `signalLost` 1, `longestGapMinutes` 30.
    - `[]` → coverage 0, `signalLost` 1, and `longestGapMinutes` equal to `trackedMinutes` 60.
    - Two points 1 km apart with accuracy 10 → `distanceM` about 1000. The same with one point at accuracy 500 → `distanceM` 0.
  - **`shopStays`**, for a shop at (5.6, -0.18):
    - points every 3 minutes from 0 to 12, 20 m away → `longestMinutes` 12;
    - points at 0, 4, 15 and 19 → `longestMinutes` 4;
    - a point 2 km away → `closestM` about 2000.
  - **`visitProof`:**
    - stays `{ s1: { longestMinutes: 12 } }` with list `['s1']` → `listed[0].status` is `'proven'`;
    - stays of 4 with `dayOver` false → `'pending'`; with `dayOver` true → `'missed'`.
  - **`trackingResult`:**
    - coverage 0.95 → good; 0.7 → partial; 0.3 → poor;
    - `{clockIn: 'x', summary: {points: 0}}` → no-signal;
    - no `clockIn` → not-clocked-in.
  - **`screenPoints`**, for a session from 08:00 to 17:00:
    - `recordedAt` 16:59:59 is kept and 17:00:01 is rejected;
    - with `clock_out_at` null and `now` at 12:00: 12:02:00 is kept, 12:02:01 is rejected, and 23:59 the day before is rejected;
    - 07:59:59 is rejected;
    - `latitude: 'x'` and `latitude: 95` are rejected;
    - two points 5 s and 3 m apart → `keep` has 1 and `rejected` 0;
    - `storedToday: 1999` with two far-apart points → `keep` 1, `rejected` 1;
    - `isMock: true` → kept with `flagged: 'mock'` and `flags.mock` 1;
    - two points 10 s and 1 km apart (360 km/h) → the second is `flagged: 'speed'`;
    - points given out of order → `keep` is sorted.
  - **`sessionClosesAt('2026-11-12', {startTime:'08:00', endTime:'17:00'}, {clockOutWindowMinutes: 360})`** → `'2026-11-12T23:00:00.000Z'`.
- [ ] **Step 2: Run** `npx vitest run tests/tracking.test.js`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement** `tracking.js`.
  - Copy `summariseTrail` from `origin/frontend/live-tracker-updates:src/services/locationTrackingService.js` and `shopStays`/`visitProof` from `…/visitListService.js`.
  - Changes: rename `closest` to `closestM`; in `visitProof`, take shops from `shopsById` and drop `visitDistance` (no visits until project 3); `scans` comes from `visits` with `outlet.shopId`.
  - `screenPoints` reads `p.latitude`, `p.longitude`, `p.accuracy`, `p.recordedAt` and `p.isMock`, reading at most the first 500 points.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Add shared live tracking rules".

### Task 2: Database

**Files:**
- Create: `supabase/migrations/20261112170000_live_tracker.sql`

**Interfaces:**
- Consumes: none.
- Produces:
  - The five tables, with the exact columns in the spec.
  - Trigger `close_tracking_session` on `attendance_events`.
  - `public.record_points(p_session uuid, p_points jsonb, p_flags jsonb, p_latest jsonb) returns integer`, which returns the number of points stored and is service role only.
    - `p_points` is an array of `{latitude, longitude, accuracy, recorded_at, is_mock, flagged}`.
    - `p_flags` is an array of `{kind, points, first_at, last_at}`.
    - `p_latest` is `{latitude, longitude, accuracy, recorded_at}` or null.
  - `apply_change` can write all five tables, and can delete from `location_points`, `tracking_latest` and `tracking_sessions`.
  - Cron jobs `tracking-close-day` (`20 0 * * *`, `app_private.call_job('tracking-close-day')`) and `tracking-sweep` (`15 3 * * *`, plain SQL).

- [ ] **Step 1: Write the migration.**
  - **Tables and indexes:** from the spec.
  - **Security:** the `do $$` loop that enables and forces RLS, revokes, and grants to `service_role`, the same as `20261112160000_employee_shop_lists.sql`.
    - Add the `hr_read` policy on all five tables.
    - `grant select` to `authenticated` on four tables. On `tracking_sessions`, grant only the column list without `token_hash`.
  - **Realtime:** `alter publication supabase_realtime add table public.tracking_latest`.
  - **Trigger function:** `security definer`, `search_path = ''`, as in the spec. It ignores types other than `check-out` and `face-lockout`.
  - **`record_points`:**
    - Lock the session row (`for update`). If its status is `closed` and it has no `clock_out_at`, return 0.
    - Insert only the points with `recorded_at >= clock_in_at`, and `recorded_at <= clock_out_at` when that is set. Take `staff_id`, `company_id` and `date` from the session.
    - Upsert `tracking_flags`: add to `points`, keep the least `first_at` and the greatest `last_at`.
    - When `p_latest` is not null, upsert `tracking_latest`, setting `session_status` from the session and `updated_at = now()`.
    - Return the number of inserted points.
  - **`apply_change`:** `create or replace`, copying the whole body from `20261112160000_employee_shop_lists.sql` and adding the tables to `writable`/`deletable`.
  - **The two `cron.schedule` calls.** The sweep runs:
    - `delete from public.location_points where received_at < now() - interval '48 hours'`;
    - `delete from public.tracking_latest where date < (now() at time zone 'Africa/Accra')::date - 1`.
- [ ] **Step 2: Apply it live.** Expected: no error.
- [ ] **Step 3: Verify live with SQL:**
  - `select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='tracking_latest'` is 1;
  - `select has_column_privilege('authenticated','public.tracking_sessions','token_hash','select')` is false;
  - `select jobname from cron.job where jobname like 'tracking-%'` returns both jobs;
  - `select tgname from pg_trigger where tgname like '%tracking%'` returns the trigger.
- [ ] **Step 4: Commit** with the message "Add live tracking tables, trigger and jobs".

### Task 3: Token at check-in, and points endpoint

**Files:**
- Create: `supabase/functions/api/tracking.ts`, mounted in `index.ts` with `app.route('/', publicTrackingRoutes)` before `publicRoutes`.
- Modify: `supabase/functions/api/public.ts` (`POST /attendance/events`, and `siteRequired` in `kioskDay`).
- Create: `scripts/smoke-live-tracker.mjs`.

**Interfaces:**
- Consumes: from Task 1, `screenPoints`, `sessionClosesAt` and `needsShopList`. From Task 2, `record_points` and the tables.
- Produces:
  - `openTrackingSession(employee: {staff_id, company_id, position}, event: {date, occurred_at}, closesAt: string): Promise<{ token: string, closesAt: string } | null>`, exported from `tracking.ts`. It returns null for untracked roles and on failure, and logs the error.
  - `POST /tracking/points`.

- [ ] **Step 1: Write the smoke script.**
  - **Helpers:** copy the helpers from `scripts/smoke-shop-lists.mjs`, with HR users `smoke-track-*`.
  - **Setup:**
    - Make a test Sales Rep through HR `POST /hr/employees`, named "Smoke Tracker …", with one temporary shop at known coordinates.
    - Make a check-in by SQL: insert into `attendance_events` with `type 'check-in'`, today's Accra `date`, `occurred_at = now() - 30 min`, `status 'on-time'`, `source 'smoke'`.
    - Make the session: insert into `tracking_sessions` with `token_hash = encode(sha256(convert_to('<token>','utf8')),'hex')`, `clock_in_at` = the check-in time, `closes_at = now() + 6 h` and `date` today.
  - **Checks:**
    - three valid points (now−10 min, −5 min, −1 min, each more than 15 m apart) → 200 `{accepted: 3, rejected: 0, sessionOpen: true}`;
    - a point 10 min before clock-in → `rejected: 1`;
    - an unknown token → 401 `invalid_token`;
    - `tracking_latest` row `recorded_at` equals the last point;
    - an `isMock` point → a `tracking_flags` row with kind `mock`.
    - **Clock-out:** insert a `check-out` event by SQL with `occurred_at = now()`. The trigger leaves the session `closed` with `clock_out_at` set. The next POST → 409 `session_closed`.
    - **Clock-out boundary:** on a second test employee and session, closed by a check-out event at T, a point at T−1 s posted after the close is refused (409, because the session is closed). Instead, call `record_points` directly by SQL with points at T−1 s and T+1 s: it stores 1.
    - **Expired session:** `closes_at` in the past → 409, and the session becomes `day-end`.
  - **Clean-up:** delete the test rows from every tracking table, then `attendance_events`, `employee_shops`, `employee_shop_changes`, `shop_assignments`, `employees`, `shops` and the HR users.
- [ ] **Step 2: Run** `node scripts/smoke-live-tracker.mjs`. Expected: FAIL with 404 on `/tracking/points`.
- [ ] **Step 3: Implement.**
  - **`tracking.ts`:**
    - Read the bearer token, compute `sha256Hex`, and load the session by `token_hash`.
    - Rate limit `points:token:<first 16 hex>` at 120 per 600 s, and `points:ip:<ip>` at 600 per 600 s.
    - Refuse a body over 64 KB (check `content-length` and the raw text length) or more than 500 points with 400.
    - Refuse `closed` with 409. When `now >= closes_at`, update the session to `closed`/`day-end`, then refuse with 409.
    - `last` is the newest point for the session (`order recorded_at desc limit 1`). `storedToday` is the count for the session.
    - Run `screenPoints`, then `rpc('record_points', …)`, with `p_latest` = the newest kept point.
    - The response is `{ accepted: points.length - rejected, rejected, sessionOpen: true }`.
  - **Check-in, in `public.ts`:** after a `check-in`, call `openTrackingSession(employee, event, sessionClosesAt(date, hours, rules))`. `kioskDay` must also return `hours` and `rules`. Add `trackingToken` and `trackingClosesAt` to the response only when the session opened.
  - **Kiosk:** `siteRequired` uses `needsShopList(employee.position)`.
  - **Mount** the routes, type check and deploy.
- [ ] **Step 4: Unit-test `openTrackingSession`.** In `tests/tracking-session.test.js`, mock `lib.ts` `db` and `sha256Hex`: an untracked position ('Cashier') → null with no insert; 'Sales Representative' → inserts a row whose `token_hash` is the hash of the returned token. If Deno-style imports (`npm:`) block vitest, move the row-building into a pure `trackingSessionRow(employee, event, closesAt, tokenHash)` in `tracking.js` and test that instead. Record a Ruling if so.
- [ ] **Step 5: Run** the smoke script and `npx vitest run`. Expected: all pass.
- [ ] **Step 6: Commit** with the message "Issue tracking tokens at check-in and accept location points".

### Task 4: End of day and the daily report

**Files:**
- Create: `supabase/functions/api/trackingDays.ts`, exporting `closeDay`, `closePastDays` and `hrTrackingRoutes`. Mount `hrTrackingRoutes` in `hr.ts` with `hrRoutes.route('/', hrTrackingRoutes)`.
- Modify:
  - `supabase/functions/api/jobs.ts`: add `POST /tracking-close-day`;
  - `supabase/functions/api/tracking.ts`: start the backup with `later(closePastDays())` when the session's `date` is today and there are points or open sessions dated before today;
  - `scripts/smoke-live-tracker.mjs`.

**Interfaces:**
- Consumes: from Task 1, `summariseTrail`, `shopStays`, `visitProof` and `trackingResult`. From Task 2, the tables and `apply_change`. From project 1, `employee_shops` and `needsShopList`.
- Produces:
  - `closeDay(date: string): Promise<{ closed: number, summarised: number }>`
  - `closePastDays(today = accraDateKey()): Promise<number>`
  - `GET /hr/tracking/reports/daily`

- [ ] **Step 1: Add the smoke checks.**
  - **Yesterday's data:** create a session and points by SQL for yesterday (Accra), with 31 points one minute apart within 30 m of the test shop. Give the session `clock_out_at` = clock-in + 60 min and status `closed`.
  - **Report for yesterday:** `GET /hr/tracking/reports/daily?companyId=box-for-less&date=<yesterday>` as a Box-For-Less HR user returns:
    - 200, with the test employee's row: `trackedMinutes` 60, `coverage` about 0.58, `signalLost` 1, `result 'poor'`, and `shops.proven` 1 (a 30-minute stay);
    - then, in SQL: no `location_points` remain for that session; one `tracking_day_summaries` row with `shop_stays -> <shopId> ->> 'longestMinutes'` = '30'; and no `latitude` key anywhere in `shop_stays::text`.
  - **Report for today:** the Task 3 employee shows `result` other than `not-clocked-in`, with points of at least 3.
  - **Bad input:** `date` in the future → 400. A Double-A-only HR user asking for `box-for-less` → 403.
- [ ] **Step 2: Run** the smoke script. Expected: FAIL with 404 on the report.
- [ ] **Step 3: Implement.**
  - **`closeDay(date)`:**
    - Close the date's open sessions where `closes_at <= now()` with `day-end`, which leaves overnight sessions alone (Review Focus 4).
    - For each closed session that day with points, or with no summary yet, build the summary:
      - `summariseTrail(points, clock_in_at, clock_out_at ?? lastPoint ?? clock_in_at)`;
      - `shopStays` over the employee's list shops, which have coordinates;
      - `mock_points` and `speed_points` from `tracking_flags`.
    - Then one `apply_change`: upsert the summary (conflict `staff_id,date`), and delete `location_points` matching `{session_id}`.
    - Finally, delete `tracking_latest` rows with `date < today`.
  - **`closePastDays`:** the distinct dates before today found in `location_points` or in open `tracking_sessions`, each run through `closeDay`.
  - **Report:**
    - Run `closePastDays()` first when the requested date is before today.
    - Load the records with `loadFacts({from: date, to: date})` and `buildRecords`, keeping tracked categories and the `role` filter.
    - Get each row's summary from `tracking_day_summaries` (past) or `summariseTrail` over today's points up to `clockOut ?? now` (Review Focus 5).
    - `shops` comes from `visitProof` with `dayOver = !isToday || clockOut || now >= expectedEnd`, for Sales Reps and Supervisors only.
    - The rows and totals are in the spec's §4.3 shape. Sort by `fullName`.
  - **Jobs:** the jobs route calls `closePastDays()` and returns its count.
  - Type check and deploy.
- [ ] **Step 4: Run** the smoke script and `npx vitest run`. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Summarise and delete each day's trail, and serve the daily report".

### Task 5: Alerts

**Files:**
- Modify:
  - `supabase/functions/_shared/rules/notificationTypes.js`;
  - `supabase/functions/_shared/rules/notifications.js`: add `detectTrackingFlags`;
  - `supabase/functions/api/facts.ts`: in `syncNotifications`, load `tracking_flags` for the scanned dates.
- Test: `tests/tracking-alerts.test.js`

**Interfaces:**
- Consumes: the `tracking_flags` rows from Task 2.
- Produces: `detectTrackingFlags(flags: {staff_id, company_id, date, kind, points, first_at, last_at}[], push, rosterById: Map)`.

- [ ] **Step 1: Write the failing test.**
  - One `mock` row for a known employee → one issue with:
    - `type 'tracking-mock-location'`, `severity 'high'`;
    - `sourceKey 'tracking-mock:<id>:<date>'`;
    - a description containing "not proof of misconduct".
  - A `speed` row → `type 'tracking-impossible-speed'`.
  - An employee missing from the roster → no issue.
  - `NOTIFICATION_TYPES` has both types with `category 'sales-monitoring'`.
- [ ] **Step 2: Run** `npx vitest run tests/tracking-alerts.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the issue shape of `detectFromRoster` (`notifications.js:192`), then wire it into `syncNotifications`.
- [ ] **Step 4: Run** `npx vitest run`, type check, then deploy. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Alert HR to fake locations and impossible speeds".

### Task 6: Realtime and company separation, then docs

**Files:**
- Modify: `scripts/smoke-live-tracker.mjs`, `README.md`.

- [ ] **Step 1: Add the smoke checks.**
  - **Realtime:** a Box-For-Less HR client (supabase-js, signed in with MFA) subscribes to `postgres_changes` on `tracking_latest`. A new point through `/tracking/points` arrives as an event within 10 s.
  - **Company separation:** a Double-A-only HR user's REST reads of `tracking_sessions`, `location_points`, `tracking_latest`, `tracking_day_summaries` and `tracking_flags`, filtered `company_id=eq.box-for-less`, all return `[]`.
  - **Token hash:** a Box-For-Less HR read of `tracking_sessions?select=token_hash` returns an error, not data.
- [ ] **Step 2: Run** the smoke script. Expected: these pass if Task 2 was right. If any fail, debug the migration (systematic-debugging) and fix it in a new migration.
- [ ] **Step 3: Update `README.md`.**
  - Add one row about the Live Tracker under the API/features section: tokens at check-in, `POST /tracking/points`, `tracking_latest` through Realtime, the daily report and the nightly delete.
  - Add `node scripts/smoke-live-tracker.mjs` to the live checks.
  - Add a note that the nightly job needs `JOBS_SECRET` plus the Vault `jobs_secret`, and that the 48-hour sweep works without them.
- [ ] **Step 4: Run** `npx vitest run` and the smoke script. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Check live tracking end to end and document it".
