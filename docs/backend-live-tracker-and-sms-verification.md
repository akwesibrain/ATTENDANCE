# Live Field Tracker & SMS Verification — Backend Specification

**Project:** Workforce Pro — Attendance & HR (Box For Less, Double A)
**Version:** 1.0 · 11 November 2026
**For:** the backend developer
**Status:** the frontend is built and running on mock services; this document
describes what the server must do so the mocks can be replaced.

> **Update 11 November 2026 — read first:** the company **removed the 150 m radius** — **distance only, HR decides** (no pass/fail; HR sees "40 m", "2.3 km") — and field employees work at **1 to 7 shops**. The 10-minute stay rule stays, measured **within 100 m** (a GPS-error allowance). Everything in this document about geofences, inside/outside results and the 500 m location-mismatch alert is **replaced** by [docs/backend-multi-shop-and-places.md](backend-multi-shop-and-places.md).

Read this together with the [Backend developer guide in the README](../README.md#backend-developer-guide)
(general principles, data model, security).

---

## 1. Summary

Three employee roles are **field staff**: **Supervisors, Sales Representatives
and Merchandisers**. The same group is covered by both features:

| Feature | What it does | When |
|---|---|---|
| **Live tracking** | The employee's phone sends its location; HR sees everyone on a live map and gets a daily report | Only between the employee's **clock-in and clock-out** |
| **SMS verification** | 3 checks per working day at random times: the employee opens a link from an SMS, scans their face, and the phone's location is checked | Only while the employee is **clocked in** |
| **Shop visit proof** (Sales Reps, Supervisors) | Each has a fixed list of shops to visit every working day. A visit is **proven** only by a face scan inside the shop's area **and** a stay of at least 10 minutes on live tracking | Every working day |

> **Why shop visit proof exists:** some Sales Reps and Supervisors have
> claimed visits to their assigned shops without going there. A single scan
> can be faked by a drive-by or a fake-location app; requiring a matching stay
> on live tracking makes that much harder.

Other roles (Warehouse Workers, office staff) are never tracked and never
receive verification SMS.

The role comes from the job position — see `categoryForPosition()` in
`src/constants/employeeCategories.js` (`supervisor`, `sales-rep`,
`merchandiser`).

### Golden rules (must be enforced on the server)

1. **No tracking outside working time.** Location is accepted only between
   the employee's clock-in and clock-out on that day. Anything recorded before
   clock-in or after clock-out is **rejected**, even if a phone sends it.
2. **Future SMS times are secret.** No API ever returns a verification time
   that has not happened yet — not to HR, not to the employee.
3. **A missing signal or a missed SMS is never an automatic absence or
   misconduct.** It becomes an exception for HR to review.
4. **Server time** is the reference for clock-in, clock-out, SMS dispatch and
   reply windows. Device time is stored but not trusted.
5. **Company separation.** Box For Less never sees Double A data and vice versa.
6. **No positions in reports.** The daily report contains times, coverage and
   distance only.

---

## 2. How it fits together

```
 Employee phone                         Server                               HR portal
 ─────────────                          ──────                               ─────────
 Clock in (face scan) ───────────────▶  record check-in
                      ◀───────────────  trackingToken (valid until clock-out)
 every move / 20 s ──▶ POST pings ───▶  accept only while session open ──▶  GET live (every 15 s)
                                        scheduler: 3 random times/day
 SMS with link       ◀──────────────── send SMS (provider)
 open link, face scan,
 GPS ────────────────▶ POST verify ──▶  face + liveness + geofence ──────▶  alerts / monitoring
 Clock out (face) ───────────────────▶  close session, revoke token,
                                        cancel remaining SMS checks
                                        end of day: summarise trail,
                                        delete points ──────────────────▶  GET daily report
```

---

## 3. Live tracking

### 3.1 Tracking session

- On a successful **clock-in** for a field role, create a **TrackingSession**
  and return a `trackingToken` in the clock-in response.
- The token is bound to the employee and that day's session. It is the only
  way to send locations — the phone has no other login.
- On **clock-out**, close the session and revoke the token. Any later request
  with it returns `409 session_closed`. The phone stops tracking when it gets
  this response.
- If the employee is marked absent (5 failed face scans) the session is closed
  the same way.
- At the end of the working day, sessions with no clock-out are closed
  automatically (and flagged "no clock-out" for HR as today).

### 3.2 Receiving locations

`POST /tracking/points` — `Authorization: Bearer <trackingToken>`

```json
{
  "points": [
    { "latitude": 5.60371, "longitude": -0.18696, "accuracy": 12,
      "recordedAt": "2026-11-11T09:41:07Z",
      "isMock": false }
  ]
}
```

- Accept a **batch** (the installed phone app will queue points while offline
  and upload them later; the web version sends one at a time).
- For each point:
  - Reject if `recordedAt` is before clock-in, after clock-out, more than
    2 minutes in the future (server time), or older than 12 hours.
  - Store `receivedAt` (server time) alongside `recordedAt`.
  - Thin the data the same way the frontend does: keep a point only if
    **20 seconds** have passed **or** the phone moved **15 m** or more since
    the last kept point. Cap at **2,000 points per employee per day**.
  - Flag (do not silently drop) suspicious points for HR: `isMock: true`
    (Android reports fake-location apps), or a jump that implies more than
    200 km/h.
- Response: `{ "accepted": 3, "rejected": 1, "sessionOpen": true }`.
- `409 session_closed` once the employee has clocked out.

### 3.3 Live map for HR

`GET /tracking/live?company=box-for-less` (HR, permission: field monitoring)

Returns one entry per field-staff employee of that company, matching what the
mock `getLiveTracker()` returns today (`src/services/liveTrackerService.js`):

```json
{
  "asOf": "2026-11-11T10:02:00Z",
  "people": [
    {
      "employeeId": "BFL-0007", "fullName": "…", "category": "merchandiser",
      "duty": "Clocked in — live", "onDuty": true,
      "lastEvent": "Live location", "lastEventAt": "2026-11-11T10:01:40Z",
      "visitsToday": null,
      "position": { "latitude": 5.60, "longitude": -0.18, "accuracy": 12,
                    "source": "live", "at": "2026-11-11T10:01:40Z", "place": null }
    }
  ],
  "counts": { "supervisor": { "total": 2, "placed": 1, "onDuty": 1 }, "sales-rep": {…}, "merchandiser": {…} }
}
```

Position rules (keep them identical to the mock):

| Employee state | `position` | `duty` |
|---|---|---|
| Clocked in, live point in the last 5 min | latest point, `source: "live"` | `Clocked in — live` |
| Clocked in, last point older than 5 min | latest point, `source: "live"` | `Clocked in — signal lost N min ago` |
| Clocked in, no point yet | Sales Rep / Supervisor: latest outlet visit (`gps` or `outlet`); Merchandiser: allocated shop (`shop`) | `Clocked in — no live location yet` |
| Clocked out | `null` (off the map) | `Clocked out — tracking stopped` |
| Not clocked in / absent / on leave | `null` | as appropriate |

The HR page polls every **15 seconds**. Server-sent events or WebSockets can
replace polling later; keep the same payload.

### 3.4 End of day: summary, then delete the trail

The Tracking Policy shown to staff promises that the **detailed trail is kept
only until the end of the same working day**. Run a job after midnight
Africa/Accra (and on demand for any day not yet processed):

1. For each employee-day, compute a **TrackingDaySummary** (no positions):

   | Field | Meaning |
   |---|---|
   | `clockIn`, `clockOut` | from attendance |
   | `trackedMinutes` | clock-out − clock-in |
   | `points` | number of stored points |
   | `firstAt`, `lastAt` | first/last point time |
   | `coveredMinutes`, `coverage` | each point counts for the time until the next point, up to **5 minutes**; coverage = covered ÷ tracked (0–1) |
   | `signalLost`, `longestGapMinutes` | gaps longer than 5 minutes between clock-in, the points and clock-out |
   | `distanceM` | sum of distances between consecutive points, **leaving out points with accuracy worse than 100 m** |

2. Save the summary, then **delete the points**.

The exact algorithm is `summariseTrail()` in
`src/services/locationTrackingService.js`; the test cases in §7 must give the
same numbers.

### 3.5 Daily report

`GET /tracking/reports/daily?company=box-for-less&date=2026-11-11&role=`
(HR) and `GET …/export` (CSV, needs the reports-export permission; write an
audit event "Live Tracker daily report exported").

One row per field-staff employee — same shape as `trackingDailyReport()` in
`src/services/trackingReportService.js`:

```json
{
  "dateKey": "2026-11-11",
  "rows": [{
    "employeeId": "BFL-0007", "fullName": "…", "category": "sales-rep",
    "clockIn": "…", "clockOut": null, "stillClockedIn": true,
    "visits": 4,
    "trackedMinutes": 182, "coverage": 0.93, "signalLost": 1, "longestGapMinutes": 9,
    "distanceKm": 12.4, "points": 311,
    "shops": { "listed": 4, "proven": 3, "flagged": 1, "missed": 0 },
    "result": "good",
    "sms": { "sent": 2, "verified": 2, "missed": 0, "failed": 0 }
  }],
  "totals": { "staff": 9, "clockedIn": 7, "tracked": 6, "averageCoverage": 0.88, "distanceKm": 61.3, "noSignal": 1 }
}
```

- `result`: `good` (coverage ≥ 90 %), `partial` (≥ 60 %), `poor` (< 60 %),
  `no-signal` (clocked in, no points), `not-clocked-in`.
- Today is calculated live up to the current time; past days come from the
  saved summaries.
- `shops` (Sales Reps and Supervisors only, `null` for Merchandisers): see §3.6.
- **New:** add the `sms` block (checks sent / verified / missed / failed that
  day). The frontend will show it once the API returns it.

### 3.6 Shop visit proof (Sales Reps and Supervisors)

**Daily shop list.** Each Sales Rep and Supervisor has a fixed list of shops
from their company's Shop Directory to visit **every working day**. HR sets it
in Field Monitoring → Sales Rep / Supervisor Monitoring → *Edit shop list*.
Every change is kept in a history and written to the audit log.

- `GET /employees/:staffId/visit-list` → `{ "shopIds": [...] , "updatedAt", "updatedBy" }`
- `PUT /employees/:staffId/visit-list` `{ "shopIds": [...] }` (HR, shops-edit
  permission). Reject shops from another company.
- The employee's visit screen shows their list first (the clock-in or Staff ID
  lookup response should include it).

