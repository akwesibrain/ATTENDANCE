# HR Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR can create employees (face scanned now or by a 7-day SMS link)
and give other people HR portal access (24-hour setup link; they choose
their own password).

**Architecture:**
- **Shared setup links:** one `setup_links` table serves both features. The
  server stores only token hashes and builds nothing user-visible beyond SMS
  text. The browser builds copyable links from its own origin.
- **Rules:** pure rules live in `_shared/rules/onboarding.js` and are
  unit-tested with vitest.
- **Routes:** new routes sit in two focused route files mounted into the
  existing Hono app.
- **Database:** database work that must be atomic (enrolling with a link,
  changing HR status) is done in SQL functions.

**Tech Stack:** React 19 + Vite, Supabase (Postgres, Auth, Edge Functions on
Deno with Hono 4.6.14), vitest, TxtConnect via the existing `sendSms`.

**Spec:** `docs/superpowers/specs/2026-11-12-hr-onboarding-design.md`

## Global Constraints

- **Link lifetimes:** face link 7 days (`FACE_LINK_HOURS = 168`); HR invite
  link 24 hours (`HR_INVITE_HOURS = 24`).
- **New HR users:** at least 12 characters for the password
  (`MIN_PASSWORD_LENGTH = 12`, matching `scripts/create-hr-manager.mjs`).
  The role is `hr-manager`, with every company.
- **Bad links:** one message for every unusable link, in both the API and the
  UI: `This link has expired or was already used. Ask HR for a new one.`
- **Tokens:** `randomToken(24)` from `_shared/rules/siteCode.js`. Store only
  `sha256Hex(token)` from `api/lib.ts`.
- **Link paths:** `/enroll/<token>` and `/hr/setup/<token>`. Copy links use
  `window.location.origin`; SMS uses the `APP_URL` secret.
- **SMS text** (ASCII only, so the gateway sends it as plain text):
  - Face: `Workforce attendance: hi <first name>, set up your face for check-in here: <url> (valid 7 days).`
  - HR invite: `Workforce HR portal: <inviter name> gave you access. Set your password here: <url> (valid 24 hours).`
- **Audit:** every HR action writes an audit entry through `applyChange` or
  `app_private.write_audit`, using the existing `audit(hr, fields)` shape.
- **Mounting:** new HR routes go on a plain `Hono<HrEnv>()`, mounted with
  `hrRoutes.route('/', …)` in `hr.ts` *after* `requireHr`. Do not mount a
  second router at `/hr` in `index.ts`: its middleware would run twice.
- **Type-checking server code:** `cd supabase/functions && npx -y deno check --node-modules-dir=none api/index.ts`.
  Afterwards, delete `supabase/functions/deno.lock` if it was created.
- **Deploying:** `npx supabase functions deploy api --project-ref aiiglvsvrbtahihttwge --yes`.
- **Migrations:** apply with `npx supabase db query --remote=aiiglvsvrbtahihttwge --yes -f <file>`.

## Review Focus

1. **Two HR users remove each other at the same moment.** Exactly one
   removal succeeds, and one active HR user always remains. The guard lives
   in the SQL function `set_hr_user_status`, which locks the active rows.
   Task 2 adds a live SQL check, and Task 1 tests the pure rule.
2. **Invite email typed with capitals or spaces** (`" Amponsah@Gmail.com "`).
   It matches the existing account and its pending invite, so no second
   account is created. Task 1 tests `validateInvite` normalisation, and
   Task 5 looks up the account through the lowercase SQL function.
3. **Face link submitted twice** (double tap, two tabs). The first save wins,
   and the second gets the generic link message instead of a server error.
   `enroll_face` locks the link row; Task 2 has the live check.
4. **HR link opened for an email that already has a sign-in.** The password
   is never changed, and the response says to use the existing password.
   Task 5 covers this in its live check.
5. **Employee has no phone, an unusable phone, SMS is off, or `APP_URL` is
   missing.** The employee is still created, a link is still returned, and
   the SMS status explains why nothing was sent. Task 1 tests `smsPlan`.

---

### Task 1: Shared onboarding rules

**Files:**
- Create: `supabase/functions/_shared/rules/onboarding.js`
- Modify: `supabase/functions/_shared/rules/registration.js` (`parseRegistration`)
- Test: `tests/onboarding.test.js`

