# Live Tracker: what the backend needs to build

**Project:** Workforce Pro, Attendance & HR (Box For Less, Double A)
**Date:** 12 November 2026
**For:** the backend developer
**Replaces:** §3, §5 (tracking tables) and §8 of
[backend-live-tracker-and-sms-verification.md](backend-live-tracker-and-sms-verification.md).
The SMS parts of that document still apply, with the distance rules from
[backend-multi-shop-and-places.md](backend-multi-shop-and-places.md).

---

## 1. The short version

The Live Tracker lets HR see **where field staff are while they are on duty**:
a live map and a daily report. The frontend is finished. The server side does
not exist yet, so today the tracker works only inside one browser. Locations a
phone records are saved in that phone's `localStorage`, and an HR user on
another computer never sees them.

What the backend needs to do:

1. When a field employee **clocks in**, open a tracking session and give the
   phone a **tracking token**.
2. Accept the phone's **location points** while the session is open, and
   refuse them after clock-out.
3. Give HR the **latest position of each field employee** for the live map
   (every 15 seconds, or pushed through Supabase Realtime).
4. At the end of each day, **summarise the trail** (time covered, distance,
   shop stays), save the summary, and **delete the points**.
5. Serve the **daily report** from those summaries.

## 2. Who is tracked, and when

| Tracked | Never tracked |
|---|---|
| Supervisors, Sales Representatives, Merchandisers | Warehouse Workers, office staff, HR |

The role comes from the job position: `categoryForPosition()` in
`src/constants/employeeCategories.js` returns `supervisor`, `sales-rep` or
`merchandiser`.

### Rules the server must enforce

1. **Only between clock-in and clock-out.** A point recorded before clock-in
   or after clock-out is rejected, even if it arrives later.
2. **Server time decides.** Clock-in, clock-out and `receivedAt` use server
   time. The phone's `recordedAt` is stored, but only checked against the
   session window.
3. **Company separation.** An HR user sees only their own company's people,
   through RLS on every table below.
4. **A lost signal is never misconduct.** "Signal lost" and low coverage are
   things for HR to ask about. They never change attendance.
5. **No positions are kept after the day.** The Tracking Policy shown to staff
   (`/tracking-policy`) promises that the detailed trail is deleted at the end
   of the working day, and only a summary without coordinates is kept.
6. **Distance only, HR decides.** There is no geofence or pass/fail on
   distance. HR sees "40 m" or "2.3 km" and judges. The one fixed number is
   **100 m**, an allowance for GPS error when measuring a shop stay (§6).

## 3. How it works, start to finish

```
 Employee phone                          Server                                 HR portal
 ──────────────                          ──────                                 ─────────
 Clock in (Staff ID + face) ──────────▶  attendance event "check-in"
                            ◀──────────  + trackingToken (field roles only)
 "Location sharing is on" bar
 watchPosition → point every
 20 s or 15 m  ────── POST /tracking/points ──▶ accept while session open ──▶  live map
                                                (else 409 session_closed)      (15 s refresh
                                                                                or Realtime)
 Clock out (face) ────────────────────▶  close session, revoke token
 phone gets 409 → stops sharing
                                         after midnight Accra:
                                         summarise each employee-day,
                                         save summary, delete points ──────▶  daily report
```

### 3.1 On the phone (already built)

- After a field employee clocks in, the phone shows a bar saying **"Location
  sharing is on"** (`src/components/tracking/LocationSharingBar.jsx`). It uses
  `navigator.geolocation.watchPosition` with high accuracy.
- It keeps a point only when **20 seconds** have passed **or** the phone has
  moved **15 m** since the last kept point, up to **2,000 points per person
  per day** (`src/services/locationTrackingService.js`).
- The bar tells the employee when something is wrong: no mobile data,
  location permission blocked, GPS off.
- The phone that did the clock-in is the phone that shares location. It stops
  by itself at clock-out.
- **Limitation:** a web app can only send locations while it is open on
  screen. When the phone is locked or the employee switches apps, points stop
  and HR sees "signal lost". A native wrapper (Capacitor with a
  background-location plugin) is planned later and will use the same
  endpoints, sending queued batches when it is back online.

