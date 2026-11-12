# HR-created employees and HR portal access

Date: 2026-11-12
Status: approved in conversation; awaiting review of this written spec

## Goal

1. HR can create an employee from the HR portal, with or without the
   employee's face on file. When the face is missing, the employee finishes
   setup on their own phone through a one-time link.
2. HR can give another person access to the HR portal, manage that access,
   and remove it.

Today employees can only register themselves, and the portal is built for a
single HR Manager account. The Settings panel says no other accounts can be
created.

## Decisions made

| Question | Decision |
|---|---|
| How does an HR-created employee get a face on file? | Both: HR scans it on the spot, or sends a one-time link the employee opens on their phone |
| How does a new HR user get in? | A one-time setup link; they choose their own password, then set up the authenticator app |
| What access does a new HR user get? | The same full HR Manager access, to both companies, as today |

Out of scope for this phase: limited HR roles, email invites, bulk employee
import, and per-user company lists.

## Shared mechanism: one-time setup links

A new `setup_links` table holds every link, with a `kind`:

| Kind | For | Valid for | Ends when |
|---|---|---|---|
| `face` | one employee (`staff_id`) | 7 days | a face is saved, or a newer face link is sent |
| `hr-invite` | one pending invite (`invite_id`) | 24 hours | a password is chosen (or the existing account is attached), or the invite is cancelled or replaced |

- Only the SHA-256 hash of the token is stored, as with display setup links.
  The plain token is returned once to HR.
- Columns: `token_hash` (primary key), `kind`, `staff_id` (nullable),
  `invite_id` (nullable), `expires_at`, `used_at`, `cancelled_at`,
  `created_by`, `created_at`. A check constraint enforces that exactly the
  right subject column is set for each kind.
- Creating a new link of a kind for a subject cancels that subject's earlier
  open links.
- Service role only, with RLS forced and no policies, like `display_secrets`.

**Link addresses.** The server returns the token. The browser builds the
copyable address from its own origin (`/enroll/<token>` and
`/hr/setup/<token>`), as `setupUrl` already does for displays. The SMS uses
the `APP_URL` secret. If `APP_URL` is not set, the SMS is skipped with a
warning and the copy link still works.

## Part 1: HR creates employees

### Database

- `register_employee` gains handling for `p_template` being null: when it is
  null, it skips the `face_templates` insert and leaves `face_photo_path` and
  `biometric_consent_at` null. Self-registration still always sends a
  template, so its behaviour is unchanged.
- A new `enroll_face(p_token_hash, p_template, p_photo_path)` function, in
  one transaction:
  1. checks that the link is open;
  2. upserts the face template;
  3. sets `face_photo_path` and `biometric_consent_at`;
  4. marks the link used;
  5. writes an audit entry.

  It returns the employee's name and Staff ID.

### Server routes

- `POST /hr/employees`: same fields and checks as self-registration
  (`parseRegistration` from the shared rules). The face is optional. With a
  face, it enrols it exactly as self-registration does. Without one, it
  creates the employee with no face. Body flag `sendFaceLink: true` creates a
  face link in the same request. Returns the Staff ID, plus the link result
  when one was asked for.
- `POST /hr/employees/:staffId/face-link`: creates or replaces a face link.
  It sends an SMS when the employee has a usable phone number and SMS is
  configured. Returns `{ token, expiresAt, sms: 'sent' | 'skipped' | 'failed', smsReason }`.
- `GET /public/enroll/:token`: returns `{ fullName, staffId, companyName }`
  for an open link. Any other link gets one generic 404 message.
- `POST /public/enroll/:token`: takes a face sample (image and descriptor),
  enrols it, and calls `enroll_face`. Rate-limited by IP and by token.

The company check (`canViewCompany`) applies to every HR route, as it does
today.

### Screens

- **Employees page:** an **Add employee** button opens a three-step form:
  1. **Details:** reuses the `PersonalInformation` component.
  2. **Job:** reuses `JobPosition`, including adding a new shop.
  3. **Face:** **Scan now** reuses `FaceEnrollment`, and the employee ticks
     the consent box. **Send a setup link** saves without a face.

  The result screen shows the Staff ID and, when a link was made, its SMS
  status and a **Copy link** button.