**Interfaces:**
- Produces:
  - `FACE_LINK_HOURS = 168`, `HR_INVITE_HOURS = 24`, `MIN_PASSWORD_LENGTH = 12`
  - `LINK_UNUSABLE = 'This link has expired or was already used. Ask HR for a new one.'`
  - `linkExpiry(kind: 'face'|'hr-invite', nowMs: number) -> string`
    returns an ISO time.
  - `linkState(row: {expires_at, used_at, cancelled_at} | null, nowMs) -> 'open'|'used'|'cancelled'|'expired'|'missing'`
  - `validateInvite({name, email, phone}) -> {value:{name,email,phone}} | {errors}`
    - trims all fields and lowercases the email;
    - name: at least 3 characters;
    - email: uses `validateEmail` from `validation.js`;
    - phone: optional, uses `validateOptionalPhone`.
  - `hrStatusChangeError({actorId, targetId, newStatus, activeCount, targetStatus}) -> string`
    - returns `''` when the change is allowed;
    - `You cannot remove your own access.` when actor equals target and the
      new status is inactive;
    - `At least one person must keep HR access.` when removing the only
      active user;
    - `''` for a no-op.
  - `validateNewPassword(password, confirm) -> string`
    - `''` when valid;
    - `Use at least 12 characters.` when too short;
    - `The two passwords do not match.` when they differ.
  - `smsPlan({phone, smsOn, appUrl}) -> {send: boolean, reason: string}`.
    The reason is one of:
    - `''` (when sending);
    - `SMS is switched off.`
    - `The app address (APP_URL) is not set.`
    - `No usable phone number.` (uses `smsRecipient` from `smsPhone.js`)
  - `parseRegistration(body, { faceRequired = true } = {})`. When
    `faceRequired` is false, the `biometricConsent` error is not raised.
    Everything else is unchanged.

- [ ] **Step 1: Write the failing tests in `tests/onboarding.test.js`**

```js
import { describe, expect, it } from 'vitest'
import { FACE_LINK_HOURS, HR_INVITE_HOURS, LINK_UNUSABLE, hrStatusChangeError, linkExpiry, linkState, smsPlan, validateInvite, validateNewPassword } from '../supabase/functions/_shared/rules/onboarding.js'
import { parseRegistration } from '../supabase/functions/_shared/rules/registration.js'

const NOW = Date.parse('2026-11-12T10:00:00Z')

describe('links', () => {
  it('lasts 7 days for faces and 24 hours for HR invites', () => {
    expect(FACE_LINK_HOURS).toBe(168)
    expect(HR_INVITE_HOURS).toBe(24)
    expect(linkExpiry('face', NOW)).toBe('2026-11-19T10:00:00.000Z')
    expect(linkExpiry('hr-invite', NOW)).toBe('2026-11-13T10:00:00.000Z')
  })
  it('reports the state of a link', () => {
    const open = { expires_at: '2026-11-13T00:00:00Z', used_at: null, cancelled_at: null }
    expect(linkState(open, NOW)).toBe('open')
    expect(linkState({ ...open, used_at: '2026-11-12T09:00:00Z' }, NOW)).toBe('used')
    expect(linkState({ ...open, cancelled_at: '2026-11-12T09:00:00Z' }, NOW)).toBe('cancelled')
    expect(linkState({ ...open, expires_at: '2026-11-12T09:59:59Z' }, NOW)).toBe('expired')
    expect(linkState(null, NOW)).toBe('missing')
  })
  it('has one message for every unusable link', () => {
    expect(LINK_UNUSABLE).toBe('This link has expired or was already used. Ask HR for a new one.')
  })
})

describe('validateInvite', () => {
  it('trims and lowercases the email', () => {
    expect(validateInvite({ name: ' Ama Owusu ', email: ' Amponsah@Gmail.com ', phone: '' }).value)
      .toEqual({ name: 'Ama Owusu', email: 'amponsah@gmail.com', phone: '' })
  })
  it('rejects a short name, a bad email and a bad phone', () => {
    const { errors } = validateInvite({ name: 'Al', email: 'nope', phone: '12' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'phone'])
  })
})

describe('hrStatusChangeError', () => {
  const base = { actorId: 'a', targetId: 'b', newStatus: 'inactive', activeCount: 2, targetStatus: 'active' }
  it('allows removing someone else while another HR user stays active', () => {
    expect(hrStatusChangeError(base)).toBe('')
  })
  it('refuses removing yourself', () => {
    expect(hrStatusChangeError({ ...base, targetId: 'a' })).toBe('You cannot remove your own access.')
  })
  it('refuses removing the last active HR user', () => {
    expect(hrStatusChangeError({ ...base, activeCount: 1 })).toBe('At least one person must keep HR access.')
  })
  it('allows restoring access', () => {
    expect(hrStatusChangeError({ ...base, newStatus: 'active', targetStatus: 'inactive', activeCount: 1 })).toBe('')
  })
})

describe('validateNewPassword', () => {
  it('needs 12 characters and a matching confirmation', () => {
    expect(validateNewPassword('short', 'short')).toBe('Use at least 12 characters.')
    expect(validateNewPassword('long-enough-1', 'long-enough-2')).toBe('The two passwords do not match.')
    expect(validateNewPassword('long-enough-1', 'long-enough-1')).toBe('')
  })
})

describe('smsPlan', () => {
  const ok = { phone: '024 123 4567', smsOn: true, appUrl: 'https://app.example' }
  it('sends when everything is in place', () => expect(smsPlan(ok)).toEqual({ send: true, reason: '' }))
  it('explains why it will not send', () => {
    expect(smsPlan({ ...ok, smsOn: false }).reason).toBe('SMS is switched off.')
    expect(smsPlan({ ...ok, appUrl: '' }).reason).toBe('The app address (APP_URL) is not set.')
    expect(smsPlan({ ...ok, phone: '12' }).reason).toBe('No usable phone number.')
  })
})

describe('parseRegistration without a face', () => {
  const body = { companyId: 'box-for-less', firstName: 'Ama', lastName: 'Owusu', phone: '0241234567', email: '', address: 'Accra', emergencyContactName: 'Kofi Owusu', emergencyContactPhone: '0201234567', paymentMethod: 'bank', position: 'Cashier' }
  it('still requires consent by default', () => {
    expect(parseRegistration(body).errors.biometricConsent).toBeTruthy()
  })
  it('skips consent when HR adds the employee without a face', () => {
    expect(parseRegistration(body, { faceRequired: false }).errors?.biometricConsent).toBeUndefined()
  })
})
```