### 3.2 Tracking session

- On a successful **check-in** for a field role, create a `tracking_sessions`
  row and return a `trackingToken` in the `POST /attendance/events` response.
  Return nothing for other roles.
- The token is random, stored **hashed**, bound to that employee and that
  day's session, and usable only for `POST /tracking/points`.
- On **check-out**, close the session and revoke the token.
- Also close it when the employee is marked absent (face scan locked out), and
  at the end of the working day if there was no clock-out (attendance already
  flags "no clock-out").

## 4. Endpoints

### 4.1 `POST /tracking/points` (phone)

`Authorization: Bearer <trackingToken>`

```json
{
  "points": [
    { "latitude": 5.60371, "longitude": -0.18696, "accuracy": 12,
      "recordedAt": "2026-11-12T09:41:07Z", "isMock": false }
  ]
}
```

- Accept a **batch**: the web app sends one point at a time, while the native
  app will send queued batches.
- Reject a point if `recordedAt` is before clock-in, after clock-out, more
  than 2 minutes in the future, or more than 12 hours old.
- Store `receivedAt` (server time) with each point.
- Apply the same thinning as the phone (20 s or 15 m) and the 2,000-per-day
  cap, so a modified phone cannot flood the table.
- **Flag, don't drop:**
  - points with `isMock: true` (Android reports fake-location apps);
  - jumps that imply more than 200 km/h.

  Raise a high-severity alert for HR in either case.
- Response: `{ "accepted": 3, "rejected": 1, "sessionOpen": true }`.
- After clock-out: `409 { "code": "session_closed" }`. The phone stops
  sharing when it gets this.
- Rate-limit by token.

### 4.2 Live map data (HR)

The HR page needs, per company, **one entry per field employee** in the shape
`getLiveTracker()` returns today (`src/services/liveTrackerService.js`). The
page refreshes every **15 seconds** and pauses when the browser tab is hidden.

```json
{
  "asOf": "2026-11-12T10:02:00Z",
  "people": [
    {
      "employeeId": "BFL-0007",
      "fullName": "…",
      "category": "sales-rep",
      "duty": "Clocked in — live",
      "onDuty": true,
      "visitsToday": 3,
      "lastEvent": "Live location",
      "lastEventAt": "2026-11-12T10:01:40Z",
      "position": { "latitude": 5.60, "longitude": -0.18, "accuracy": 12,
                    "source": "live", "at": "2026-11-12T10:01:40Z", "place": null },
      "shops": [{ "shopId": "shop-bfl-001", "shopName": "…", "latitude": 5.61, "longitude": -0.19 }]
    }
  ],
  "counts": {
    "supervisor":   { "total": 2, "placed": 1, "onDuty": 1 },
    "sales-rep":    { "total": 5, "placed": 4, "onDuty": 4 },
    "merchandiser": { "total": 9, "placed": 7, "onDuty": 8 }
  }
}
```

- `shops` lists the person's 1 to 7 assigned shops (for Sales Reps and
  Supervisors, their daily list). The map uses it to show **"Nearest shop —
  40 m away"**.
- The page also draws all the company's shops on the map, which it already
  reads from the `shops` table.

You can serve this in either of two ways:

- **(A) An endpoint**, `GET /hr/tracking/live?companyId=`, that builds the
  JSON above.
- **(B) Tables plus RLS**, like the rest of the HR portal (`src/services/backend/cache.js`):
  - a view `tracking_latest (staff_id, company_id, latitude, longitude, accuracy, recorded_at, session_status)` with one row per employee, today only;
  - added to Realtime.

  The frontend then builds the JSON itself. **Option B is preferred:** it
  matches how HR already reads data, and Realtime makes the map truly live.

Tell me which one you choose and I will switch `getLiveTracker()` to it.

**Position and status rules** (keep these identical to the frontend):