**Stay calculation.** From the day's live points, a *stay* at a shop is a run
of consecutive points inside the shop's geofence (150 m, or the shop's own
radius) with no gap longer than **5 minutes**; its length is the time from the
first to the last point of the run. Keep, per employee-day and shop,
`minutes` (total) and `longestMinutes` (longest run). Store these in the
TrackingDaySummary **before** deleting the points (`shopStays`, no positions),
for every shop on the list plus any shop visited that day. Reference:
`shopStays()` in `src/services/visitListService.js`.

**Result per listed shop** (reference: `visitProof()`):

| Result | Rule | Flag for HR |
|---|---|---|
| `proven` | A visit scan at the shop **inside** the geofence **and** `longestMinutes ≥ 10` | — |
| `no-stay` | Scan inside, but no 10-minute stay on live tracking (or no tracking at all) | yes (high) |
| `outside` | Scan recorded outside the geofence | yes (high) |
| `no-location` | Scan with no phone location | yes |
| `stay-no-scan` | Live tracking shows a 10-minute stay but no visit was scanned | yes (low) |
| `missed` | Nothing at all and the working day is over | yes (high) |
| `pending` | Nothing yet, the day is not over | — |
| `no-shop-location` | The listed shop has no saved coordinates, so it cannot be proven | HR should save the shop's location |