When writing these tests, check `companyId`, `paymentMethod` and `position`
against `PAYMENT_METHODS`, the positions list and the companies in the shared
rules, and use values those accept. The two parse tests must assert only on
`biometricConsent`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/onboarding.test.js`
Expected: FAIL, because `onboarding.js` does not exist.

- [ ] **Step 3: Implement `onboarding.js`** using the Interfaces above, and add
the `faceRequired` option to `parseRegistration`.

- [ ] **Step 4: Run all the tests**

Run: `npx vitest run`
Expected: everything passes (129 existing tests plus the new ones).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/rules/onboarding.js supabase/functions/_shared/rules/registration.js tests/onboarding.test.js
git commit -m "Add shared rules for setup links and HR access"
```

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20261112090000_hr_onboarding.sql`

**Interfaces:**
- Produces these tables, all service-role only with RLS forced (copy the loop
  from `20261111090000_workplace_displays.sql`):
  - **`hr_invites`:**
    - `id text primary key`
    - `name text not null`
    - `email text not null`
    - `phone text not null default ''`
    - `invited_by text not null`
    - `created_at timestamptz not null default now()`
    - `status text not null default 'pending'`, checked to be one of
      `pending`, `accepted` or `cancelled`
    - `accepted_user_id uuid`
    - a unique index on `(email)` where `status = 'pending'`
  - **`setup_links`:**
    - `token_hash text primary key`
    - `kind text not null`, checked to be `face` or `hr-invite`
    - `staff_id text references employees(staff_id)`
    - `invite_id text references hr_invites(id)`
    - `expires_at timestamptz not null`
    - `used_at timestamptz`
    - `cancelled_at timestamptz`
    - `created_by text not null`
    - `created_at timestamptz not null default now()`
    - a check:
      `(kind = 'face' and staff_id is not null and invite_id is null) or (kind = 'hr-invite' and invite_id is not null and staff_id is null)`
    - an index on `(staff_id)` and one on `(invite_id)`
- Produces these functions. Each is `security definer` with
  `set search_path = ''`, and has execute revoked from public, anon and
  authenticated and granted to `service_role`:
  - **`register_employee`:** `create or replace` with the same signature.
    When `p_template is null`, skip the `face_templates` insert and insert
    `biometric_consent_at` as null. Otherwise behave exactly as now. Copy the
    current body from `20261110150000_core_schema.sql` and change only those
    two places.
  - **`public.enroll_face(p_token_hash text, p_template jsonb, p_photo_path text) returns jsonb`:**
    1. Select the link `for update` where `kind = 'face'`.
    2. If it is missing, used, cancelled or expired, raise the generic link
       message with `errcode = 'P0001'`.
    3. Upsert `face_templates` (`on conflict (employee_id) do update`, which
       also sets `updated_at`).
    4. Update `employees` to set `face_photo_path`, and set
       `biometric_consent_at = now()`.
    5. Set the link's `used_at = now()`.
    6. Write an audit entry: source `Employee onboarding`, action
       `Face set up by link`.
    7. Return `{staff_id, full_name, company_id, previous_photo_path}`.
       `previous_photo_path` is the old path, so the server can delete the
       old photo.
  - **`public.auth_user_id_for_email(p_email text) returns uuid`:** returns
    the `id` from `auth.users` where `lower(email) = lower(trim(p_email))`.
  - **`public.set_hr_user_status(p_actor uuid, p_target uuid, p_status text) returns jsonb`:**
    - lock all `hr_users` rows with `status = 'active'` (`for update`);
    - apply the same rules and messages as `hrStatusChangeError` from Task 1,
      raising them with `errcode = 'P0001'`;
    - update the status, and return the updated row as jsonb.
- Adds `'hr_invites'` and `'setup_links'` to the `writable` array of
  `apply_change`. Re-create it from the latest version in
  `20261111090000_workplace_displays.sql` and change only the array.

- [ ] **Step 1: Write the migration** to the Interfaces above.

- [ ] **Step 2: Apply it**

Run: `npx supabase db query --remote=aiiglvsvrbtahihttwge --yes -f supabase/migrations/20261112090000_hr_onboarding.sql`
Expected: no error.

- [ ] **Step 3: Verify the schema with a read-only query**

Run:

```bash
npx supabase db query --remote=aiiglvsvrbtahihttwge --read-only "select to_regclass('public.setup_links') is not null as links, to_regclass('public.hr_invites') is not null as invites, (select count(*) from pg_proc where proname in ('enroll_face','auth_user_id_for_email','set_hr_user_status')) as fns, position('setup_links' in (select prosrc from pg_proc where proname='apply_change')) > 0 as apply_change_ok"
```

Expected: `links` true, `invites` true, `fns` 3, `apply_change_ok` true.

- [ ] **Step 4: Check the guards (Review Focus 1 and 3) inside a rolled-back transaction**

Run one query that does the following, and expect both `P0001` messages.
Wrap it in `begin; … rollback;` so nothing is kept:
1. Call `set_hr_user_status` on the only active user, with themselves as
   actor, and expect the "own access" message.
2. Insert a face link for an existing employee, call `enroll_face` twice, and
   expect the second call to raise the generic link message.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261112090000_hr_onboarding.sql
git commit -m "Add setup links, HR invites and onboarding database functions"
```