| Employee state | `position` | `duty` |
|---|---|---|
| Clocked in, latest point at most **5 min** old | that point, `source: "live"` | `Clocked in — live` |
| Clocked in, latest point older than 5 min | that point, `source: "live"` | `Clocked in — signal lost N min ago` |
| Clocked in, no point yet | Sales Rep / Supervisor: the latest visit's GPS (`gps`) or the visited shop (`outlet`); Merchandiser: their shop (`shop`) | `Clocked in — no live location yet` |
| Clocked out | `null` (taken off the map) | `Clocked out — tracking stopped` |
| Not clocked in, absent, on leave | `null` | `Not clocked in`, `Marked absent`, `On leave` |

On the map, people last seen more than 60 minutes ago are faded. This happens
in the frontend; the server doesn't need to do it.

### 4.3 Daily report (HR)

`GET /hr/tracking/reports/daily?companyId=&date=2026-11-12&role=` returns one
row per field employee, in the shape of `trackingDailyReport()` in
`src/services/trackingReportService.js`:

```json
{
  "dateKey": "2026-11-12",
  "rows": [{
    "employeeId": "BFL-0007", "fullName": "…", "category": "sales-rep",
    "clockIn": "…", "clockOut": null, "stillClockedIn": true,
    "visits": 4,
    "trackedMinutes": 182, "coverage": 0.93, "signalLost": 1, "longestGapMinutes": 9,
    "distanceKm": 12.4, "points": 311,
    "shops": { "listed": 4, "proven": 3, "flagged": 1, "missed": 0 },
    "result": "good"
  }],
  "totals": { "staff": 9, "clockedIn": 7, "tracked": 6, "averageCoverage": 0.88,
              "distanceKm": 61.3, "noSignal": 1 }
}
```

- `result`:
  - `good`: coverage of at least 90%.
  - `partial`: at least 60%.
  - `poor`: below 60%.
  - `no-signal`: clocked in, but no points.
  - `not-clocked-in`.
- Today's report is calculated live up to the current time. Past days come
  from the saved summaries.
- The report contains **no coordinates**.
- The CSV export already happens in the browser and is recorded through
  `/hr/audit/exports`. No new endpoint is needed for it.

## 5. End of day: summarise, then delete

Run a job after midnight Africa/Accra, and on demand for any day not yet
processed. For each employee-day:

| Field | Meaning |
|---|---|
| `clockIn`, `clockOut` | from attendance |
| `trackedMinutes` | clock-out − clock-in |
| `points`, `firstAt`, `lastAt` | how many points, and the first and last times |
| `coveredMinutes`, `coverage` | each point covers the time until the next point, **up to 5 minutes**; coverage = covered ÷ tracked (0 to 1) |
| `signalLost`, `longestGapMinutes` | gaps longer than 5 minutes between clock-in, the points and clock-out |
| `distanceM` | sum of distances between consecutive points, **leaving out points with accuracy worse than 100 m** |
| `shopStays` | `{ shopId: { minutes, longestMinutes, closestM } }`, see §6 |

Save the summary, then **delete that day's points**. The reference
implementation is `summariseTrail()` in `locationTrackingService.js`; the
tests in §8 must give the same numbers.

## 6. Shop stays (proof of a shop visit)

Some Sales Reps and Supervisors have claimed shop visits without going. The
tracker is what proves a visit:

- A **stay** at a shop is a run of consecutive points **within 100 m** of the
  shop, with no gap longer than **5 minutes**. Its length runs from the first
  point to the last.
- A listed shop is **proven** when its longest stay is **at least 10 minutes**
  (`MIN_STAY_MINUTES`).
- The reference implementation is `shopStays()` and `visitProof()` in
  `src/services/visitListService.js`.

| Result | Rule |
|---|---|
| `proven` | Stay of 10+ minutes within 100 m |
| `no-stay` | A visit was recorded, but no 10-minute stay shows on tracking (flag for HR) |
| `unmeasured` | A visit was recorded, but the shop has no map location (HR should add one) |
| `pending` | Nothing yet, and the day is not over |
| `missed` | Nothing, and the working day is over (flag for HR) |

Visits to shops that aren't on the person's list are flagged `off-list`, and
typed-in outlets are flagged `not-in-list`. Neither ever counts as proven.

Store `shopStays` in the summary **before** deleting the points.

