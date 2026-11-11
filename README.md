# Workforce Pro — Attendance & HR

Workforce management and attendance for two companies, **Box For Less** and
**Double A**. It has two parts:

- **Employee portal** (`/`) — self-registration and daily check-in / check-out
  with face capture.
- **HR portal** (`/hr`) — one HR account (HR Manager) that runs both companies:
  employees, attendance, sales reps, reports, overtime, holidays, settings and
  audit logs.

> **Status:** the app runs on Supabase. Before real use, finish the
> [setup steps](#first-time-setup) and read the
> [limits to accept](#limits-to-accept-before-go-live).

## Running the project

Create `.env.local` from `.env.example`, then:

```bash
npm install   # first time only
npm run dev   # http://localhost:5173  (HR portal: http://localhost:5173/hr)
```

```bash
npm run build    # production build
npm run preview  # preview the production build
npm run lint     # oxlint
npm test         # the business rules
```

Camera capture needs a secure context; `localhost` works out of the box, and a
hosted copy needs HTTPS.

## What the app does

### Employee portal

- **Registration** (7 steps): company → personal details (incl. optional
  emergency contact name and phone) → face enrollment → job position (and an
  allocated shop for Sales Representatives and Merchandisers) → review with
  biometric consent → Staff ID (`BFL-0001`, `DAA-0001`).
- **Attendance**: Staff ID → live face scan → check-in or check-out.
  One check-in and one check-out per day. The windows follow Settings: check-in
  from 06:00 (after the late-coming time, 09:00 by default, it is **late**);
  check-out from the official clock-out time (17:00) for the clock-out window
  (6 hours by default, never past midnight), so late work is recorded as
  overtime. Days off and holidays are allowed and are overtime.
- **Failed face scans**: after 5 in a day the Staff ID is locked at the kiosk
  until tomorrow and HR gets a critical alert. Nobody is marked absent by it,
  because anyone can type a Staff ID. HR adds a manual entry if the employee
  was really at work.

### HR portal (`/hr`)

| Area | What it does |
|---|---|
| Dashboard | Today's figures per company and combined; today's register |
| Employees | Directory cards with emergency contact; HR sets the **date joined** and the time with the company is calculated (years, months, days); shop assignment for field staff; **deactivate** a leaver from their last working day so later days are not absences |
| Attendance | One record per employee per day (from check-ins, SMS verification, or HR manual entry); corrections with full history; manual entry for paper records |
| Sales Reps | Rep monitoring, 3 random SMS verification checks per working day, 150 m shop geofence, alerts, shop directory with map locations, live field board |
| Reports | Monthly report (26th–25th) with working days, hours, overtime and pay; daily records; **Overtime** tab |
| Settings | General, company profiles, attendance rules, working hours, **holidays**, sales-rep monitoring, notifications, security, data export, **Audit Logs** tab |
| Notifications | Exceptions (late, absent, missing clock-out, failed verifications, missing shop…) with assign / review / resolve / dismiss |
| HR Assistant | Rule-based chat that answers from the records (no AI service) |

## Business rules

The server applies these using server time. The browser only displays the result.

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

## Backend

Supabase project **ATTENDANCE** (`aiiglvsvrbtahihttwge`).

```
Employee pages (no login) ──> Edge Function `api` (public routes, rate limited)
HR portal (sign-in + MFA) ──> Edge Function `api` for every write
                          └─> Postgres reads under row-level security, into memory
pg_cron + pg_net ─────────> `api` /jobs/* (secret header)
```

- **Writes go through the server.** Browsers have no write access to any table.
  Each route checks the session and company, validates, uses server time, and
  saves together with its audit entry in one transaction.
- **HR reads need MFA.** A password alone reads nothing, and an HR user only
  sees their own companies.
- **Daily records are derived, never stored.** They are built from check-ins,
  corrections, holidays, leave and effective-dated settings, so a new holiday
  applies as soon as records are next built.
- **There is one copy of the rules**, in `supabase/functions/_shared/rules/`,
  imported by both the server and the browser. HR screens and CSV exports
  calculate in the browser from server facts using that same code.
- **Future SMS times are unreadable.** They exist only in a table no client can
  reach, and a check becomes visible once it has been sent.

### First-time setup

1. **Turn off public sign-up.** Dashboard → Authentication → Sign In / Providers:
   switch off *Allow new users to sign up*, and set the minimum password length
   to at least 12.
2. **Create the HR Manager account**, on your own computer so the password stays
   private. The service role key is on Dashboard → Settings → API.

   ```bash
   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/create-hr-manager.mjs
   ```

   The first sign-in at `/hr` sets up the authenticator app.
3. **Turn on the scheduled jobs.** Generate one random value, then store it in
   both places:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx supabase secrets set JOBS_SECRET=<value> --project-ref aiiglvsvrbtahihttwge
   ```

   ```sql
   -- Dashboard → SQL Editor
   select vault.create_secret('<value>', 'jobs_secret');
   ```

   Until then the jobs do nothing. Notifications are still raised after each HR
   change and when the Notifications page opens.
4. **Face recognition works with no setup.** It uses face-api, an open-source
   model that runs on the phone (see Limits). `npm run dev` and `npm run build`
   copy its model files into `public/face-models`; the phone downloads them
   (about 7 MB) once. To use AWS Rekognition instead, which checks the photos on
   AWS servers, create an AWS IAM user with only this permission and an access
   key. Anyone enrolled under one provider has to enrol again after switching.
   AWS accounts on the Free plan block Rekognition; upgrade the plan first.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{ "Effect": "Allow", "Action": ["rekognition:CompareFaces", "rekognition:DetectFaces"], "Resource": "*" }]
   }
   ```

   Also turn on an AI services opt-out policy for Rekognition in AWS
   Organizations, so AWS does not keep staff photos to improve its service.

   ```bash
   npx supabase secrets set FACE_PROVIDER=rekognition REKOGNITION_REGION=eu-west-1 \
     REKOGNITION_ACCESS_KEY_ID=<id> REKOGNITION_SECRET_ACCESS_KEY=<secret> \
     --project-ref aiiglvsvrbtahihttwge
   ```

5. **Empty the test photos.** Dashboard → Storage: clear the `face-enrollment`
   and `attendance-photos` buckets. They hold generated test patterns only.
6. **When the app is hosted**, set `ALLOWED_ORIGINS` (comma-separated) and
   `APP_URL` as function secrets, then redeploy.

### Function secrets

| Name | Purpose |
|---|---|
| `JOBS_SECRET` | Lets the scheduler call `/jobs/*`. Must match Vault's `jobs_secret` |
| `FACE_PROVIDER` | Unset (or `faceapi`) uses face-api on the phone. `rekognition` uses AWS |
| `REKOGNITION_REGION` | AWS region, e.g. `eu-west-1` |
| `REKOGNITION_ACCESS_KEY_ID` | Key for the AWS user described in setup |
| `REKOGNITION_SECRET_ACCESS_KEY` | Secret for that user |
| `SMS_PROVIDER` | `none` (default) sends no checks; `log` prints them for testing |
| `APP_URL` | Base address used in SMS links, e.g. `https://attendance.example.com` |
| `ALLOWED_ORIGINS` | Sites allowed to call the API. Defaults to localhost |

### Deploying

```bash
npx supabase functions deploy api --project-ref aiiglvsvrbtahihttwge --use-api --no-verify-jwt
```

`--no-verify-jwt` is required because employee check-in has no login. The
function verifies HR sessions itself.

### Live checks

These run against the hosted project and create test rows. Do not run them once
real employees are registered: they reset the Staff ID counters only when no
employees remain, and `smoke-employee` leaves its rows behind. They send made-up
face readings, so they only work while `FACE_PROVIDER` is unset or `faceapi`.

```bash
node scripts/smoke-employee.mjs
SUPABASE_ACCESS_TOKEN=<token> node scripts/smoke-hr.mjs   # removes what it creates
```

### Swapping in real services

- **Face matching:** all of it is in `supabase/functions/_shared/faceMatcher.ts`.
- **SMS:** add a provider in `supabase/functions/_shared/smsSender.ts` and set
  `SMS_PROVIDER`. Checks start the next day.

### Limits to accept before go-live

- **With face-api the phone reads the face, so the server trusts the phone.**
  Someone who rewrites the app could send a made-up face reading, but they would
  need a photo of the person to make one that matches. AWS Rekognition checks the
  photos on the server instead. Settings → Security shows which check is active.
- **There is no liveness check**, so a printed photo of an employee can pass with
  either provider.
- **Face photos are stored, and with AWS processed, outside Ghana.** The
  registration consent says so. Have a lawyer confirm this meets Act 843.
- **SMS checks are off** until a provider is chosen.
- **Device GPS can be spoofed.**
- **Face photos are stored** privately for HR display, which needs covering under
  Ghana's Data Protection Act (Act 843), including how long they are kept.
- **Registration is open to anyone with the link**, with rate limiting only.
- **Leave has no screen yet.** The rules honour `leave_records`, but rows must be
  added directly in the database.
- **Settings marked "not enforced yet"** are saved but have no effect.

## Project structure

```
src/
  pages/             # employee portal, HR modules, /verify/:token
  components/        # by area: registration, attendance, hr, sales-monitoring,
                     #   shops, notifications, settings, reports, assistant, access
  services/          # what screens call; reads from memory, writes through the API
    backend/         # Supabase client and the in-memory cache
  constants/         # companies, labels
  utils/             # browser helpers; rules are re-exported from the shared folder
  styles/            # per-area CSS; hr-neumorphism.css is the HR portal theme
supabase/
  migrations/        # schema, security rules, scheduled jobs
  functions/api/     # the Edge Function: public, HR and job routes
  functions/_shared/ # business rules, face matcher, SMS sender
tests/               # the business rules
scripts/             # HR account creation and live checks
```

## Frontend updates (11 November 2026)

Added on the frontend; backend work still needed is listed after the table.
Full spec for the backend:
[docs/backend-live-tracker-and-sms-verification.md](docs/backend-live-tracker-and-sms-verification.md).

| Feature | Where | Works today? |
|---|---|---|
| **Live Tracker**: 3D street map (OpenStreetMap) or 3D outline of Ghana, figures for Supervisors (S), Sales Reps (R) and Merchandisers (M), light theme only, place search | HR → Live Tracker | Yes — positions from merchandiser shops and verification checks |
| **Live tracking from clock-in to clock-out** (phone sends its location; refused after clock-out) | Employee phone + Live Tracker | **Needs backend** — today points are kept only in the browser (`src/services/locationTrackingService.js`), so the phone side stays hidden |
| **Daily tracking report** (time tracked, live coverage, signal lost, distance, shop visits; past days; CSV) | Under the Live Tracker map | Layout yes; figures need the tracking backend |
| **Daily shop lists + visit proof** for Sales Reps / Supervisors (proven = scan inside the shop area **and** a 10-minute stay on live tracking) | HR → Field Monitoring → Sales Rep / Supervisor Monitoring | **Needs backend** — lists are kept in the browser (`visitListService.js`); outlet visits are not recorded by the backend yet |
| **Installable app** (manifest, icons, service worker, install card) | Home screen | Yes (service worker in production builds; needs https) |
| **Policies**: Privacy, Location Tracking, Terms, Cookies | `/privacy`, `/tracking-policy`, `/terms`, `/cookies` | Yes — **drafts** until company details in `src/constants/legal.js` are filled in and a lawyer has reviewed them |
| **Leave** in the employee directory | HR → Employees | Read-only from `leave_records`; recording leave needs a backend endpoint |

**Needed from the backend** (in the spec): tracking sessions and points
(`POST /tracking/points`, token in the clock-in response), live map and daily
report endpoints, end-of-day summaries, daily shop lists
(`GET/PUT /employees/:staffId/visit-list`), outlet visits and breaks at the
kiosk, employee categories, leave recording, and SMS verification for **all**
field staff (Supervisors, Sales Reps, Merchandisers).

**Working together without conflicts:** frontend-only features live in their
own files (`src/services/locationTrackingService.js`, `visitListService.js`,
`trackingReportService.js`, `liveTrackerService.js`, `fieldVisitsService.js`,
`leaveView.js`, `mapSearch.js`, `src/utils/localStore.js`,
`src/components/tracker/`, `src/components/tracking/`, `src/content/`). They
only *read* through the backend's services and never change them. When the
backend adds an endpoint, replace the matching browser-storage function in
those files.