---

### Task 3: Server helpers for enrolment and links

**Files:**
- Create: `supabase/functions/api/enrolment.ts`. Move `ENROLLMENT_BUCKET`,
  `faceSample` and `readable` here from `public.ts` unchanged, and export them.
- Create: `supabase/functions/api/setupLinks.ts`
- Modify: `supabase/functions/api/public.ts`, so it imports the moved helpers
  and no longer defines them.

**Interfaces:**
- Consumes: Task 1's rules, plus `db`, `must`, `applyChange`, `sha256Hex` and
  `ApiError` from `lib.ts`; `randomToken` from `siteCode.js`; and
  `sendSms`/`smsConfigured` from `_shared/smsSender.ts`.
- Produces from `enrolment.ts`:
  - `ENROLLMENT_BUCKET`, `faceSample(body)`, `readable(action)`
  - `enrolNewFace(body, companyId) -> Promise<{ template, photoPath }>`. It
    calls `faceSample`, then `readable(() => enrollFace(…))`, then
    `storePhoto`, using the photo path pattern `${companyId}/${crypto.randomUUID()}.jpg`.
- Produces from `setupLinks.ts`:
  - `type LinkResult = { token: string; expiresAt: string; sms: 'sent'|'skipped'|'failed'; smsReason: string }`
  - `createLink(kind, subject: { staffId?: string; inviteId?: string }, createdBy: string) -> Promise<{ token, expiresAt }>`.
    In one `applyChange` call, it sets `cancelled_at = now` on the subject's
    open links of the same kind, then inserts the new hashed link.
  - `openLink(token: string, kind) -> Promise<row>`. It throws
    `new ApiError(404, LINK_UNUSABLE)` unless `linkState` returns `'open'`.
  - `deliverLink({ phone, message: (url: string) => string, path: string }) -> Promise<{ sms, smsReason }>`.
    It uses `smsPlan` with `APP_URL` (trailing slash removed). When sending,
    it calls `sendSms(phone, message(appUrl + path))` and returns `failed`
    with `The SMS provider refused the message.` when that returns false.