## 7. Tables

| Table | Columns |
|---|---|
| `tracking_sessions` | `id, staff_id, company_id, date, clock_in_at, clock_out_at, token_hash, status ('open'\|'closed'), closed_reason` |
| `location_points` | `id, session_id, staff_id, company_id, latitude, longitude, accuracy, recorded_at, received_at, is_mock, flagged` (**deleted after the day's summary**) |
| `tracking_day_summaries` | `staff_id, company_id, date, clock_in, clock_out, tracked_minutes, points, first_at, last_at, covered_minutes, coverage, signal_lost, longest_gap_minutes, distance_m, shop_stays jsonb` (**no coordinates**) |

Access:

- **RLS:** HR users with the `sales-monitoring` permission can read their own
  companies' rows.
- **Writes:** only the edge function writes. Phones never write directly.
- **Indexes:** `location_points (staff_id, recorded_at)` and
  `tracking_sessions (staff_id, date)`.

## 8. Acceptance checks

**Session window**
- A point recorded 1 second after clock-out is rejected. One recorded 1
  second before is accepted, even if it is uploaded later.
- After clock-out, `POST /tracking/points` returns `409 session_closed`.
- A Warehouse Worker or office employee never gets a tracking token.

**Live map**
- A Box For Less HR user cannot read Double A points, sessions or summaries,
  and vice versa.
- The latest point is 6 minutes old: duty is "signal lost 6 min ago".
- After clock-out the person disappears from the map.

**Coverage and distance**
- 60-minute day, one point per minute for the first 30 minutes, then
  nothing: `coveredMinutes = 35`, `coverage ≈ 0.58`, `signalLost = 1`,
  `longestGapMinutes = 30`.
- Clocked in with no points: `coverage = 0`, `result = no-signal`.
- A point with 500 m accuracy is left out of the distance.

**Shop stays**
- Points every 3 minutes within 100 m of a shop from 09:00 to 09:12: stay =
  12 minutes, so the shop is `proven`.
- Points at 0, 4, 15 and 19 minutes: the 11-minute gap breaks the stay, so
  the longest stay is 4 minutes and the shop is not proven.

**After the end-of-day job**
- That day's points are gone.
- The summary has no latitude or longitude.
- The stay minutes are still there.

## 9. Frontend functions this replaces

| Frontend today (browser-only) | Replace with |
|---|---|
| `locationTrackingService.recordLocationPing()` | `POST /tracking/points` |
| `trackingStatus()`, `onAttendanceRecorded()` | `trackingToken` in the check-in response; `409 session_closed` |
| `latestLocation()`, `todayTrail()` | `tracking_latest` (option B) or `GET /hr/tracking/live` |
| `liveTrackerService.getLiveTracker()` | built from the above |
| `daySummary()`, `summariseTrail()`, `dayShopStays()` | end-of-day job + `tracking_day_summaries` |
| `trackingReportService.trackingDailyReport()` | `GET /hr/tracking/reports/daily` |
| `visitListService.getVisitList()` / `mockSaveVisitList()` | `GET/PUT /employees/:staffId/visit-list` (see the multi-shop document) |

These are the browser keys to clear when testing the current version:
`mock-tracking:pings`, `mock-tracking:day-summaries` and
`mock-tracking:device-staff`.

## 10. Privacy and security

- Staff are told about tracking in the in-app Tracking Policy and Privacy
  Policy. The server must do what those pages promise: tracking only on duty,
  and the trail deleted the same day.
- Tokens are random, hashed, single-purpose and expire at clock-out.
- HTTPS only. Rate-limit the points endpoint.
- Ghana Data Protection Act, 2012 (Act 843): the company should register with
  the Data Protection Commission before go-live.

## 11. Decisions for the company

1. Whether HR needs a **past-day route** (positions). Today only summaries
   are kept; keeping routes would mean changing the Tracking Policy.
2. Whether the 10-minute minimum stay is right.
3. How long summaries are kept. The proposal is 6 years; see
   `src/constants/legal.js`.
4. When to build the **native app** for background tracking. Until then,
   tracking pauses whenever the app is not on screen.
