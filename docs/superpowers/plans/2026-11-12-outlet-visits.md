# Outlet Visits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sales Rep or Supervisor records each outlet visit from the phone they clocked in with, using a face scan. The daily report and HR alerts compare visits with live tracking, and no coordinates are kept.

**Architecture:**
- **Shared rules** in `_shared/rules/tracking.js` parse a visit and build its row; the row holds a distance, never coordinates.
- **Database:** an `outlet_visits` table readable only by the HR user's companies, plus a private counter for failed visit face scans.
- **Edge Function:** `GET` and `POST /tracking/visits`, authenticated by the tracking token. The existing report passes visits to `visitProof`, and `syncNotifications` raises three visit alerts.
- **Phone screen:** a minimal `/visit` page and a small `visitService.js`. The check-in page saves the token.

**Tech Stack:**
- Postgres (Supabase) with RLS;
- an Edge Function on Deno with Hono 4.6.14;
- React 19 with Vite;
- vitest for unit tests;
- a Node smoke script for live checks.

**Spec:** `docs/superpowers/specs/2026-11-12-outlet-visits-design.md`

## Global Constraints

- **Who may record visits:** Sales Reps and Supervisors only (`categoryForPosition` gives `sales-rep` or `supervisor`). Merchandisers are refused with 409 `Only Sales Representatives and Supervisors record outlet visits.`
- **Authentication:** the tracking token from today's check-in, with the session open. A closed session gives `409 { code: 'session_closed' }`, and an unknown token gives `401 { code: 'invalid_token' }`. Reuse the session lookup and closing logic from `api/tracking.ts`.
- **No coordinates:** an `outlet_visits` row never holds a latitude or longitude, only `distance_m` and `gps_accuracy`. No face photo is stored.
- **Failed scans:** after `MAX_VISIT_FACE_ATTEMPTS = 5` failed visit scans, visits are locked for the day with 423 `Visits are locked for today after 5 face scans that did not match. Contact HR.` The kiosk's own counter (`face_attempts`) is never touched.
- **Messages, verbatim:**
  - `Choose the outlet you are visiting.`
  - `Enter the outlet name.`
  - `Enter the town or area.`
  - `That outlet is not in the shop directory.`
- **Alert wording:** every alert description ends with "This is a reason to ask, not proof of misconduct. Attendance is not changed."
- **Commands:** the same as the Live Tracker plan: type check, migrations, deploy and `npx vitest run`. Lint uses `npx oxlint -D no-undef src`; ignore the known browser-global false positives. Build uses `npx vite build`.
- **Live state:** `FACE_PROVIDER` is `rekognition` live. The smoke steps that need a face match find the provider through `GET /hr/me` (`faceProvider`) and report themselves as **skipped** unless it is `faceapi`.

## Review Focus

1. **A visit posted at the moment of clock-out:** it is refused or stored inside the session, never after `clock_out_at`. The insert goes through an RPC that re-checks the session under a lock.
2. **The sixth failed scan, or two failed scans at once:** the counter is atomic; the person is locked at exactly 5, and the kiosk can still check them out.
3. **A `shopId` from another company, or an inactive shop:** the same 400 message as an unknown shop, with no hint that the shop exists.
4. **Location refused, or coordinates out of range:** the visit is still stored as `location-unavailable`, with `distance_m` null.
5. **`shop-missed` and `visit-not-proven` alerts during the working day:** none are raised before the day is over. Only `visit-off-list` is raised at once.

---

### Task 1: Shared visit rules

**Files:**
- Modify: `supabase/functions/_shared/rules/tracking.js`
- Test: `tests/outlet-visits.test.js`

**Interfaces:**
- Produces:
  - `MAX_VISIT_FACE_ATTEMPTS = 5`
  - `parseVisitOutlet(body): { shopId } | { name, town } | { error }`. `body.shopId` (trimmed, non-empty) wins. Otherwise `body.outlet.{name,town}` is cleaned of extra spaces and must be at least 2 characters each.
  - `parseVisitLocation(body): { latitude, longitude, accuracy } | null`
  - `visitRow({ session, outlet, shop, listIds, location, score, now }): object`, with exactly these keys:
    - `staff_id`, `company_id`, `session_id`, `date` (from `session`);
    - `occurred_at` (`now`);
    - `shop_id`, `outlet_name`, `outlet_town`;
    - `on_list`;
    - `status`;
    - `distance_m`, `gps_accuracy`, `face_score`.
  - `visitFromRow(row): { id, time, outlet: { shopId, name, town }, onList, distanceM, status }`, the shape `visitProof` and the API use.