**Visits that are not on the list:**

| Result | Rule |
|---|---|
| `off-list` | Visit to a directory shop that is not on the person's list — recorded and flagged |
| `cannot-verify` | Typed-in outlet (no shop ID, no coordinates) — recorded and flagged; **never counts as proven** |

The best scan for a shop wins (inside > outside > no location). Counts per
employee-day: `listed`, `proven`, `flagged`, `missed`.

**API:** `GET /monitoring/visits?company&category&date` returns, per employee,
the attendance fields plus `{ listed: [{ shopId, status, scan, scans, stayMinutes }], offList: [{ visit, status }], counts }`.

**Alerts** (one per source key, e.g. `BFL-0007:2026-11-11:visit-missed:shop-123`):
"Shop visit not proven" (`no-stay`, `outside`), "Shop missed" (`missed`, raised
at the end of the working day), "Visit to unlisted shop" (`off-list`,
`cannot-verify`, low). As with SMS checks, a flag is a reason for HR to ask —
never an automatic absence or misconduct.

---

## 4. SMS verification

Today the prototype simulates SMS checks for **Merchandisers only**
(`src/services/salesMonitoringService.js`). In production they apply to **all
field staff: Supervisors, Sales Reps and Merchandisers**.

### 4.1 Schedule (server only)

