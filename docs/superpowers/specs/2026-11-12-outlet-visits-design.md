# Outlet visits — design

**Date:** 12 November 2026
**Branch:** `outlet-visits`, built on `live-tracker`
**Project 3 of 3:**
- Project 1 gave field staff a list of 1 to 7 shops.
- Project 2 tracks them on duty and proves visits by stays alone.
- This project records the visit scans themselves, so HR also sees visits that tracking doesn't support, and visits to shops that aren't on the list.

**Sources:** the Live Tracker spec the user pasted on 12 November 2026 (§6, which wins over older documents), and on `origin/frontend/live-tracker-updates`:
- `fieldVisitsService.js`
- `visitListService.js` (`visitProof`, `SHOP_RESULT`, `OFF_LIST`)
- `docs/backend-live-tracker-and-sms-verification.md` §3.6 (for alerts only)

## Goal

A Sales Representative or Supervisor records each outlet visit on the phone they clocked in with: they pick the outlet, scan their face and save. The daily report and the alerts then compare visits with live tracking:
- a recorded visit without a 10-minute stay is flagged;
- so is a visit to a shop not on the list, and a typed-in outlet.

A flag is a reason for HR to ask. It is never misconduct, and it never changes attendance.

## Decisions

| # | Decision |
|---|---|
| 1 | **Who:** only Sales Representatives and Supervisors record visits (`categoryForPosition` → `sales-rep` or `supervisor`). Merchandisers are refused. |
| 2 | **How they prove who they are:** the tracking token from today's check-in is required, so only that phone can record visits, and only while the session is open. A face scan that matches the enrolled face is also required, as at check-in. |
| 3 | **Failed scans:** they have their own counter. Five failed visit scans lock visits for the rest of the day. They never lock the kiosk, so the person can always clock out. |
| 4 | **No coordinates are kept.** A visit stores the distance in metres from the phone to the shop (when both are known) and the GPS accuracy. The phone's latitude and longitude are never stored. No face photo is stored either, only the match score. |
| 5 | **Outlets:** a listed shop, another active shop of the company's directory (`off-list`), or a typed-in outlet with a name and town (`not-in-list`, which never counts as proven). |
| 6 | **Proof:** "proven" still means a stay of at least 10 minutes within 100 m (tracker spec §6). With visits recorded, `visitProof` can also give `no-stay` and `unmeasured`, plus `off-list` and `not-in-list` for visits outside the list. |
| 7 | **Alerts** (`sales-monitoring` category): see the Alerts section below. |
| 8 | **The phone screen:** a minimal page at `/visit`, opened from a "Record a visit" button that appears after a field employee's check-in. The check-in page saves `trackingToken` and `trackingClosesAt` in `localStorage` (key `tracking:session`). Your frontend developer can restyle the page. Their branch has its own version of the employee pages, so the changes here are kept small and self-contained. |