- [ ] **Step 1: Write the failing tests.**
  - **`parseVisitOutlet`:**
    - `{shopId:' s1 '}` → `{shopId:'s1'}`;
    - `{outlet:{name:'  Mama  Shop ', town:'Osu'}}` → `{name:'Mama Shop', town:'Osu'}`;
    - `{}` → the choose error;
    - name `'M'` → the name error;
    - town `''` → the town error.
  - **`parseVisitLocation`:**
    - valid `{location:{latitude:5.6, longitude:-0.18, accuracy:12}}` → that object;
    - `{location:null}` → null;
    - latitude 95 → null;
    - a string latitude `'5.6'` → null.
  - **`visitRow`**, for a shop at (5.6, -0.18) and a location 40 m east:
    - `distance_m` about 40, `status 'recorded'`, `on_list true` when the shop is in `listIds`;
    - `Object.keys(row)` contains no `latitude` or `longitude`;
    - no location → `status 'location-unavailable'`, `distance_m` null;
    - a typed-in outlet → `shop_id` null, `on_list false`, the outlet name and town set;
    - a shop with no coordinates → `distance_m` null, `status 'recorded'`.
  - **`visitProof` with real visits** (the existing function, `shopsById` with s1 measurable and s2 without coordinates, list `['s1','s2']`):
    - a visit to s1 with stays `{s1:{longestMinutes:4}}` → s1 `no-stay`;
    - a visit to s2 → s2 `unmeasured`;
    - a visit to s3, a directory shop off the list → `offList[0].status` is `off-list`;
    - a typed-in visit → `not-in-list`;
    - s1 with a 12-minute stay and a visit → `proven`;
    - `counts.flagged` counts no-stay, missed, off-list and not-in-list.
- [ ] **Step 2: Run** `npx vitest run tests/outlet-visits.test.js`. Expected: FAIL, because the functions don't exist.
- [ ] **Step 3: Implement** in `tracking.js`, reusing `distanceMetres`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Add shared rules for outlet visits".

### Task 2: Database

**Files:**
- Create: `supabase/migrations/20261112190000_outlet_visits.sql`

**Interfaces:**
- Produces:
  - The tables `outlet_visits` and `visit_face_attempts`, exactly as in the spec.
  - `public.record_visit_face_failure(p_staff text, p_date date) returns integer`: an atomic upsert-and-increment that returns the new count.
  - `public.record_visit(p_session uuid, p_visit jsonb) returns jsonb`:
    - lock the session `for update`;
    - if it is closed, return null;
    - otherwise insert the row with `occurred_at = now()`, taking `staff_id`, `company_id` and `date` from the session, and return the inserted row as jsonb.
  - Both functions are service role only.

- [ ] **Step 1: Write the migration.**
  - Create the tables and indexes.
  - Enable and force RLS, revoke, and grant to `service_role`, on both tables.
  - Add the `hr_read` policy and `grant select to authenticated` on `outlet_visits` only.
  - Create both functions.
  - Add `outlet_visits` to `apply_change`: copy the latest body from `20261112170000_live_tracker.sql` and add it to `writable`.
- [ ] **Step 2: Apply it live.** Expected: no error.
- [ ] **Step 3: Verify live with SQL:**
  - `has_table_privilege('authenticated','public.visit_face_attempts','select')` is false;
  - `has_table_privilege('authenticated','public.outlet_visits','select')` is true;
  - `select count(*) from information_schema.columns where table_name='outlet_visits' and column_name in ('latitude','longitude')` is 0;
  - `select public.record_visit_face_failure('NOPE-0000', current_date)` raises a foreign-key error, so the function exists and checks the staff ID.
- [ ] **Step 4: Commit** with the message "Add outlet visits to the database".

### Task 3: The phone's visit endpoints

**Files:**
- Modify: `supabase/functions/api/tracking.ts`
  - export `sessionFor(token)` and `openSessionOrClose(session, now)`, the existing closed and day-end checks moved into one helper;
  - add `GET` and `POST /tracking/visits`.
- Create: `scripts/smoke-outlet-visits.mjs`

**Interfaces:**
- Consumes:
  - from Task 1, `parseVisitOutlet`, `parseVisitLocation`, `visitRow`, `visitFromRow` and `MAX_VISIT_FACE_ATTEMPTS`;
  - from Task 2, `record_visit` and `record_visit_face_failure`;
  - `compareFaces` from `_shared/faceMatcher.ts` and `faceSample` / `readable` from `enrolment.ts`, as `public.ts` uses them;
  - `employee_shops` from project 1.
- Produces:
  - `GET /tracking/visits` → `{ shops: [{ shopId, shopName, hasLocation, visited }], visits: Visit[], attemptsLeft }`
  - `POST /tracking/visits` → 201 `{ visit }`, or 403 `{ code: 'face-mismatch', attemptsLeft, lockedOut }`