- [ ] **Step 1: Move the helpers and create both files** to the Interfaces
above. The registration route in `public.ts` should call `enrolNewFace`.

- [ ] **Step 2: Type-check and run the tests**

Run: `cd supabase/functions && npx -y deno check --node-modules-dir=none api/index.ts && cd ../.. && npx vitest run`
Expected: `Check api/index.ts`, and all tests pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/api/enrolment.ts supabase/functions/api/setupLinks.ts supabase/functions/api/public.ts
git commit -m "Share face enrolment and setup link helpers on the server"
```

---

### Task 4: Employee onboarding routes

**Files:**
- Create: `supabase/functions/api/employeeOnboarding.ts`, exporting
  `hrEmployeeRoutes` (`new Hono<HrEnv>()`) and `publicEnrolRoutes`
  (`new Hono()`).
- Modify: `supabase/functions/api/hr.ts`, adding
  `hrRoutes.route('/', hrEmployeeRoutes)` after `hrRoutes.use('*', requireHr)`.
- Modify: `supabase/functions/api/index.ts`, adding
  `app.route('/', publicEnrolRoutes)` before `app.route('/', publicRoutes)`.

**Interfaces:**
- Consumes: Task 3 (`enrolNewFace`, `createLink`, `openLink`, `deliverLink`,
  `readable`, `faceSample`, `ENROLLMENT_BUCKET`), `parseRegistration` (Task 1
  option), `assertCompany` from `auth.ts`, and `audit` (copy the one-line
  helper from `hr.ts` or export it from there).
- Produces the following HTTP routes:
  - **`POST /hr/employees`:** the body is the same as `submitRegistration`'s,
    plus `sendFaceLink?: boolean`.
    - Parse with `parseRegistration(body, { faceRequired: Boolean(body.faceImage) })`
      and call `assertCompany(c, form.companyId)`.
    - When there is a face, run `enrolNewFace`; otherwise `template = null`
      and `photoPath = null`.
    - Call the `register_employee` RPC exactly as `public.ts` does, deleting
      the stored photo if it fails.
    - Write the audit entry `Employee added by HR`.
    - When there is no face and `sendFaceLink` is set, also create a face
      link and deliver it.
    - Return `201 { staffId, fullName, companyName, link?: LinkResult }`.
  - **`POST /hr/employees/:staffId/face-link`:**
    - Check that the employee exists (404 if not) and run `assertCompany`.
    - Create the link, then deliver it with the face SMS text.
    - Write the audit entry `Face setup link sent`.
    - Return `LinkResult`.
  - **`GET /public/enroll/:token`:**
    - Rate-limit `enrol-view:ip` with `[60, 600]`.
    - Call `openLink(token, 'face')` and return
      `{ fullName, staffId, companyName }`.
  - **`POST /public/enroll/:token`:**
    - Rate-limit `enrol:ip` with `[20, 600]` and `enrol:token:<hash>` with
      `[10, 600]`.
    - Call `openLink`, then `faceSample`, then `readable(() => enrollFace(…))`,
      then `storePhoto`.
    - Call the `enroll_face` RPC. If it throws, delete the new photo; on
      success, delete `previous_photo_path` if set.
    - Return `{ staffId, fullName }`.

- [ ] **Step 1: Implement the routes and mount them.**

- [ ] **Step 2: Type-check and deploy**

Run: `cd supabase/functions && npx -y deno check --node-modules-dir=none api/index.ts && cd ../.. && npx supabase functions deploy api --project-ref aiiglvsvrbtahihttwge --yes`
Expected: `Check api/index.ts`, then `Deployed Functions.`

- [ ] **Step 3: Live-check the generic link message**

Run: `curl -s https://aiiglvsvrbtahihttwge.supabase.co/functions/v1/api/public/enroll/not-a-token`
Expected: `{"error":"This link has expired or was already used. Ask HR for a new one."}`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/api/employeeOnboarding.ts supabase/functions/api/hr.ts supabase/functions/api/index.ts
git commit -m "Let HR add employees and send face setup links"
```

---

### Task 5: HR access routes

**Files:**
- Create: `supabase/functions/api/hrAccess.ts`, exporting `hrAccessRoutes`
  (`Hono<HrEnv>`) and `publicHrSetupRoutes` (`Hono`).
- Modify: `hr.ts` and `index.ts`, mounting them the same way as Task 4.

**Interfaces:**
- Consumes: Task 1 (`validateInvite`, `validateNewPassword`), Task 2's SQL
  functions, and Task 3 (`createLink`, `openLink`, `deliverLink`).
  `db.auth.admin.createUser` comes from the service-role client in `lib.ts`.
- Produces the following HTTP routes:
  - **`GET /hr/users`:** returns `{ users: [{id, name, email, status, lastLoginAt}], invites: [{id, name, email, phone, invitedBy, createdAt, expiresAt}] }`.
    `invites` lists only pending ones; `expiresAt` is the newest open link's.
  - **`POST /hr/invites`:**
    1. Run `validateInvite`, returning 400 `invalid(errors)` on errors.
    2. Refuse with 409 `This person already has HR access.` if
       `auth_user_id_for_email` returns an id with an **active** `hr_users`
       row.
    3. Cancel any pending invite for that email, and cancel its links.
    4. Insert a new invite with `id = crypto.randomUUID()`.
    5. Create the `hr-invite` link and deliver it with the HR SMS text, using
       the inviting HR user's name.
    6. Write the audit entry `HR user invited`.
    7. Return `201 { inviteId, ...LinkResult }`.
  - **`POST /hr/invites/:id/link`:** pending invites only (404 otherwise).
    Creates a new link (the earlier one is cancelled) and delivers it. Audit
    `HR invite link sent`. Returns `LinkResult`.
  - **`POST /hr/invites/:id/cancel`:** sets the invite to `cancelled` and
    cancels its open links. Audit `HR invite cancelled`.
  - **`POST /hr/users/:id/status`** with `{ status }`: calls the
    `set_hr_user_status` RPC with the actor's id. Audit `HR access removed` or
    `HR access restored`. Returns `{ user }`.
  - **`GET /public/hr-setup/:token`:**
    - Rate-limit `hr-setup:ip` with `[20, 600]`.
    - Call `openLink(token, 'hr-invite')` and load the invite.
    - Return `{ name, email, invitedBy, hasAccount }`, where `hasAccount` is
      whether `auth_user_id_for_email` returns an id.
  - **`POST /public/hr-setup/:token`** with `{ password, confirm }`:
    1. Rate-limit the same way, then call `openLink`.
    2. If an account exists, do not touch its password.
    3. If no account exists, run `validateNewPassword` (400 on failure), then
       `db.auth.admin.createUser({ email, password, email_confirm: true })`.
    4. Upsert the `hr_users` row on `id`, with name and email from the invite,
       `role_id: 'hr-manager'`, all company ids and `status: 'active'`.
    5. Mark the invite accepted with `accepted_user_id`, and set the link's
       `used_at`.
    6. Write the audit entry `HR invite accepted`. Steps 4 to 6 are one
       `applyChange` call.
    7. Return `{ email, passwordSet: boolean }`.

- [ ] **Step 1: Implement the routes and mount them.**

- [ ] **Step 2: Type-check and deploy** (same command as Task 4, Step 2).

- [ ] **Step 3: Live-check the generic message**

Run: `curl -s https://aiiglvsvrbtahihttwge.supabase.co/functions/v1/api/public/hr-setup/not-a-token`
Expected: the generic link message.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/api/hrAccess.ts supabase/functions/api/hr.ts supabase/functions/api/index.ts
git commit -m "Let HR invite, remove and restore HR users"
```

---

### Task 6: Browser service for onboarding

**Files:**
- Create: `src/services/onboardingService.js`

**Interfaces:**
- Consumes: `api` and `submit` from `./backend/client`, and `refresh` from
  `./backend/cache`.
- Produces:
  - `enrolUrl(token)` returns `${window.location.origin}/enroll/${token}`.
  - `hrSetupUrl(token)` returns `${window.location.origin}/hr/setup/${token}`.
  - `createEmployeeByHr(registration, { sendFaceLink })`:
    - takes the same fields `submitRegistration` sends;
    - leaves out `faceImage` and `faceDescriptor` when there is no face;
    - sets `biometricConsent` from `registration.confirmed`;
    - calls `submit('/hr/employees', …)`, then `refresh('employees')`.
  - `sendFaceLink(staffId)` returns `LinkResult` or `{ errors }`.
  - `getEnrolment(token)` and `submitEnrolment(token, { faceImage, faceDescriptor })`
    call `api` (public; no session needed).
  - `listHrAccess()`, `inviteHrUser({ name, email, phone })`,
    `resendInvite(id)`, `cancelInvite(id)` and `setHrUserStatus(id, status)`
    all use `submit` for writes.
  - `getHrSetup(token)` and `completeHrSetup(token, { password, confirm })`.

Follow the `submit` result shape `workplaceDisplayService.js` uses (it
returns `{ errors }` on validation failure).

- [ ] **Step 1: Implement the service.**

- [ ] **Step 2: Lint and build**

Run: `npx oxlint -D no-undef src && npx vite build`
Expected: no `no-undef` errors other than browser globals, and `built in`.

- [ ] **Step 3: Commit**

```bash
git add src/services/onboardingService.js
git commit -m "Add the browser service for onboarding"
```

---

### Task 7: Add-employee form and directory actions

**Files:**
- Create: `src/components/hr/LinkResult.jsx`, which shows a link:
  - **Props:** `{ url, expiresAt, sms, smsReason }`.
  - **SMS line:** `SMS sent.`, or `SMS not sent: <smsReason>`, or
    `SMS failed: <smsReason>`.
  - **Expiry:** formatted with `formatAccraDateTime`.
  - **Copy button:** uses `navigator.clipboard.writeText` and shows `Copied`
    for 2 seconds.
- Create: `src/components/hr/AddEmployeeModal.jsx`, with props
  `{ onClose, onCreated }`.
  - **Step 1:** `PersonalInformation`.
  - **Step 2:** `JobPosition`.
  - **Step 3:** a choice between **Scan now** (shows `FaceEnrollment` plus the
    consent checkbox copy from `RegistrationReview.jsx`) and
    **Send a setup link**.
  - **Result:** the Staff ID, plus `LinkResult` when a link was made.
  - Keep the form state shape identical to `EmployeeRegistration.jsx`'s
    `registration` object, so the reused components work unchanged.
- Modify: `src/components/hr/EmployeeDirectory.jsx`:
  - an **Add employee** button in the header, shown when
    `can(user, 'employees', 'create')`;
  - a `Face not set up` badge where `!employee.facePhotoPath`.
- Modify: `src/components/hr/EmployeeDetailsModal.jsx`: add a
  **Send face setup link** button that calls `sendFaceLink` and renders
  `LinkResult`.
- Modify: `src/styles/employee-directory.css`, adding only what the new
  elements need.

**Interfaces:**
- Consumes: Task 6's `createEmployeeByHr`, `sendFaceLink` and `enrolUrl`.

- [ ] **Step 1: Implement the components.**

- [ ] **Step 2: Lint and build** (same command as Task 6, Step 2).

- [ ] **Step 3: Check in the dev server.**
  - Sign in at `http://localhost:5173/hr` and add an employee with
    **Send a setup link**.
  - Expected: a Staff ID, a copyable `/enroll/…` link, and a
    `Face not set up` badge in the directory.

