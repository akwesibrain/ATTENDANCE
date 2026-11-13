# Payroll: what the backend needs to build

The frontend has a complete Payroll module:

- Salary Structures & Categories.
- Individual overrides.
- Overtime approval.
- Payroll runs.
- Payslips.
- Exports.

It is **frontend-only** for now. Everything HR saves is kept in the browser's `localStorage` (key `workforce:payroll:v1`). That means it is **per device** and not shared between HR users. This document lists what the backend needs to replace that storage.

The calculation rules are pure functions in `src/services/payroll/payrollRules.js` and `src/services/payroll/statutory.js`. They are tested in `tests/payroll.test.js`. Like the other shared rules, they can move to `supabase/functions/_shared/rules/` so the server and the browser calculate the same figures.

## Tables (suggested)

| Table | Key columns |
|---|---|
| `salary_structures` | `id, company_id, category_id, structure jsonb, applies_to ('all'\|'new'), effective_from date, saved_by, saved_at` (append-only) |
| `salary_overrides` | `id, staff_id, company_id, fields jsonb, effective_from date, reason, saved_by, saved_at` (append-only; `fields = {}` means the override was removed) |
| `payroll_period_inputs` | `company_id, period_key, staff_id, bonus, commission, other_earnings, loan, advance, other_deduction, note, saved_by, saved_at` |
| `overtime_approvals` | `company_id, period_key, staff_id, minutes, company_rate_pay, approved_by, approved_at` |
| `payroll_runs` | `company_id, period_key, status ('approved'\|'paid'), approved_by, approved_at, paid_by, paid_at, lines jsonb` (a frozen snapshot that never changes) |
| `payroll_adjustments` | `id, company_id, period_key, staff_id, type ('earning'\|'deduction'), amount, reason, by, at` |

`structure` has this shape:

```json
{
  "payType": "monthly|daily|hourly",
  "basic": 1500,
  "allowances": [{ "id": "", "name": "", "kind": "amount|percent", "value": 0, "standard": true }],
  "overtimeEligible": true,
  "overtimeRate": null,
  "tax": {
    "method": "statutory|manual",
    "paye": { "kind": "amount|percent", "value": 0 },
    "ssnit": { "kind": "amount|percent", "value": 0 }
  },
  "deductions": []
}
```

`overtimeRate` is `null` when the employee is paid at the company overtime rate.

## Rules the server must enforce

1. **Company separation.** Every row has a `company_id`. Reads and writes are limited to the HR user's `company_ids`. A structure from one company is never used for another company.
2. **Append-only history.** Structures and overrides are never edited in place. A new version gets a new `effective_from`.
3. **Which structure applies.** Take the latest version with `effective_from ≤ period end`. A version with `applies_to = 'new'` applies only to employees whose `joined_on ≥ effective_from`.
4. **Approved runs are immutable.** After approval, refuse changes to that run's inputs and overtime approvals. Changes must be made through `payroll_adjustments`, and each one needs a reason of at least 10 characters.
5. **Only approved overtime is paid.** Overtime minutes come from the existing Overtime calculation.
6. **Never mix tax methods.** Manual and statutory methods are never both applied to the same employee.
7. **Employer SSNIT is not a deduction.** It is a company cost.
8. **Audit everything.** Every save, approval, payment and adjustment writes an `audit_events` row. The frontend already records exports through `/hr/audit/exports`.

## Permissions

The frontend added a `payroll` module to `MODULES` in `src/services/permissionsService.js`, with the levels `view`, `edit`, `approve` and `export`. The server's role grants need the same module.

## Suggested endpoints

```
GET  /hr/payroll/structures?companyId=
PUT  /hr/payroll/structures/:companyId/:categoryId   { structure, appliesTo, effectiveFrom }
PUT  /hr/payroll/overrides/:staffId                  { fields, effectiveFrom, reason }
PUT  /hr/payroll/:companyId/:periodKey/inputs/:staffId
POST /hr/payroll/:companyId/:periodKey/overtime      { staffIds }   (DELETE to withdraw)
POST /hr/payroll/:companyId/:periodKey/approve
POST /hr/payroll/:companyId/:periodKey/paid
POST /hr/payroll/:companyId/:periodKey/adjustments   { staffId, type, amount, reason }
```

When these exist, `src/services/payrollService.js` swaps its `current()`/`commit()` storage for `rows()`/`submit()`. The screens don't need to change.

