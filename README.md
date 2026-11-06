# Workforce Attendance

Multi-company workforce management and attendance system for Box For Less and
Double A. **Frontend only** — all backend behaviour is simulated by clearly
labeled mock services.

Implemented so far:

- **Step 1: Employee self-registration**
- **Step 2: Attendance check-in / check-out** (Staff ID + face verification)

## Running the project

```bash
npm install   # first time only
npm run dev   # start the dev server
```

Open http://localhost:5173/ in a browser. Camera-based face enrollment requires
a secure context — `localhost` works out of the box.

Other scripts:

```bash
npm run build    # production build
npm run preview  # preview the production build
npm run lint     # oxlint
```

## What is implemented

A connected 7-screen registration flow with a progress indicator:

1. **Welcome** — introduction and Start Registration.
2. **Company selection** — Box For Less or Double A (exactly one required).
3. **Personal information** — required: first name, last name, phone; optional:
   middle name, email, residential address, emergency contact. Inline
   validation for required fields, phone and email formats.
4. **Face enrollment** — live camera preview, capture, review and retake.
   Camera permission is requested only on this screen; permission-denied and
   camera-unavailable states are handled gracefully. Capture only — biometric
   verification is a backend responsibility.
5. **Job position** — searchable list plus an "Other" free-text option.
   Privileged roles (admin/HR/supervisor) cannot be self-assigned.
6. **Review** — full summary with per-section Edit, biometric consent
   checkbox, and guarded submission (loading state, duplicate-submit
   prevention, error banner with retry).
7. **Success** — generated Staff ID (e.g. `BFL-0001`, `DAA-0001`), ACTIVE
   status, Copy Staff ID, downloadable confirmation, and reset to welcome.

## Step 2 — Attendance check-in / check-out

A home screen offers **Attendance Check-In** or **New Employee Registration**.
The attendance flow:

1. **Enter Staff ID** — looks up the registered employee (mock). Unknown IDs
   are rejected with a helpful message.
2. **Live face scan** — a live camera scanner (corner-bracket frame + sweeping
   scan line) captures a fresh photo and simulates verification. Camera
   permission is requested only on this screen; denied/unavailable states are
   handled.
3. **Verified result** — on success the employee's details pop up together
   with the photo they used at registration, plus the recorded timestamp.

**Strict rule:** an employee completes at most one check-in and one check-out
per day. After a successful verification the flow ends (only a "Done" button —
no "record another"). The next required action is a check-out; once both are
done, further attempts are blocked at lookup and again at record time in the
mock service, so a duplicate check-in cannot be created.

## Mock services (not a backend)

[src/services/registrationService.js](src/services/registrationService.js)
simulates the backend: it assigns sequential company-prefixed Staff IDs
(counters persist in `localStorage`) and resolves after a short delay.
**Staff ID generation shown here is mock-only** — in production the backend
must generate IDs. Replace `submitRegistration` with the real API call once
the backend contract exists.

Test hook: registering with the first name `Fail` forces a simulated server
error so the failure path can be exercised.

[src/services/attendanceService.js](src/services/attendanceService.js)
simulates attendance: employee lookup by Staff ID, per-day check-in/check-out
toggling, and event recording (persisted in `localStorage`). **Face
verification is mock-only** — the frontend captures a photo; real biometric
matching is a backend responsibility.

## Project structure

```
src/
  components/registration/      # one presentational component per screen
  constants/companies.js        # company metadata
  pages/Home.jsx                # entry screen (register vs attendance)
  pages/EmployeeRegistration.jsx # registration wizard
  pages/AttendanceCheckIn.jsx   # attendance check-in/out flow
  services/registrationService.js # MOCK registration + employee directory
  services/attendanceService.js   # MOCK attendance events
  styles/registration.css       # shared styles
  utils/validation.js           # field validators
  utils/registrationValidation.js # step-level validation (business logic)
```