- [ ] **Step 1: Write the smoke script.**
  - **Helpers:** copy them from `scripts/smoke-live-tracker.mjs` (`makeHr`, `checkIn`, `checkOut` and so on), with the prefixes `smoke-visit-` and "Smoke Visits".
  - **Setup:** two shops for Box For Less, one with coordinates; a Sales Rep and a Merchandiser added through HR, each with a session made by SQL.
  - **Checks that always run:**
    - `GET /tracking/visits` for the rep → 200, with 1 shop and `attemptsLeft` 5;
    - `POST` as the Merchandiser → 409 with the role message;
    - `POST` with `shopId` set to a Double A shop → 400 `That outlet is not in the shop directory.`;
    - `POST` with no outlet → 400 with the choose message;
    - after a check-out event by SQL, `POST` → 409 `session_closed`;
    - an unknown token → 401.
  - **Checks that need a face match**, run only when `GET /hr/me` reports `faceProvider === 'faceapi'` (otherwise print `skip` lines):
    - insert a `face_templates` row for the rep in the face-api format, by reading `_shared/faceMatcher.ts` and `scripts/smoke-employee.mjs` for the reading format, then post a matching visit 40 m from the shop → 201, with `distance_m` about 40 in SQL and no coordinate columns;
    - five mismatched posts → the fifth reports `lockedOut`, and the sixth gets 423;
    - `face_attempts` for the rep is still 0.
  - **Clean-up:** like the tracker smoke, plus `outlet_visits`, `visit_face_attempts` and `face_templates`.
- [ ] **Step 2: Run** `node scripts/smoke-outlet-visits.mjs`. Expected: FAIL with 404 on `/tracking/visits`.
- [ ] **Step 3: Implement.**
  - **Refactor first:** move `POST /tracking/points`'s session checks into `openSessionOrClose`, keeping its behaviour, and rerun the tracker smoke to confirm it still passes.
  - **`GET /tracking/visits`:** session from the token; open check; the employee's list joined with shop names and `latitude is not null`; today's visits for the session; `attemptsLeft = 5 − failed`.
  - **`POST /tracking/visits`, in this order:**
    1. Rate limit (`visits:token`, 30 per 600 s; `visits:ip`, 300 per 600 s).
    2. Open session.
    3. Load the employee; refuse untracked roles and Merchandisers.
    4. Check the lock (`failed >= 5` gives 423).
    5. Parse the outlet; if it is a shop, check it is an **active** shop of the company, otherwise 400.
    6. Parse the location.
    7. `faceSample(body)` and `readable(() => compareFaces(enrolled, face, loadEnrolledPhoto))`. On a mismatch, call `record_visit_face_failure` and return 403. On a match, call `record_visit` with `visitRow(...)`. If it returns null, the session closed during the scan: return 409 `session_closed`.
    8. `later(syncNotifications())`, then 201.

    `loadEnrolledPhoto` moves from `public.ts` into `enrolment.ts` and is exported, so both routes share it.
  - Type check and deploy.
- [ ] **Step 4: Run** both smoke scripts and `npx vitest run`. Expected: all pass, with the face checks skipped while live is `rekognition`.
- [ ] **Step 5: Commit** with the message "Let field staff record outlet visits from their clocked-in phone".

### Task 4: The report and alerts

**Files:**
- Modify:
  - `supabase/functions/api/trackingDays.ts`: the report loads the day's `outlet_visits` for the company and passes `visitFromRow` results to `visitProof`; `visits` becomes the count for Sales Reps and Supervisors;
  - `supabase/functions/_shared/rules/notificationTypes.js`: add `visit-not-proven` (medium), `shop-missed` (medium) and `visit-off-list` (low), all `sales-monitoring` and `exception`;
  - `supabase/functions/_shared/rules/notifications.js`: add `detectVisitIssues`;
  - `supabase/functions/api/facts.ts`: in `syncNotifications`, build the inputs and call `detectVisitIssues`.
- Test: `tests/visit-alerts.test.js`

**Interfaces:**
- Produces:
  - `detectVisitIssues(days: { employee, date, dayOver, proof }[], push)`. `proof` is a `visitProof` result.
    - When `dayOver`, it raises one `visit-not-proven` for each listed shop with status `no-stay`, and one `shop-missed` for each `missed`.
    - Always, it raises one `visit-off-list` for each `offList` entry.
    - Source keys:
      - `visit-no-stay:<staff>:<date>:<shop>`
      - `visit-missed:<staff>:<date>:<shop>`
      - `visit-off-list:<visitId>`
  - `visitDayInputs(...)`, a helper in `trackingDays.ts` exported for `facts.ts`. For each Sales Rep and Supervisor with a record on each scanned date, it builds `{ employee, date, dayOver, proof }`, using summaries for past days and the live trail for today, exactly as the report does. The report also uses this helper, so the two can't drift apart.