- [ ] **Step 4: Commit**

```bash
git add src/components/hr src/styles/employee-directory.css
git commit -m "Let HR add employees from the Employees page"
```

---

### Task 8: Face setup page

**Files:**
- Create: `src/pages/EnrolFace.jsx`, with props `{ token }`. It has four
  states:
  - **Loading:** use `PageSkeleton`.
  - **Bad link:** shows `LINK_UNUSABLE`.
  - **Ready:** name and Staff ID, the consent text, and `FaceEnrollment`.
  - **Done:** `Your face is set up. You can now check in with Staff ID <id>.`
    A failed scan shows the server's message and lets them retry.
- Modify: `src/App.jsx`. Add `const ENROL_PATH = /^\/enroll\/([^/]+)$/` and
  lazily load `EnrolFace` before `<Portal />`, following the `VERIFY_PATH`
  pattern. Import `registration.css` in `EnrolFace.jsx`.

**Interfaces:**
- Consumes: Task 6's `getEnrolment` and `submitEnrolment`, and Task 1's
  `LINK_UNUSABLE`.

- [ ] **Step 1: Implement the page and route.**

- [ ] **Step 2: Lint and build.**

- [ ] **Step 3: Check it with the link from Task 7.**
  1. Open the link, scan a face, and expect the done state.
  2. Reopen the link and expect the generic message.
  3. Check in at `/attendance` with that Staff ID and expect it to work.