## Tier 2 and VAT on salary (company decision, 12 November 2026)

- **Tier 2 replaces the PAYE line.** HR sets a percentage for each salary category, stored as `structure.tax.tier2Rate` (0 to 100, required; an employee override can set its own). Amount = `round2(basic pay × tier2Rate / 100)`. The GRA PAYE bands are no longer used, and `chargeable` is always `null`. The amount is still stored in the `paye` field of a payroll line, so older runs stay readable.
- **Employee SSNIT is unchanged**: 5.5% of basic, or HR's manual figure (`tax.method = 'manual'`, with `tax.ssnit`).
- **VAT on salary** is always deducted. Amount = `round2((basic pay + allowances) × company vat_rate / 100)`. It is returned as `salaryVat: { rate, base, amount }`.
- **Total VAT deducted** = VAT on salary + VAT on overtime (when the overtime mode is `deduct`). It is returned as `vatDeducted` and included in `totalDeductions`; it is not part of `otherDeductionsTotal`.
- Example: basic GH₵1,500, Tier 2 at 5%, 10 hours of overtime at GH₵10/hour:
  - Tier 2: GH₵75
  - SSNIT: GH₵82.50
  - VAT on salary: GH₵82.50
  - VAT on overtime: GH₵5.50
  - Take-home: GH₵1,600 − GH₵245.50 = **GH₵1,354.50**

## VAT on overtime (added 12 November 2026)

The company decided that VAT applies to overtime. HR chooses how it applies, per company, in **Settings → Overtime Pay & VAT → VAT on overtime**:

| Mode | Effect (example: GH₵100 overtime, VAT 5.5%) |
|---|---|
| `none` | Not applied. The employee gets GH₵100. |
| `deduct` | **The default** (company decision, 12 November 2026). Deducted from the employee. The employee gets GH₵94.50, and GH₵5.50 appears as the deduction "VAT on overtime" on the payslip. Tier 2 does not change, because it is a percentage of basic. |
| `add` | Added on top as a company cost. The employee gets GH₵100; the company's cost is GH₵105.50. It appears like employer SSNIT: shown, not deducted. |

The amount is `round2(approved overtime pay × vat_rate / 100)`. Only approved overtime counts. The rule is `overtimeVat()` in `src/services/payroll/payrollRules.js`, which `calculatePay()` uses.

**Frontend-only for now.** The mode is stored in the browser's `localStorage` (key `workforce:vat-overtime:v1`, newest first: `{ mode, previous, savedBy, savedAt }`). The VAT *rate* is already on the server. The backend needs to:

1. Add `vat_overtime_mode text not null default 'deduct' check (vat_overtime_mode in ('none','deduct','add'))` to `settings_company`, together with who changed it and when.
2. Accept `{ rate?, overtimeMode? }` on `PUT /hr/settings/vat/:companyId`, validate it, write an audit row and return it in the settings facts. Also change the audit wording "VAT … is not deducted from overtime pay" in `hr.ts`, which is no longer true.
3. Store `overtimeVat` (mode, rate, amount) in each frozen payroll run line. A mode change affects draft payroll only. Approved runs never change.

When the server supports it, `src/services/vatOvertimeService.js` swaps `localStorage` for `settings_company`. The screens don't need to change.

**Please confirm with the accountant:** VAT in Ghana normally applies to sales, not wages. Check whether this deduction or cost should really be VAT, or a different levy, and whether a `deduct` amount should reduce the PAYE base. At present it doesn't.

## Statutory compliance: please confirm before live payroll

- **PAYE bands and SSNIT rates.** The bands in `statutory.js` are the GRA monthly resident bands from January 2024. The SSNIT rates are 5.5% from the employee and 13% from the employer, both on basic salary. Please check them with the company's accountant or GRA. Add new versions by effective date; never edit old ones.
- **Not modelled yet:**
  - The concessionary tax rates on overtime (junior staff) and on bonuses (the 5% portion up to 15% of annual basic).
  - Tax reliefs (marriage, disability, old age and similar).
  - The SSNIT maximum insurable earnings cap.
  - Non-resident rates.
  - Tier 3 contributions.
  - Whether particular allowances are taxable.

  At present, every earning is taxed through the monthly bands.
- **Daily and hourly pay.** These use the days attended and hours worked from attendance records. Paid leave and public holidays are not paid automatically yet.