Out of scope: editing or deleting visits (HR's correction flow is separate), photos of the shop, and visits for Merchandisers.

## Shared rules

New in `_shared/rules/tracking.js`:
- `MAX_VISIT_FACE_ATTEMPTS = 5`.
- `parseVisitOutlet(body)` returns `{ shopId }`, `{ name, town }` or `{ error }`:
  - `Choose the outlet you are visiting.`
  - `Enter the outlet name.` (at least 2 characters)
  - `Enter the town or area.` (at least 2 characters)
- `parseVisitLocation(body)` returns `{ latitude, longitude, accuracy }` or `null` (location unavailable). Out-of-range coordinates count as unavailable.
- `visitRow({ session, employee, outlet, shop, location, score, now })` builds the `outlet_visits` row. It never includes coordinates:
  - with a location: `status 'recorded'` and `distance_m` = `distanceMetres(location, shop)` when the shop has coordinates;
  - without one: `status 'location-unavailable'` and `distance_m null`.
  - `on_list` says whether the shop is on the person's list.
- `visitProof` (from project 2) is unchanged. The report now passes real visits, in the shape `{ outlet: { shopId, name, town }, time }`.

## Database (one migration)

```sql
create table public.outlet_visits (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.employees (staff_id),
  company_id text not null references public.companies (id),
  session_id uuid references public.tracking_sessions (id) on delete set null,
  date date not null,
  occurred_at timestamptz not null default now(),
  shop_id text references public.shops (shop_id),
  outlet_name text,
  outlet_town text,
  on_list boolean not null,
  status text not null check (status in ('recorded', 'location-unavailable')),
  distance_m integer,
  gps_accuracy real,
  face_score real,
  check ((shop_id is not null) <> (outlet_name is not null))
);
create index outlet_visits_company_date_idx on public.outlet_visits (company_id, date);
create index outlet_visits_staff_date_idx on public.outlet_visits (staff_id, date);

create table public.visit_face_attempts (
  staff_id text not null references public.employees (staff_id),
  date date not null,
  failed integer not null default 0,
  primary key (staff_id, date)
);
```

- **Access:**
  - Both tables have RLS turned on and forced. The service role has all rights.
  - HR can read `outlet_visits` (`hr_read` policy on `company_id`). Nobody else can read `visit_face_attempts`.
- **`apply_change`:** gains `outlet_visits`. Visits are inserted through the RPC below.
- **RPC `public.record_visit_face_failure(p_staff text, p_date date, p_max integer) returns integer`:** adds one to the failed count atomically and returns the new count. Service role only.

## API

All three routes use `Authorization: Bearer <trackingToken>`, are rate-limited by token and by IP, and refuse with `409 session_closed` once the session is closed.

**`GET /tracking/visits`** returns the person's list and today's visits:

```json
{ "shops": [{ "shopId": "…", "shopName": "…", "hasLocation": true, "visited": true }],
  "visits": [{ "id": "…", "time": "…", "shopId": "…", "outletName": null, "onList": true, "distanceM": 40, "status": "recorded" }],
  "attemptsLeft": 5 }
```

**`POST /tracking/visits`** takes `{ shopId | outlet: { name, town }, location: { latitude, longitude, accuracy } | null, faceImage, faceDescriptor }`.
- **Refusals:**
  - a Merchandiser or untracked role: 409 `Only Sales Representatives and Supervisors record outlet visits.`;
  - visits locked: 423 `Visits are locked for today after 5 face scans that did not match. Contact HR.`;
  - a `shopId` that isn't an active shop of the company: 400 `That outlet is not in the shop directory.`
- **Face check:** compare with the enrolled template (the same `compareFaces` as check-in). On a mismatch, call `record_visit_face_failure` and return 403 `{ code: 'face-mismatch', attemptsLeft, lockedOut }`.
- **On a match:** insert the visit with `occurred_at = now()` (server time) and return 201 with the visit.
- The `syncNotifications` call runs in the background.

## Report changes (`GET /hr/tracking/reports/daily`)

- `visits` becomes the number of the day's visits for Sales Reps and Supervisors. It stays `null` for Merchandisers.
- `visitProof` gets the day's visits, so `shops.flagged` counts `no-stay`, `missed`, `off-list` and `not-in-list`.
- No coordinates are added to the report.

## Alerts

| Type | Label | Severity | Raised when | Source key |
|---|---|---|---|---|
| `visit-not-proven` | Shop visit not proven | medium | A listed shop's status is `no-stay` once the day is over | `visit-no-stay:<staff>:<date>:<shop>` |
| `shop-missed` | Shop missed | medium | A listed shop is `missed` | `visit-missed:<staff>:<date>:<shop>` |
| `visit-off-list` | Visit to an unlisted shop | low | A visit is `off-list` or `not-in-list` | `visit-off-list:<visitId>` |

- Each alert's description ends with "This is a reason to ask, not proof of misconduct. Attendance is not changed."
- Detection uses the visits, the summaries (or today's live stays) and the lists. It runs inside `syncNotifications` for the scanned dates. Past days use `tracking_day_summaries.shop_stays`. Today uses the same live summary as the report.
- `shop-missed` and `visit-not-proven` are raised only once the day is over, matching `dayOver` in the report.

## Phone screen

- **Check-in page** (`src/pages/AttendanceCheckIn.jsx`): when the response has `trackingToken`, save `{ token, closesAt, staffId }` under `tracking:session` and show a "Record a visit" button that opens `/visit`. On `check-out`, remove the key.
- **New page `src/pages/RecordVisit.jsx`** (lazy-loaded, route `/visit`):
  - It loads `GET /tracking/visits`, then lists the shops, ticking those already visited.
  - "Other outlet" opens two fields, name and town.
  - "Scan face and save" reads `navigator.geolocation.getCurrentPosition` (10 s timeout, high accuracy; it sends `null` if refused). It then captures the face with the same camera, `describeFace` and `captureFrame` helpers as check-in, and posts.
  - **Messages:**
    - success shows "Visit recorded at <shop> — 40 m from the shop" (or "location not available");
    - a mismatch shows the attempts left;
    - `session_closed` shows "You have clocked out. Visits can only be recorded while you are clocked in." and clears the saved session.
- **New service `src/services/visitService.js`:** `getVisitsToday()` and `recordVisit(input)`, using the saved token. It goes through `fetch` to the API base URL, not the HR client.

## Error handling

- **A visit whose phone location is unavailable** is still recorded, as `location-unavailable`. It's information, not a failure.
- **Clock-out while the page is open:** the post returns `409 session_closed`. The visit is not stored.
- **Face service unavailable:** 503 with the existing message. Nothing is stored and nothing is counted.

## Testing

**Unit tests** (`tests/outlet-visits.test.js`):
- `parseVisitOutlet`: shop / typed-in / missing / too-short name or town.
- `parseVisitLocation`: valid, missing, or out of range.
- `visitRow`:
  - a location 40 m from the shop gives `distance_m` 40, `status 'recorded'` and no latitude or longitude keys;
  - no location gives `location-unavailable`;
  - a typed-in outlet has `on_list false`.
- `visitProof` with real visits:
  - a listed visit with a 4-minute stay gives `no-stay`;
  - the same visit at a shop with no coordinates gives `unmeasured`;
  - a directory shop off the list gives `off-list`;
  - a typed-in outlet gives `not-in-list`;
  - a 12-minute stay with a visit gives `proven`.
- Each alert's detection: no-stay and missed only after the day is over; off-list and typed-in raised at once.

**Live smoke** (`scripts/smoke-outlet-visits.mjs`):
- **Setup:** sessions made with SQL, as in the tracker smoke.
- **Checks:**
  - a Merchandiser gets 409;
  - after clock-out, 409 `session_closed`;
  - an unknown shop gives 400;
  - `GET` lists the shops.
- **Needs `FACE_PROVIDER` unset or `faceapi`:** a matching visit stores `distance_m` with no coordinate columns; five mismatches give 423, and the kiosk can still check the person out (its counter is untouched); the report shows `visits` 1 and `shops.flagged` for a no-stay visit.

  These checks send the made-up face readings `scripts/smoke-employee.mjs` uses. While the live face provider is `rekognition`, the script reports them as skipped instead of failing.
