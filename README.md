# Workforce Pro — Attendance & HR

Workforce management and attendance for two companies, **Box For Less** and
**Double A**. It has two parts:

- **Employee portal** (`/`) — self-registration and daily check-in / check-out
  with face capture.
- **HR portal** (`/hr`) — one HR account (HR Manager) that runs both companies:
  employees, attendance, sales reps, reports, overtime, holidays, settings and
  audit logs.

> **Status: frontend prototype.** There is no backend yet. Every "server"
> behaviour is simulated by mock services in `src/services/` that store data in
> the browser's `localStorage`. Nothing here is secure or production-ready.
> The [Backend developer guide](#backend-developer-guide) below lists what has
> to be built.

## Running the project

```bash
npm install   # first time only
npm run dev   # http://localhost:5173  (HR portal: http://localhost:5173/hr)
```

```bash
npm run build    # production build
npm run preview  # preview the production build
npm run lint     # oxlint
```

Camera capture needs a secure context; `localhost` works out of the box.
To reset all demo data, clear the site's `localStorage` in the browser.

## What the frontend does

### Employee portal

- **Registration** (7 steps): company → personal details (incl. optional
  emergency contact name and phone) → face enrollment → job position (and an
  allocated shop for Sales Representatives and Merchandisers) → review with
  biometric consent → Staff ID (`BFL-0001`, `DAA-0001`).
- **Attendance**: Staff ID → live face scan → check-in or check-out.
  One check-in and one check-out per day. Check-in 06:00–09:00 (later is
  **late**), check-out 17:00–19:00 (after 19:00 nothing is recorded). Weekend
  work is allowed and is overtime.

### HR portal (`/hr`)

| Area | What it does |
|---|---|
| Dashboard | Today's figures per company and combined; today's register |
| Employees | Directory cards with emergency contact; HR sets the **date joined** and the time with the company is calculated (years, months, days); shop assignment for field staff |
| Attendance | One record per employee per day (from check-ins, SMS verification, or HR manual entry); corrections with full history; manual entry for paper records |
| Sales Reps | Rep monitoring, 3 random SMS verification checks per working day, 150 m shop geofence, alerts, shop directory with map locations, live field board |
| Reports | Monthly report (26th–25th) with working days, hours, overtime and pay; daily records; **Overtime** tab |
| Settings | General, company profiles, attendance rules, working hours, **holidays**, sales-rep monitoring, notifications, security, data export, **Audit Logs** tab |
| Notifications | Exceptions (late, absent, missing clock-out, failed verifications, missing shop…) with assign / review / resolve / dismiss |
| HR Assistant | Rule-based chat that answers from the records (no AI service) |

## Business rules (the contract the backend must keep)

These are implemented in the mock services today. The backend must implement
them **authoritatively, using server time**, and the frontend should then only
display what the server returns.

**Time and periods**
- Time zone **Africa/Accra** (UTC+0, no daylight saving) for every date and time.
- The attendance / pay period runs from the **26th to the 25th** of the next month.
- Future dates are never counted (no future absences).

**Working hours**
- Everyone works the company's standard hours: **Monday–Friday, 08:00–17:00**,
  late after **09:00**. There are no shifts.
- Hours are configurable per company **with an effective date**; a change never
  rewrites earlier days.

**Attendance records**
- Exactly **one record per employee per day**, whatever the source
  (check-in, SMS verification, or HR manual entry). Manual and system days
  count the same toward working days.
- Approved leave, weekends and holidays are never absences.
- Nobody is absent before the working day has ended.
- Attendance is counted from the later of the **date joined** and the
  **registration date**.
- A missed SMS verification is an exception for HR review — never an automatic
  absence or misconduct.

**Overtime**
- **Weekdays:** only time after the overtime start (default **17:01**) counts.
- **Saturdays, Sundays and holidays:** the whole time worked counts, from
  clock-in to clock-out.
- All of it is added into **one overtime total** per employee per period.
- Pay = overtime hours × the hourly rate in force on each day (default
  **GH₵60/h**, per company, effective-dated), rounded to the pesewa.
- Records with no clock-out, unknown times or approved leave are excluded and
  listed for HR to fix.
- VAT (default 5.5%) is a separate company setting and is **not** deducted from
  overtime.

**Holidays**
- Ghana public holidays are built in every year; HR can add holidays for any
  date (past or future) for both companies and remove the ones it added.
- Adding or removing a holiday must **recalculate** attendance and overtime for
  that day.

**Sales representatives and merchandisers**
- Must have an allocated shop belonging to their own company; assignment history
  is kept.
- Three verification checks at random times inside working hours; **future
  check times must never be sent to the client**.
- GPS check against a **150 m** geofence around the shop. Shop coordinates come
  only from a confirmed lookup, a pin placed by HR, or typed coordinates —
  never invented.

**Companies and access**
- Box For Less and Double A data are always kept separate (every list, report
  and export is per company, or labelled per company when combined).
- One HR account (**HR Manager**) with access to both companies.
- There is no public HR sign-up page.

## Backend developer guide

### 1. Principles

- The server is the **source of truth**. Every rule above, every permission and
  every company restriction must be enforced on the server for every request.
  Hiding a button in the UI is not security.
- Use **server time** for all attendance events; ignore any time sent by the
  client.
- Keep the existing function names and return shapes where possible, so each
  mock service can be swapped for an API client without touching the UI.
  Most mock functions are synchronous today; the API versions will be async, so
  the calling components need small `await`/loading changes.

### 2. Replace the mock services

| Mock service (`src/services/`) | Backend responsibility | Suggested API (illustrative) |
|---|---|---|
| `registrationService.js` | Create employees, **generate Staff IDs** (sequential per company), store emergency contact, date joined; validate position and allocated shop | `POST /employees/register`, `GET /employees`, `PATCH /employees/:staffId` (date joined, emergency contact) |
| `attendanceService.js` | Staff ID lookup, **face verification**, check-in/out windows, one in + one out per day, failed-attempt limit (5/day) | `GET /attendance/lookup/:staffId`, `POST /attendance/events` (multipart photo) |
| `attendanceRecordsService.js` | Build the daily record per employee (rules above); corrections with history; manual entries; CSV export | `GET /attendance/records?company&from&to`, `POST /attendance/corrections`, `POST /attendance/manual-entries`, `GET /attendance/export` |
| `overtimeService.js` | Overtime per record and per period (rules above) | `GET /reports/overtime?company&period` |
| `holidayService.js` | Public + HR holidays; recalculation on change | `GET /holidays?year`, `POST /holidays`, `DELETE /holidays/:id` |
| `settingsService.js` | All settings, effective-dated versions (working hours, attendance rules, overtime rate), VAT | `GET/PUT /settings/...` per section |
| `shopsService.js`, `shopAssignmentService.js` | Shop directory per company, locations, assignment + history | `GET/POST /shops`, `PATCH /shops/:id/location`, `POST /employees/:staffId/shop` |
| `geocodingService.js` | Shop location lookup — **proxy it through the server** (see §4) | `GET /geocode?shop&area&town` |
| `salesMonitoringService.js` | SMS verification schedule and results, GPS/geofence checks, alerts, live board | `GET /monitoring/reps`, `GET /monitoring/reps/:id?date`, `GET /monitoring/alerts`, `PATCH /monitoring/alerts/:id` |
| `notificationsService.js` | Generate exceptions **on the server** (scheduled job / on events), no duplicates per source; read/assign/resolve/dismiss with history | `GET /notifications`, `PATCH /notifications/:id`, `POST /notifications/:id/comments` |
| `leaveService.js` | Leave records (approved leave is never absence). Demo data only — a leave module is not built yet | `GET /leave?employee&from&to` |
| `auditService.js`, `auditStore.js` | **Append-only** audit log written by the server for every change | `GET /audit?company&from&to`, `GET /audit/export` |
| `permissionsService.js` | Real authentication and sessions; permission checks per module and company | `POST /auth/login`, `POST /auth/logout`, `GET /me` |
| `assistantService.js` | Can stay client-side (it only reads records), or move server-side later | — |

Shared helpers that should stay as they are (or be mirrored on the server):
`src/utils/accraTime.js` (Accra dates), `src/utils/attendanceRules.js`
(period dates, working days, holidays), `src/utils/tenure.js` (time with the
company), `src/utils/payPeriod.js` (26th–25th periods).

### 3. Data model (minimum)

- **Company**: id (`box-for-less`, `double-a`), name, Staff ID prefix (`BFL`, `DAA`), profile.
- **Employee**: staffId, companyId, names, phone, email, address, position,
  paymentMethod, emergencyContactName, emergencyContactPhone, joinedOn,
  registeredAt, status, enrolled face template (not the raw photo — see §5).
- **AttendanceEvent**: staffId, type (check-in/out), server timestamp, source,
  verification result, photo reference.
- **AttendanceCorrection / ManualEntry**: record key (staffId + date), previous
  and new values, reason, remarks, changedBy, changedAt.
- **Shop**: id, companyId, name, town, area, address, latitude, longitude,
  locationSource, geofenceRadius (150), status. **ShopAssignment** with history.
- **VerificationEvent** (field staff): staffId, dispatchedAt, respondedAt,
  result, distance, accuracy.
- **Holiday**: date, name, kind (public / HR), createdBy.
- **Settings versions**: working hours, attendance rules, overtime rate — each
  with `effectiveFrom`.
- **Notification**: sourceKey (unique), type, company, employee, severity,
  status, assignee, history.
- **AuditEvent**: id, time, actor, action, category, companies, affected,
  previous, next. Never updated or deleted.
- **HrUser**: one HR Manager account today; model it so more users and roles
  can be added later without schema changes.

### 4. External integrations to build

| Integration | Today (mock) | What to build |
|---|---|---|
| Face verification | Photo is captured; match is simulated | Server-side face matching against the enrolled template; liveness check; attempt limits |
| SMS verification | Results generated for past times only | SMS provider, random schedule generated and **kept on the server**, reply handling, delivery failures |
| GPS / geofence | Distances simulated | Location capture on the device at verification time; distance check on the server |
| Shop location lookup | Optional OpenStreetMap Nominatim call **from the browser**, off by default | Call the geocoder from the server (respect the provider's usage policy, add caching, or use a paid provider with a server-side key). Never put API keys in the frontend |
| Map tiles | OpenStreetMap tiles from the browser when lookup is on | Choose a tile provider suitable for production use |
| File storage | Photos as data URLs in `localStorage` | Object storage for registration and check-in photos, with access control |
| Email / push | None (nothing is sent) | Only if needed later |

### 5. Security and privacy

- Real authentication (no "demo sign-in"), MFA for HR, session timeout
  (currently a demo setting), rate limiting, HTTPS only.
- Enforce company separation and permissions on **every** endpoint.
- Face images and templates are **biometric data**: store encrypted, limit
  access, keep the consent recorded at registration, and define retention and
  deletion. Follow Ghana's Data Protection Act, 2012 (Act 843).
- Emergency contacts and phone numbers are personal data — only HR should see
  them.
- Do not expose future SMS schedules or other employees' data through any API.

### 6. Demo data to remove

The mock services seed demo data. None of it should reach production:

- Demo sales reps (`BFL-1001`…`BFL-1005`, `DAA-1001`…`DAA-1004`) and their
  generated verification events — `salesMonitoringService.js`
- Demo shops (China Mall, Shoprite, Melcom) — `shopsService.js`. Only China
  Mall, Ashaiman has real coordinates (5.68486, -0.02419), supplied by HR.
- Demo leave records — `leaveService.js`
- The demo HR account and sign-in screen — `permissionsService.js`,
  `components/access/AccessScreens.jsx`
- Test hook: registering with the first name `Fail` forces an error —
  `registrationService.js`
- Mock attendance data before **2026-10-01** (`DIGITAL_GO_LIVE_DATE`) is
  treated as historical (paper) data.

`localStorage` keys used by the mocks (useful when testing; delete them to
reset): `mock-registration:*`, `mock-attendance:*`, `mock-settings:v1`,
`mock-audit:events`, `mock-notifications:*`, `mock-shops:*`,
`mock-shop-assignments:*`, `mock-holidays:v1`, `mock-hr-users:v5`,
`mock-hr-session`, `mock-sales-monitoring:alert-state`.

### 7. Acceptance checks for the backend

- One record per employee per day, whatever the source.
- Late after 09:00; no check-out after 19:00; no absence before 17:00 or on
  weekends, holidays or approved leave.
- Weekday overtime only after 17:01; weekend and holiday overtime from clock-in
  to clock-out; one total per period; pay uses the rate in force on each day.
- Adding a holiday on a past date turns that day's absences into holidays and
  its work into full-day overtime; removing it reverses that.
- Changing working hours or the overtime rate from a future date does not
  change earlier days.
- Box For Less never sees Double A data and vice versa (except the HR Manager,
  with each record labelled).
- No API returns a future SMS check time.
- Every change appears in the audit log with who, when, company, previous and
  new values.

### 8. Leftover files

These files are no longer used by the app and can be deleted when convenient:
`src/pages/HistoricalImport.jsx`, `src/components/historical-import/`,
`src/services/historicalImport*.js`, `src/pages/ShiftsManagement.jsx`,
`src/components/shifts/`, `src/services/shiftAssignmentService.js`,
`src/pages/HrUsers.jsx`, `src/components/hr-users/`,
`src/services/reportsService.js`. (`shiftsService.js` is still imported for its
time helpers and to label past shift changes in the audit log, so keep it until
those are moved.)

## Project structure

```
src/
  pages/
    Home.jsx, EmployeeRegistration.jsx, AttendanceCheckIn.jsx   # employee portal
    HrDashboard.jsx                                              # HR portal shell + dashboard, employees, reports
    AttendanceManagement.jsx, SalesMonitoring.jsx, Overtime.jsx,
    NotificationsCenter.jsx, Settings.jsx, AuditLogs.jsx         # HR modules
  components/
    registration/    attendance/    hr/    sales-monitoring/    shops/
    notifications/   settings/      reports/    assistant/    access/
  services/          # MOCK backend services (see the table above)
  constants/         # companies, labels, notification types, holidays
  utils/             # Accra time, attendance rules, pay periods, tenure, validation
  styles/            # per-area CSS; hr-neumorphism.css is the HR portal theme
```