- **3 checks per working day** per field employee (`VERIFICATIONS_PER_SHIFT`).
- Split the company's working hours (default 08:00–17:00, Settings → Working
  Hours, effective-dated) into three equal parts and pick **one random time in
  each part**, at least 10 minutes from the part's edges. Use a secure random
  generator; times must differ per employee and per day.
- Generate the schedule at the start of the day; **store it only on the
  server**. Never return a future dispatch time in any API, log line visible to
  HR, or SMS.
- No checks on weekends, holidays, approved leave, or days the company does not
  work.
- **Send only while the employee is clocked in.** If the employee has not
  clocked in at the scheduled time, do not send; the existing "Employee not
  checked in" alert covers it. After clock-out, cancel the remaining checks for
  that day.
- Settings (Settings → Sales-rep monitoring): `smsEnabled`,
  `responseWindowMinutes` (default **15**), `faceRequired` (true),
  `gpsRequired` (true), `defaultGeofenceRadius` (**150 m**),
  `repeatedExceptionThreshold` (default **2**).

### 4.2 The check

1. At the scheduled time, send an SMS through the provider:
   *"Box For Less attendance check. Open within 15 min: https://…/v/Xk3…"*
   The link holds a **one-time token** bound to the employee and this check,
   valid for the response window.
2. The link opens the attendance app's verification screen: the employee
   scans their face (face match + **liveness**), and the phone sends its
   location.
3. `POST /verifications/:token` (multipart: face image, latitude, longitude,
   accuracy). The server decides the result:

| Result | When |
|---|---|
| `verified` | Face and liveness pass, location received and inside the geofence (see 4.3) |
| `failed-face` | Face or liveness check fails |
| `outside-shop` | Location is outside the geofence |
| `gps-unavailable` | No location received |
| `missed` | No reply within the response window |
| `sms-failed` | Provider reports the SMS was not delivered |

4. Store a **VerificationEvent**: `eventId`, `employeeId`, `verificationNumber`
   (1–3), `dispatchedAt`, `deliveryStatus`, `respondedAt`,
   `faceVerificationStatus`, `livenessStatus`, `gpsVerificationStatus`,
   `distanceFromShop`, `gpsAccuracy`, `result`. This is the shape the HR
   monitoring pages already read (`mockGetRepresentativeDetail`).
5. Use the provider's delivery reports (webhook) to set `deliveryStatus`.

### 4.3 Which location the check is compared with

