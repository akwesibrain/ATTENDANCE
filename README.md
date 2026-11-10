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
4. **Empty the test photos.** Dashboard → Storage: clear the `face-enrollment`
   and `attendance-photos` buckets. They hold generated test patterns only.
5. **When the app is hosted**, set `ALLOWED_ORIGINS` (comma-separated) and
   `APP_URL` as function secrets, then redeploy.

### Function secrets

| Name | Purpose |
|---|---|
| `JOBS_SECRET` | Lets the scheduler call `/jobs/*`. Must match Vault's `jobs_secret` |
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
employees remain, and `smoke-employee` leaves its rows behind.

```bash
node scripts/smoke-employee.mjs
SUPABASE_ACCESS_TOKEN=<token> node scripts/smoke-hr.mjs   # removes what it creates
```

### Swapping in real services

- **Face matching:** replace `supabase/functions/_shared/faceMatcher.ts`.
- **SMS:** add a provider in `supabase/functions/_shared/smsSender.ts` and set
  `SMS_PROVIDER`. Checks start the next day.

### Limits to accept before go-live

- **Face matching is not face recognition.** It compares two photos as small
  grayscale images, so a printed photo can pass and poor lighting can fail. There
  is no liveness check. Replace it first.
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