- [ ] **Step 4: Commit**

```bash
git add src/pages/EnrolFace.jsx src/App.jsx
git commit -m "Add the face setup page for HR-created employees"
```

---

### Task 9: HR users in Settings and the HR setup page

**Files:**
- Create: `src/components/settings/HrUsersSection.jsx`, with props
  `{ user }`.
  - **List:** Active, Invited and Removed people.
  - **Invite form:** name, email and phone; errors shown from `{ errors }`.
  - **Actions for each person:**
    - **Remove access:** hidden on your own row.
    - **Restore access.**
    - **Cancel invite.**
    - **Send new link.**
  - **After creating a link:** `LinkResult` from Task 7.
- Modify: `src/pages/Settings.jsx`. Add
  `{ id: 'hr-users', label: 'HR users', hint: 'Who can use the HR portal' }`
  after `security`, and render the section.
- Modify: `src/components/settings/SettingsSections.jsx:578`. Replace the
  `Public HR registration` row's detail with
  `Locked. HR users are added by invitation in Settings → HR users.`
- Create: `src/pages/HrSetup.jsx`, with props `{ token }`.
  - **Loading** and **bad link** states, as in Task 8.
  - **When `hasAccount` is false:** two password fields, checked with
    `validateNewPassword`. On success it calls
    `supabase.auth.signInWithPassword({ email, password })`, then
    `window.location.assign('/hr')`, where `HrGate` takes over with the
    authenticator setup.
  - **When `hasAccount` is true:** the message
    `You already have a sign-in. Use your existing password at the HR portal.`
    with a button to `/hr`. It calls `completeHrSetup` with no password first.