- **Employee directory:** a **Face not set up** badge on employees with no
  face template. The details panel gets a **Send face setup link** button,
  which also serves employees whose saved face is outdated.
- **`/enroll/<token>` page:** shows the name and Staff ID, then the consent
  text and camera (reusing `FaceEnrollment`), then a confirmation. Bad links
  show "This link has expired or was already used. Ask HR for a new one."

## Part 2: HR portal access

### Database

- A new `hr_invites` table: `id`, `name`, `email` (stored lowercase), `phone`,
  `invited_by`, `created_at`, `status` (`pending` | `accepted` | `cancelled`),
  `accepted_user_id`.
- A unique partial index on `email` where `status = 'pending'`.
- Service role only, like `setup_links`.

### Server routes (HR)

- `GET /hr/users`: HR users and pending invites, with name, email, status and
  last sign-in.
- `POST /hr/invites`: takes name and email, plus an optional phone.
  - Refused if the email already belongs to an active HR user.
  - Replaces any pending invite for the same email.
  - Creates an `hr-invite` link and sends an SMS when there is a phone.
  - Returns the same link result shape as face links.
- `POST /hr/invites/:id/link`: sends a new link and cancels the old one.
- `POST /hr/invites/:id/cancel`: cancels the invite and its link.
- `POST /hr/users/:id/status` with `{ status: 'active' | 'inactive' }`.
  Refused for your own account, and refused if it would leave no active HR
  user. Removing access takes effect on the person's next request, because
  `requireHr` already checks `status` every time.

### Server routes (public)

- `GET /public/hr-setup/:token`: returns `{ name, email, invitedBy, hasAccount }`
  for an open link. Any other link gets one generic 404 message.
- `POST /public/hr-setup/:token` with `{ password }`:
  - **When no sign-in exists for the email:** creates it with the admin API
    (email confirmed, password at least 12 characters).
  - **When one exists:** it does not change the password.
  - **In both cases** it then:
    1. inserts or reactivates the `hr_users` row, as `hr-manager` with all
       companies;
    2. marks the invite accepted and the link used;
    3. writes an audit entry.

  The response says whether a password was set, or whether to sign in with
  the existing one. Rate-limited.

### Screens

- **Settings → HR users:** replaces the "one HR account" panel.
  - **The list:** Active, Invited and Removed people.
  - **Invite HR user:** a form for name, email and phone.
  - **Actions for each person:** remove access, restore access, cancel invite,
    and send new link.
  - **After creating a link:** the SMS status and a **Copy link** button.
- **`/hr/setup/<token>` page:** shows who invited them and their email. When
  there is no account, it asks for a password twice (at least 12 characters).
  Then it signs them in and hands over to the existing authenticator-app setup
  in `HrGate`. When there is an existing account, it says "Sign in with your
  existing password" and links to `/hr`.

## Errors and safety

- One message for every unusable link (expired, used, cancelled or unknown),
  so the endpoints don't reveal which links exist.
- Rate limits on all public link endpoints, matching the display and
  registration limits.
- **SMS:** when it is off, refused, or the number is unusable, HR still gets
  the copy link and a warning. TxtConnect is called through the existing
  `sendSms`.
- **Bad photo on the enrol page:** a failed face scan shows the usual retry
  messages, and the link stays open until a face is saved.
- **Existing account:** the HR setup link never changes the password of an
  existing sign-in.
- **Audit log:** every action is recorded: employee created by HR, face link
  sent, face enrolled by link, HR invited, invite cancelled, access removed,
  access restored, and invite accepted.

## Testing

- **Unit tests (vitest), for the new pure rules in `_shared/rules/`:**
  - link expiry and use, and choosing which link a new one cancels;
  - the "can this HR user change that one" checks (not yourself, not the last
    active user);
  - invite validation;
  - `parseRegistration` with and without a face.
- **Existing checks:** the 129 existing tests, lint with `no-undef`, and the
  production build.
- **Live check after deploying:**
  - add an employee without a face, open the link, scan, and check in;
  - invite a test HR user, complete setup, remove them, and confirm their
    next request is refused;
  - delete the test rows afterwards.