| Role | Geofence |
|---|---|
| **Merchandiser** | Their **allocated shop**, 150 m (the shop's own radius if set). Same as today. |
| **Sales Rep / Supervisor** | Their **daily shop list** (§3.6). Inside the geofence of **any** shop on the list = GPS passed. Outside all of them = `outside-shop`, flagged for HR review; the result shows the nearest listed shop and its distance (they may be travelling between shops, so HR decides). If none of their listed shops has saved coordinates, record the location and mark the GPS part `recorded` (not a failure). |

Also compare the check's location with the employee's **live-tracking point
nearest in time**: if they differ by more than 500 m, raise a "location
mismatch" alert (possible fake location).

### 4.4 Alerts and attendance

Raise one alert per source (no duplicates), as the mock does
(`mockGetAlerts`):

| Alert | Severity |
|---|---|
| Missed SMS verification | medium |
| Failed face verification | high |
| Outside assigned shop / outlet radius | high |
| GPS unavailable | low |
| SMS delivery failure | medium |
| Repeated verification failures (≥ threshold in a day) | high |
| Employee not checked in | medium |
| Incomplete verification (fewer than 3 completed by the end of the day) | low |
| **New:** Location mismatch (SMS check vs live tracking) | high |
| **New:** Fake-location flag from the phone | high |

The day's attendance record carries a `verification` value
(`verified` / `pending` / `review` / `failed` / `none`) — see
`smsVerification()` in `src/services/attendanceRecordsService.js`. A missed or
failed check **never** makes the employee absent on its own.

---

## 5. Data model

| Entity | Fields |
|---|---|
| **TrackingSession** | id, employeeId, companyId, date, clockInAt, clockOutAt, tokenHash, status (`open`/`closed`), closedReason |
| **LocationPoint** | id, sessionId, latitude, longitude, accuracy, recordedAt, receivedAt, isMock, flagged — **deleted after the day's summary is saved** |
| **TrackingDaySummary** | employeeId, companyId, date, clockIn, clockOut, trackedMinutes, points, firstAt, lastAt, coveredMinutes, coverage, signalLost, longestGapMinutes, distanceM, shopStays `{ shopId: { minutes, longestMinutes } }` — **no positions** |
| **VisitList** | employeeId, shopIds[], updatedAt, updatedBy |
| **VisitListHistory** | employeeId, at, by, previous shopIds, next shopIds (append-only) |
| **VerificationSchedule** | employeeId, date, verificationNumber, scheduledAt, status (`pending`/`sent`/`cancelled`) — **never exposed by any API** |
| **VerificationEvent** | as in §4.2, plus tokenHash, faceImageRef |
| **Alert** | existing notification model; `sourceKey` unique, e.g. `BFL-0007:2026-11-11:missed-verification:v2` |

Retention (proposed in `src/constants/legal.js`, to be confirmed by the
company): detailed trail until the end of the day; daily summaries, visits and
verification events 6 years; face images per the Privacy Policy.

---

## 6. Replace these mock functions

| Mock (frontend) | Replace with |
|---|---|
| `locationTrackingService.recordLocationPing()` | `POST /tracking/points` |
| `locationTrackingService.trackingStatus()` / `onAttendanceRecorded()` | the clock-in / clock-out responses (`trackingToken`, `409 session_closed`) |
| `locationTrackingService.latestLocation()`, `todayTrail()` | `GET /tracking/live` |
| `locationTrackingService.daySummary()`, `summariseTrail()` | server job + `GET /tracking/reports/daily` |
| `liveTrackerService.getLiveTracker()` | `GET /tracking/live` |
| `trackingReportService.trackingDailyReport()`, `trackingReportToCsv()` | `GET /tracking/reports/daily` and `/export` |
| `salesMonitoringService.getMonitoringOverview / getRepresentativeDetail / getAlerts / updateAlert / getLiveFieldBoard` (already on Supabase for Merchandisers) | `GET /monitoring/reps`, `GET /monitoring/reps/:id?date`, `GET /monitoring/alerts`, `PATCH /monitoring/alerts/:id` — **extended to Sales Reps and Supervisors** |
| `fieldVisitsService.verifyVisitLocation()` | geofence check on the server when a visit is recorded |
| `visitListService.getVisitList() / mockSaveVisitList()` | `GET / PUT /employees/:staffId/visit-list` |
| `visitListService.shopStays() / visitProof()`, `locationTrackingService.dayShopStays()`, `trackingReportService.visitProofForRecord()` | server-side proof per employee-day, returned by `GET /monitoring/visits` and in the daily report's `shops` block |

`localStorage` keys used by these mocks (delete to reset a test):
`mock-tracking:pings`, `mock-tracking:day-summaries`,
`mock-tracking:device-staff`, `mock-sales-monitoring:alert-state`.

Demo data to remove: the demo merchandisers `BFL-1001…1005`,
`DAA-1001…1004` and their generated SMS events (`salesMonitoringService.js`).

---

## 7. Acceptance checks

**Tracking**
- A point recorded 1 second after clock-out is rejected; one recorded 1 second
  before is accepted, even if uploaded later.
- After clock-out, `POST /tracking/points` returns `409 session_closed`.
- A Warehouse Worker or office employee can never open a tracking session.
- 60-minute day, one point per minute for the first 30 minutes, then nothing:
  `coveredMinutes = 35`, `coverage ≈ 0.58`, `signalLost = 1`,
  `longestGapMinutes = 30`.
- No points at all for a clocked-in day: `coverage = 0`, `signalLost = 1`,
  `result = no-signal`.
- A point with accuracy 500 m is left out of the distance.
- After the end-of-day job, the day's points are gone and the summary has no
  latitude/longitude anywhere.
- An HR user for one company cannot read the other company's live map or report.

**Shop visit proof**
- Points every 3 minutes inside a shop's area from 09:00 to 09:12, then away:
  stay = 12 minutes; with a scan inside → `proven`.
- Points at 0, 4, 15 and 19 minutes inside the area: the 11-minute gap breaks
  the stay, longest = 4 minutes → scan inside gives `no-stay`.
- Scan inside but no live tracking that day → `no-stay`.
- 10-minute stay, no scan → `stay-no-scan`. Nothing at all after the working
  day → `missed`; before it ends → `pending`.
- A visit to a shop not on the list → `off-list`; a typed-in outlet →
  `cannot-verify`; neither ever counts as proven.
- After the end-of-day job the stay minutes are still available for that day,
  and the summary still contains no coordinates.
- Saving a list with a shop from the other company is rejected; every list
  change appears in the audit log.

**SMS verification**
- Each field employee gets exactly 3 checks on a working day, one in each third
  of the working hours, at different times per employee and per day.
- No API response, at any time, contains a future check time.
- No SMS is sent before clock-in, after clock-out, on weekends, holidays or
  approved leave.
- A reply after the response window is `missed`.
- A missed check creates a "Missed SMS verification" alert and does **not**
  change attendance to absent.
- Two failed/missed checks in a day create one "Repeated verification
  failures" alert (with threshold 2).
- The same alert source never creates two alerts.

---

## 8. Phone app (background tracking)

The current frontend is an installable web app. A web app can only send its
location while it is **open on screen**; when the phone is locked or the
employee switches apps, updates pause and HR sees "signal lost". The company
wants tracking to continue in the background on **Android and iPhone**, so a
native wrapper (e.g. Capacitor) with a background-location plugin is planned.
It will use the **same endpoints**:

- send batched points to `POST /tracking/points` (queue offline, upload later);
- stop when it receives `409 session_closed`;
- send `isMock` on Android;
- open SMS verification links in the app.

iPhone background location requires the "Always" permission and a clear
purpose string; App Store review checks this.

---

## 9. Privacy and security

- Staff are told about tracking and SMS checks in the in-app **Tracking
  Policy** (`/tracking-policy`) and **Privacy Policy** (`/privacy`). The
  backend must do what those pages promise (times, retention, who can see).
- Only HR users with field-monitoring permission can read locations; log every
  export in the audit log.
- Tokens (tracking and SMS links) are random, stored hashed, single-purpose and
  expire.
- HTTPS only. Rate-limit `POST /tracking/points` and `POST /verifications/:token`.
- Follow Ghana's Data Protection Act, 2012 (Act 843). Register with the Data
  Protection Commission before go-live.

## 10. Open decisions (for the company)

1. Minimum stay for a proven shop visit — **10 minutes** for now
   (`MIN_STAY_MINUTES`); confirm with HR.
2. Retention periods (§5).
3. SMS provider and sender name.
4. Whether HR needs a past-day **route** (positions), which would change the
   Tracking Policy — today only summaries are kept.