- Modify: `src/App.jsx`, adding `const HR_SETUP_PATH = /^\/hr\/setup\/([^/]+)$/`
  checked before `<Portal />`.

**Interfaces:**
- Consumes: Task 6's HR functions and `hrSetupUrl`, Task 7's `LinkResult`,
  Task 1's `validateNewPassword`, and `supabase` from
  `src/services/backend/client.js`.

- [ ] **Step 1: Implement the section, page and route.**

- [ ] **Step 2: Lint and build.**

- [ ] **Step 3: Check it in the dev server.**
  1. Invite a test address you control and open the link in a private window.
  2. Set a password and expect to be taken to the authenticator setup.
  3. Remove that user from your own account, then reload their window. Expect
     them to be signed out with no access.
  4. Try removing yourself. Expect the button to be hidden, and the server to
     refuse if it's called directly.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings src/pages/Settings.jsx src/pages/HrSetup.jsx src/App.jsx
git commit -m "Let HR invite people to the HR portal from Settings"
```

---

### Task 10: Finish

**Files:**
- Modify: `README.md`. In "Swapping in real services", or a new short
  "Adding people" section, note that HR adds employees and HR users in the
  portal, and that `APP_URL` is needed for the SMS links.
- Commit the pending `src/pages/Home.jsx` stylesheet fix in this task.

- [ ] **Step 1: Run every check**

Run: `npx vitest run && npx oxlint && npx vite build && cd supabase/functions && npx -y deno check --node-modules-dir=none api/index.ts`
Expected: all tests pass, no lint errors, `built in`, and `Check api/index.ts`.

- [ ] **Step 2: Remove the live test data**
  - Delete the test employee from Task 7 (its `setup_links`, `face_templates`,
    `attendance_events`, `shop_assignments` and `employees` rows, plus its
    photos).
  - Delete the test HR user from Task 9 (its `hr_users` row, `hr_invites` row,
    links and auth user).
  - Use one `--yes` SQL query listing the exact Staff ID and email.
  - Expected: a follow-up read-only query finds none of them.

- [ ] **Step 3: Commit, push and open the PR** against `main`, noting that it
  builds on PR #3.

```bash
git add README.md src/pages/Home.jsx
git commit -m "Document onboarding and fix the home page styles"
git push -u origin hr-onboarding
```