- [ ] **Step 1: Write the failing tests.**
  - A no-stay listed shop with `dayOver: false` → no issue; with `dayOver: true` → one `visit-not-proven` with the right source key and the "not proof of misconduct" sentence.
  - `missed` with `dayOver: true` → `shop-missed`.
  - Off-list and not-in-list visits → `visit-off-list` while the day is still on, keyed by visit id.
  - All three types are in `NOTIFICATION_TYPES` with the right severities.
- [ ] **Step 2: Run** `npx vitest run tests/visit-alerts.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Refactor the report's per-row proof into `visitDayInputs`, so the report and the alerts share it.
  - Wire it into `syncNotifications` for the scanned dates. Dates without tracking just get `stays: null`, which matches the report.
- [ ] **Step 4: Add smoke checks**, which need a face match and are skipped otherwise. After the matching visit from Task 3 (a visit with no stay), today's report row shows `visits` 1. Then, with a past-dated visit inserted by SQL for yesterday at a listed shop with no points, yesterday's report shows `shops.flagged` ≥ 1. The second check can always run, because SQL can insert the visit: put it outside the face condition.
- [ ] **Step 5: Run** `npx vitest run`, type check, deploy, and run the smoke script. Expected: all pass.
- [ ] **Step 6: Commit** with the message "Count visits in the daily report and alert HR to unproven and missed visits".

### Task 5: The phone screen

**Files:**
- Create: `src/services/visitService.js`, `src/pages/RecordVisit.jsx`
- Modify:
  - `src/pages/AttendanceCheckIn.jsx`: save and clear the session, and add the button;
  - `src/App.jsx`: route `/visit` to the lazy `RecordVisit` page.
- Test: `tests/visit-service.test.js`

**Interfaces:**
- Produces, all from `src/services/visitService.js`:
  - `SESSION_KEY = 'tracking:session'`
  - `saveTrackingSession(event)`: stores `{ token, closesAt, staffId }` when `event.trackingToken` is set, and removes the key when `event.type === 'check-out'`.
  - `trackingSession(): object | null`, null when nothing is stored or `closesAt` has passed.
  - `getVisitsToday()`
  - `recordVisit({ shopId?, outlet?, location, faceImage, faceDescriptor })`
  - Both calls `fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/tracking/visits`)` with `Authorization: Bearer <token>`. A failure throws an `Error` carrying `status` and `data`. On `session_closed`, the saved session is cleared before throwing.

- [ ] **Step 1: Write the failing tests**, mocking `localStorage` and `fetch` with `vi.stubGlobal`:
  - `saveTrackingSession({ type:'check-in', trackingToken:'t', trackingClosesAt:<future>, staffId:'X' })` → `trackingSession().token` is `'t'`;
  - a check-out → null;
  - an expired `closesAt` → null;
  - `getVisitsToday()` sends the bearer token;
  - a 409 `session_closed` response → it throws, and `trackingSession()` becomes null.
- [ ] **Step 2: Run** `npx vitest run tests/visit-service.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement the service, then the screens.**
  - **Check-in page:** call `saveTrackingSession(event)` after `setResult(event)`. On the success step, when `trackingSession()` is set and `event.type === 'check-in'`, show a "Record a visit" link to `/visit`.
  - **`RecordVisit.jsx`:**
    - With no session, it says "Clock in first. Visits can only be recorded while you are clocked in."
    - Otherwise it loads `getVisitsToday()` and shows the listed shops as radio choices, ticking those already visited, plus an "Other outlet" choice with name and town fields.
    - "Scan face and save":
      - read `navigator.geolocation.getCurrentPosition` (high accuracy, 10 s timeout, `null` on failure);
      - capture the face with the camera code pattern from `AttendanceCheckIn.jsx` (`captureFrame`, `describeFace`, `preloadFaceModels`);
      - call `recordVisit`.
    - **Messages:**
      - success shows "Visit recorded at <shop> — <n> m from the shop" or "— location not available";
      - a mismatch shows the attempts left;
      - 423 shows the locked message;
      - `session_closed` shows the clocked-out message.
    - It reuses `registration.css` classes and adds no new stylesheet.
- [ ] **Step 4: Run** `npx vitest run`, `npx oxlint -D no-undef src` and `npx vite build`. Expected: tests pass, no new lint findings beyond the known ones, and the build succeeds.
- [ ] **Step 5: Check it in the dev server.** Open http://localhost:5173/visit with no saved session: the "Clock in first" message shows, and the browser console has no errors.
- [ ] **Step 6: Commit** with the message "Add the Record a visit screen for field staff".

### Task 6: Docs

**Files:**
- Modify: `README.md`, with one paragraph under the Live Tracker bullet about outlet visits, and `node scripts/smoke-outlet-visits.mjs` added to the live checks.

- [ ] **Step 1:** Make the edits. Run `npx vitest run` and both smoke scripts. Expected: all pass, with the face checks skipped.
- [ ] **Step 2: Commit** with the message "Document outlet visits".
