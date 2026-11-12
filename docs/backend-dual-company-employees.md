# Employees Who Work for Both Companies — Backend Specification

**Project:** Workforce Pro — Attendance & HR (Box For Less, Double A)
**Version:** 1.0 · 11 November 2026
**For:** the backend developer
**Status:** the registration form already collects this; the backend still
ignores it.

---

## 1. The rule (decided by the company)

Some employees work for **both** Box For Less and Double A.

| Question | Decision |
|---|---|
| Identity | **One registration, one face, one Staff ID.** The Staff ID comes from the **main company** (`BFL-…` or `DAA-…`). |
| Other company | The employee is **also linked** to the second company. |
| Where they can clock in | At workplaces of the main company **and** of any linked company. |
| Attendance and pay | **All attendance counts under the main company**, whichever workplace they clock in at. Overtime, reports and pay belong to the main company. |
| The linked company's HR | Sees that the person is linked (name, Staff ID, position, main company) — **not** their attendance, pay or personal details. |

---

## 2. What the frontend sends today

`POST /employees/register` now includes one extra field (from
`src/services/registrationService.js` → `submitRegistration`):

```json
{
  "companyId": "box-for-less",
  "additionalCompanyIds": ["double-a"],
  "...": "all existing fields unchanged"
}
```

`parseRegistration()` currently ignores unknown fields, so registration keeps
working; the choice is simply dropped until the steps below are done.

The registration form: the employee picks the **main company**, then ticks
"I also work for Double A". The review step shows "Main company" and
"Also works for".

---

## 3. Backend changes

### 3.1 Database

Add a link table (keeps `employees.company_id` as the main company, so every
existing query, report and RLS policy keeps working):

```sql
create table public.employee_companies (
  staff_id   text not null references public.employees (staff_id) on delete cascade,
  company_id text not null references public.companies (id),
  linked_at  timestamptz not null default now(),
  linked_by  text,
  primary key (staff_id, company_id)
);
```

- Never insert the employee's main company here.
- Expose it to HR through RLS: an HR user may read a row if they can access
  **either** the employee's main company or the linked company.

### 3.2 Registration

- `parseRegistration`: accept `additionalCompanyIds` — an array of known
  company ids, de-duplicated, **excluding `companyId`**. Unknown ids →
  `errors.additionalCompanyIds`.
- `register_employee`: insert the links in the same transaction.
- Response: add `additionalCompanyNames: ["Double A"]`. The success screen
  already shows "Also works for" when this is present.

### 3.3 Check-in kiosk

`supabase/functions/_shared/rules/checkin.js` currently blocks a workplace QR
code from another company (`OTHER_COMPANY_CODE`). Change the check to allow
the main company **or any linked company**:

```js
const allowed = [employee.company_id, ...linkedCompanyIds]
if (site && !allowed.includes(site.companyId)) blockedReason = OTHER_COMPANY_CODE
```

- The attendance event's `company_id` stays the **main company** (attendance
  counts there). Store the workplace in `display_id` as today, so HR can see
  where they clocked in.
- Face templates, attempt limits and lockouts are per Staff ID — unchanged.

### 3.4 HR

- **Main company HR:** sees everything as today, plus a "Also works for
  Double A" badge. Can add or remove links (Employees → employee details),
  each change written to the audit log.
- **Linked company HR:** sees the employee in their directory marked
  "Linked from Box For Less" with name, Staff ID and position only. No
  attendance, overtime, pay method, phone, address, emergency contact or face
  photo.
- Field staff who are linked: shop assignments, visit lists, SMS checks and
  live tracking follow the **main company** (see
  `docs/backend-live-tracker-and-sms-verification.md`), but shops from a
  linked company may be added to their daily shop list.

### 3.5 Frontend fields to return

`listEmployees()` rows: add `additionalCompanyIds: string[]` and, for rows a
linked-company HR user sees, `linkedFrom: "box-for-less"`. The frontend will
show the badges once these fields arrive.

---

## 4. Acceptance checks

- Registering with `companyId: box-for-less, additionalCompanyIds: [double-a]`
  creates one employee `BFL-…` and one link row.
- `additionalCompanyIds` containing the main company, or an unknown company,
  is rejected with a field error.
- That employee can clock in with a Double A workplace QR code; the event is
  stored with `company_id = box-for-less`.
- An employee with no link is still refused at the other company's workplace.
- Double A HR sees the person as linked, but cannot read their attendance,
  overtime or personal details.
- Box For Less reports and overtime include all of the person's days; Double A
  reports include none of them.
- Adding or removing a link is in the audit log.

## 5. Open questions for the company

1. Can HR link an **existing** employee to the second company later, or only
   at registration? (Spec above assumes HR can.)
2. Should the linked company's HR be able to see that the person is
   clocked in today (yes/no only), e.g. for scheduling?
