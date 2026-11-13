/**
 * ============================================================================
 * PAYROLL RULES — pure functions, no storage, no DOM (tested in
 * tests/payroll.test.js). payrollService.js wires them to saved data.
 * ============================================================================
 *
 *   Salary structure   one per company × employee category, effective-dated.
 *                      A version applies to "all" employees in the category,
 *                      or only to "new" ones (joined on/after its date).
 *   Individual override per employee, effective-dated, per field group.
 *                      Never changes the category template.
 *   Gross earnings     basic + allowances + bonus + commission
 *                      + APPROVED overtime + other earnings
 *   Deductions         Tier 2 (HR % of basic, per category) + employee SSNIT
 *                      + VAT on salary (company VAT % of basic + allowances)
 *                      + VAT on overtime (when the company deducts it)
 *                      + structure deductions + loans + advances + other
 *   Take-home          gross − deductions
 *   Employer SSNIT     shown separately; never deducted from the employee.
 *   Approved runs      frozen snapshots. Changes after approval are
 *                      controlled adjustments with a reason.
 * ============================================================================
 */

import { round2, statutoryRulesFor } from './statutory.js'

export { round2 }

/** Categories that get a salary structure, in display order. */
export const PAYROLL_CATEGORIES = ['warehouse', 'sales-rep', 'merchandiser', 'supervisor', 'office']

export const PAY_TYPES = {
  monthly: { label: 'Monthly', unit: 'per month', basicLabel: 'Basic monthly salary' },
  daily: { label: 'Daily', unit: 'per day worked', basicLabel: 'Daily rate' },
  hourly: { label: 'Hourly', unit: 'per hour worked', basicLabel: 'Hourly rate' },
}

export const STANDARD_ALLOWANCES = [
  ['transport', 'Transport allowance'],
  ['housing', 'Housing allowance'],
  ['meal', 'Meal allowance'],
  ['other', 'Other allowances'],
]

/** How employee SSNIT is worked out. Tier 2 is always HR's percentage of basic. */
export const TAX_METHODS = {
  statutory: { label: 'Automatic SSNIT', short: 'SSNIT auto' },
  manual: { label: 'HR manual SSNIT', short: 'SSNIT manual (HR)' },
}

/** Field groups an employee can override; each shows its own source label. */
export const OVERRIDE_GROUPS = [
  { key: 'pay', label: 'Basic salary', fields: ['payType', 'basic'] },
  { key: 'allowances', label: 'Allowances', fields: ['allowances'] },
  { key: 'overtime', label: 'Overtime', fields: ['overtimeEligible', 'overtimeRate'] },
  { key: 'tax', label: 'Tier 2 and SSNIT', fields: ['tax'] },
  { key: 'deductions', label: 'Other deductions', fields: ['deductions'] },
]

export const SOURCE_LABELS = {
  category: 'Category Default',
  override: 'Individual Override',
  none: 'Not set',
}

export const RUN_STATUS = {
  draft: { label: 'Draft', tone: 'draft' },
  approved: { label: 'Approved', tone: 'ok' },
  paid: { label: 'Paid', tone: 'paid' },
}

export function emptyStructure() {
  return {
    payType: 'monthly',
    basic: 0,
    allowances: STANDARD_ALLOWANCES.map(([id, name]) => ({ id, name, kind: 'amount', value: 0, standard: true })),
    overtimeEligible: true,
    overtimeRate: null, // null = the company rate in Settings → Working Hours (per day)
    // tier2Rate: % of basic salary set by HR for the category (null = not set yet).
    tax: { method: 'statutory', tier2Rate: null, paye: { kind: 'amount', value: 0 }, ssnit: { kind: 'amount', value: 0 } },
    deductions: [],
  }
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const cleanLine = (line) => ({
  id: String(line.id ?? ''),
  name: String(line.name ?? '').trim(),
  kind: line.kind === 'percent' ? 'percent' : 'amount',
  value: round2(num(line.value)),
  ...(line.standard ? { standard: true } : {}),
})

/** A structure with numbers as numbers and no stray fields. */
export function normaliseStructure(s = {}) {
  const base = emptyStructure()
  const tax = s.tax ?? base.tax
  return {
    payType: PAY_TYPES[s.payType] ? s.payType : 'monthly',
    basic: round2(num(s.basic)),
    allowances: (s.allowances ?? base.allowances).map(cleanLine),
    overtimeEligible: s.overtimeEligible !== false,
    overtimeRate: s.overtimeRate === null || s.overtimeRate === '' || s.overtimeRate === undefined ? null : round2(num(s.overtimeRate)),
    tax: {
      method: tax.method === 'manual' ? 'manual' : 'statutory',
      tier2Rate: tax.tier2Rate === null || tax.tier2Rate === '' || tax.tier2Rate === undefined ? null : round2(num(tax.tier2Rate)),
      paye: { kind: tax.paye?.kind === 'percent' ? 'percent' : 'amount', value: round2(num(tax.paye?.value)) },
      ssnit: { kind: tax.ssnit?.kind === 'percent' ? 'percent' : 'amount', value: round2(num(tax.ssnit?.value)) },
    },
    deductions: (s.deductions ?? []).map(cleanLine),
  }
}

/** Field errors for a structure (or a partial override). Empty object = valid. */
export function validateStructure(s, { partial = false } = {}) {
  const e = {}
  const has = (k) => !partial || k in s
  const bad = (v) => v === '' || v === null || v === undefined || !Number.isFinite(Number(v))
  if (has('basic') && (bad(s.basic) || Number(s.basic) < 0)) e.basic = 'Enter the basic salary in GH₵ (0 or more).'
  if (has('payType') && !PAY_TYPES[s.payType]) e.payType = 'Choose monthly, daily or hourly.'
  const checkLines = (lines, key) => (lines ?? []).forEach((l, i) => {
    if (!String(l.name ?? '').trim()) e[`${key}.${i}.name`] = 'Give this line a name.'
    if (bad(l.value) || Number(l.value) < 0) e[`${key}.${i}.value`] = 'Enter 0 or more.'
    else if (l.kind === 'percent' && Number(l.value) > 100) e[`${key}.${i}.value`] = 'A percentage cannot be over 100.'
  })
  if (has('allowances')) checkLines(s.allowances, 'allowances')
  if (has('deductions')) checkLines(s.deductions, 'deductions')
  if (has('overtimeRate') && s.overtimeRate !== null && s.overtimeRate !== '' && (bad(s.overtimeRate) || Number(s.overtimeRate) <= 0)) {
    e.overtimeRate = 'Enter an hourly rate above 0, or use the company rate.'
  }
  if (has('tax')) {
    const t = s.tax?.tier2Rate
    if (bad(t) || Number(t) < 0 || Number(t) > 100) e['tax.tier2Rate'] = 'Enter the Tier 2 percentage of basic salary (0 to 100).'
  }
  if (has('tax') && s.tax?.method === 'manual') {
    ;['ssnit'].forEach((k) => {
      const item = s.tax[k] ?? {}
      if (bad(item.value) || Number(item.value) < 0) e[`tax.${k}`] = 'Enter 0 or more.'
      else if (item.kind === 'percent' && Number(item.value) > 100) e[`tax.${k}`] = 'A percentage cannot be over 100.'
    })
  }
  return e
}

const newestFirst = (a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || String(b.savedAt).localeCompare(String(a.savedAt))

/**
 * The category structure version that applies to an employee on a date.
 * "new" versions apply only to employees who joined on or after their date.
 */
export function pickTemplateVersion(versions = [], dateKey, joinedOn) {
  return versions
    .filter((v) => v.effectiveFrom <= dateKey)
    .sort(newestFirst)
    .find((v) => v.appliesTo === 'all' || (joinedOn && joinedOn >= v.effectiveFrom)) ?? null
}

/** The employee's override version in force on a date (fields may be empty = cleared). */
export function pickOverrideVersion(versions = [], dateKey) {
  return versions.filter((v) => v.effectiveFrom <= dateKey).sort(newestFirst)[0] ?? null
}

/**
 * Merge the category default and the individual override, group by group.
 * @returns {{ structure, sources: Record<string,'category'|'override'|'none'>, template, override }}
 */
export function resolveProfile({ template = null, override = null }) {
  const base = template ? normaliseStructure(template.structure) : emptyStructure()
  const fields = override?.fields ?? {}
  const structure = { ...base }
  const sources = {}
  OVERRIDE_GROUPS.forEach((g) => {
    const overridden = g.fields.some((f) => f in fields)
    if (overridden) g.fields.forEach((f) => { if (f in fields) structure[f] = fields[f] })
    sources[g.key] = overridden ? 'override' : template ? 'category' : 'none'
  })
  return { structure: normaliseStructure(structure), sources, template, override }
}

/**
 * How the company VAT rate (Settings → Overtime Pay & VAT) applies to overtime.
 * Chosen per company by HR.
 */
export const VAT_OVERTIME_MODES = Object.freeze({
  none: { label: 'Not applied', hint: 'Overtime is paid in full. VAT does not change it.' },
  deduct: { label: 'Deducted from overtime pay', hint: 'The VAT amount is taken off the employee’s overtime pay and shown as a deduction on the payslip.' },
  add: { label: 'Added on top (company cost)', hint: 'The employee gets the full overtime pay. The company pays the VAT amount on top.' },
})

/**
 * VAT on an overtime amount.
 * @param {number} pay gross overtime pay
 * @param {{ mode?: 'none'|'deduct'|'add', rate?: number }} [vat]
 * @returns {{ mode: string, rate: number, amount: number, employeeGets: number, companyCost: number }}
 */
export function overtimeVat(pay, vat = {}) {
  const mode = VAT_OVERTIME_MODES[vat?.mode] ? vat.mode : 'none'
  const rate = Math.max(0, num(vat?.rate))
  const gross = round2(num(pay))
  const amount = mode === 'none' ? 0 : round2((gross * rate) / 100)
  return {
    mode,
    rate,
    amount,
    employeeGets: round2(mode === 'deduct' ? gross - amount : gross),
    companyCost: round2(mode === 'add' ? gross + amount : gross),
  }
}

const lineAmount = (line, base) => round2(line.kind === 'percent' ? (base * line.value) / 100 : line.value)

/**
 * Calculate one employee's pay for a period.
 * @param {object} p
 * @param {object} p.structure       resolved structure (normalised)
 * @param {{ daysWorked: number, workedMinutes: number }} p.attendance
 * @param {{ recordedMinutes: number, approvedMinutes: number|null, companyRatePay: number, vat?: { mode: string, rate: number } }} p.overtime
 *        approvedMinutes null = not approved yet (counts as 0); vat = how the company VAT rate applies to overtime
 * @param {object} p.inputs          period earnings/deductions entered by HR
 * @param {string} p.dateKey         rules date (period end)
 * @param {{ rate: number }} [p.salaryVat] company VAT % deducted from basic + allowances
 */
export function calculatePay({ structure, attendance = {}, overtime = {}, inputs = {}, dateKey, salaryVat = null }) {
  const s = normaliseStructure(structure)
  const rules = statutoryRulesFor(dateKey)
  const days = num(attendance.daysWorked)
  const hours = round2(num(attendance.workedMinutes) / 60)

  const basicPay = round2(s.payType === 'daily' ? s.basic * days : s.payType === 'hourly' ? s.basic * hours : s.basic)
  const basicNote = s.payType === 'daily' ? `${days} day(s) × rate` : s.payType === 'hourly' ? `${hours} hour(s) × rate` : 'Monthly'

  const allowances = s.allowances
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, value: a.value, amount: lineAmount(a, basicPay) }))
    .filter((a) => a.amount > 0)
  const allowanceTotal = round2(allowances.reduce((t, a) => t + a.amount, 0))

  // Overtime: only approved minutes count.
  const approved = overtime.approvedMinutes !== null && overtime.approvedMinutes !== undefined
  const otMinutes = s.overtimeEligible && approved ? num(overtime.approvedMinutes) : 0
  const otHours = round2(otMinutes / 60)
  const usesCompanyRate = s.overtimeRate === null
  const otPay = !s.overtimeEligible || !approved ? 0
    : usesCompanyRate ? round2(num(overtime.companyRatePay))
      : round2((otMinutes / 60) * s.overtimeRate)
  const overtimeOut = {
    eligible: s.overtimeEligible,
    recordedMinutes: num(overtime.recordedMinutes),
    approved,
    pending: s.overtimeEligible && !approved && num(overtime.recordedMinutes) > 0,
    minutes: otMinutes,
    hours: otHours,
    rate: usesCompanyRate ? (otMinutes ? round2(otPay / (otMinutes / 60)) : null) : s.overtimeRate,
    rateSource: usesCompanyRate ? 'company' : 'structure',
    pay: otPay,
    vat: overtimeVat(otPay, overtime.vat),
  }
  // "deduct": taken off take-home after tax (PAYE is still worked out on the full overtime pay).
  // "add": a company cost, like employer SSNIT; the employee is not affected.
  const overtimeVatDeduction = overtimeOut.vat.mode === 'deduct' ? overtimeOut.vat.amount : 0
  const employerOvertimeVat = overtimeOut.vat.mode === 'add' ? overtimeOut.vat.amount : 0

  const bonus = round2(num(inputs.bonus))
  const commission = round2(num(inputs.commission))
  const otherEarnings = round2(num(inputs.otherEarnings))
  const gross = round2(basicPay + allowanceTotal + bonus + commission + otPay + otherEarnings)

  // Tier 2: HR's percentage of basic salary for the category. (Field name `paye` kept for stored runs.)
  const tier2Rate = s.tax.tier2Rate
  const paye = tier2Rate === null ? 0 : round2((basicPay * tier2Rate) / 100)
  const chargeable = null
  // Employee SSNIT: statutory or HR manual — never both.
  const ssnitEmployee = s.tax.method === 'manual'
    ? lineAmount(s.tax.ssnit, basicPay)
    : round2((basicPay * rules.ssnitEmployeeRate) / 100)

  // VAT on salary: company VAT % of basic + allowances, deducted from the employee.
  const salaryVatRate = Math.max(0, num(salaryVat?.rate))
  const salaryVatBase = round2(basicPay + allowanceTotal)
  const salaryVatAmount = round2((salaryVatBase * salaryVatRate) / 100)
  const vatDeducted = round2(salaryVatAmount + overtimeVatDeduction)
  const employerSsnit = round2((basicPay * rules.ssnitEmployerRate) / 100)

  const deductions = s.deductions
    .map((d) => ({ id: d.id, name: d.name, kind: d.kind, value: d.value, amount: lineAmount(d, basicPay) }))
    .filter((d) => d.amount > 0)
  const structureDeductions = round2(deductions.reduce((t, d) => t + d.amount, 0))
  const loan = round2(num(inputs.loan))
  const advance = round2(num(inputs.advance))
  const otherDeduction = round2(num(inputs.otherDeduction))
  const otherDeductionsTotal = round2(structureDeductions + loan + advance + otherDeduction)
  const totalDeductions = round2(paye + ssnitEmployee + vatDeducted + otherDeductionsTotal)
  const takeHome = round2(gross - totalDeductions)

  return {
    payType: s.payType,
    rate: s.basic,
    basicPay,
    basicNote,
    days,
    workedHours: hours,
    allowances,
    allowanceTotal,
    overtime: overtimeOut,
    bonus,
    commission,
    otherEarnings,
    gross,
    taxMethod: s.tax.method,
    statutory: { id: rules.id, label: rules.label, ssnitEmployeeRate: rules.ssnitEmployeeRate, ssnitEmployerRate: rules.ssnitEmployerRate },
    chargeable,
    paye,
    tier2Rate,
    salaryVat: { rate: salaryVatRate, base: salaryVatBase, amount: salaryVatAmount },
    vatDeducted,
    ssnitEmployee,
    deductions,
    loan,
    advance,
    otherDeduction,
    overtimeVatDeduction,
    otherDeductionsTotal,
    totalDeductions,
    takeHome,
    employerSsnit,
    employerOvertimeVat,
    warnings: [
      ...(tier2Rate === null ? ['Tier 2 percentage is not set for this salary structure.'] : []),
      ...(takeHome < 0 ? ['Deductions are higher than earnings.'] : []),
    ],
  }
}

/** Approved-run adjustments applied on top of a frozen line (the snapshot itself never changes). */
export function withAdjustments(line, adjustments = []) {
  const mine = adjustments.filter((a) => a.staffId === line.staffId)
  if (!mine.length) return { ...line, adjustments: [], adjustedTakeHome: line.calc.takeHome }
  const plus = mine.filter((a) => a.type === 'earning').reduce((t, a) => t + a.amount, 0)
  const minus = mine.filter((a) => a.type === 'deduction').reduce((t, a) => t + a.amount, 0)
  return { ...line, adjustments: mine, adjustedTakeHome: round2(line.calc.takeHome + plus - minus) }
}

/* ---------------------------------------------------------------------------
 * State changes. State = { templates, overrides, runs, overtime, inputs, log }.
 * Each returns a NEW state object (or { error }).
 * ------------------------------------------------------------------------ */

export function emptyState() {
  return { templates: {}, overrides: {}, runs: {}, overtime: {}, inputs: {}, log: [] }
}

export const runKey = (companyId, periodKey) => `${companyId}:${periodKey}`

export function runFor(state, companyId, periodKey) {
  return state.runs[runKey(companyId, periodKey)] ?? { status: 'draft', companyId, periodKey }
}

const logged = (state, entry) => [{ id: `${entry.at}-${state.log.length}`, ...entry }, ...state.log].slice(0, 500)

export function addTemplateVersion(state, { companyId, categoryId, categoryName = categoryId, structure, appliesTo, effectiveFrom, by, at, affected = 0 }) {
  const errors = validateStructure(structure)
  if (Object.keys(errors).length) return { errors }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) return { errors: { effectiveFrom: 'Choose the effective date.' } }
  const company = state.templates[companyId] ?? {}
  const versions = company[categoryId] ?? []
  const version = { id: `${companyId}-${categoryId}-${at}`, companyId, categoryId, structure: normaliseStructure(structure), appliesTo: versions.length ? appliesTo : 'all', effectiveFrom, savedAt: at, savedBy: by }
  return {
    state: {
      ...state,
      templates: { ...state.templates, [companyId]: { ...company, [categoryId]: [version, ...versions] } },
      log: logged(state, { at, by, companyId, action: 'Salary structure saved', detail: `${categoryName} · ${version.appliesTo === 'all' ? `all employees from ${effectiveFrom} (${affected} affected)` : `new registrations from ${effectiveFrom}`}` }),
    },
    version,
  }
}

export function addOverrideVersion(state, { staffId, companyId, fields, effectiveFrom, reason, by, at }) {
  const errors = validateStructure(fields, { partial: true })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) errors.effectiveFrom = 'Choose the effective date.'
  if (String(reason ?? '').trim().length < 5) errors.reason = 'Give a reason (at least 5 characters).'
  if (Object.keys(errors).length) return { errors }
  const versions = state.overrides[staffId] ?? []
  const version = { id: `${staffId}-${at}`, staffId, companyId, fields: structuredClone(fields), effectiveFrom, reason: reason.trim(), savedAt: at, savedBy: by }
  return {
    state: {
      ...state,
      overrides: { ...state.overrides, [staffId]: [version, ...versions] },
      log: logged(state, { at, by, companyId, action: Object.keys(fields).length ? 'Individual salary override saved' : 'Individual override removed', detail: `${staffId} from ${effectiveFrom}: ${reason.trim()}` }),
    },
    version,
  }
}

const draftOnly = (state, companyId, periodKey) => runFor(state, companyId, periodKey).status === 'draft'
  ? null : { error: 'This payroll is approved. Use a controlled adjustment instead.' }

export function setPeriodInputs(state, { companyId, periodKey, staffId, inputs, by, at }) {
  const blocked = draftOnly(state, companyId, periodKey)
  if (blocked) return blocked
  const key = runKey(companyId, periodKey)
  const clean = Object.fromEntries(['bonus', 'commission', 'otherEarnings', 'loan', 'advance', 'otherDeduction'].map((k) => [k, round2(Math.max(0, num(inputs[k])))]))
  return {
    state: {
      ...state,
      inputs: { ...state.inputs, [key]: { ...(state.inputs[key] ?? {}), [staffId]: { ...clean, note: String(inputs.note ?? '').trim(), savedAt: at, savedBy: by } } },
      log: logged(state, { at, by, companyId, action: 'Period earnings/deductions saved', detail: `${staffId} · ${periodKey}` }),
    },
  }
}

/** Approve (or withdraw with approval = null) an employee's overtime for the period. */
export function setOvertimeApproval(state, { companyId, periodKey, staffId, approval, by, at }) {
  const blocked = draftOnly(state, companyId, periodKey)
  if (blocked) return blocked
  const key = runKey(companyId, periodKey)
  const current = { ...(state.overtime[key] ?? {}) }
  if (approval) current[staffId] = { minutes: num(approval.minutes), companyRatePay: round2(num(approval.companyRatePay)), approvedAt: at, approvedBy: by }
  else delete current[staffId]
  return {
    state: {
      ...state,
      overtime: { ...state.overtime, [key]: current },
      log: logged(state, { at, by, companyId, action: approval ? 'Overtime approved' : 'Overtime approval withdrawn', detail: `${staffId} · ${periodKey}${approval ? ` · ${num(approval.minutes)} min` : ''}` }),
    },
  }
}

/** Freeze the computed lines. After this, figures change only through adjustments. */
export function approveRun(state, { companyId, periodKey, lines, by, at }) {
  if (runFor(state, companyId, periodKey).status !== 'draft') return { error: 'This payroll has already been approved.' }
  if (!lines.length) return { error: 'There is nobody on this payroll.' }
  const key = runKey(companyId, periodKey)
  return {
    state: {
      ...state,
      runs: { ...state.runs, [key]: { companyId, periodKey, status: 'approved', approvedAt: at, approvedBy: by, lines: structuredClone(lines), adjustments: [] } },
      log: logged(state, { at, by, companyId, action: 'Payroll approved', detail: `${periodKey} · ${lines.length} employees` }),
    },
  }
}

export function markRunPaid(state, { companyId, periodKey, by, at }) {
  const run = runFor(state, companyId, periodKey)
  if (run.status !== 'approved') return { error: 'Only an approved payroll can be marked as paid.' }
  const key = runKey(companyId, periodKey)
  return {
    state: {
      ...state,
      runs: { ...state.runs, [key]: { ...run, status: 'paid', paidAt: at, paidBy: by } },
      log: logged(state, { at, by, companyId, action: 'Payroll marked as paid', detail: periodKey }),
    },
  }
}

export function addAdjustment(state, { companyId, periodKey, staffId, type, amount, reason, by, at }) {
  const run = runFor(state, companyId, periodKey)
  if (run.status === 'draft') return { error: 'Draft payroll recalculates automatically; adjustments are for approved payroll.' }
  const errors = {}
  if (!['earning', 'deduction'].includes(type)) errors.type = 'Choose earning or deduction.'
  if (!(num(amount) > 0)) errors.amount = 'Enter an amount above 0.'
  if (String(reason ?? '').trim().length < 10) errors.reason = 'Explain the adjustment (at least 10 characters).'
  if (!run.lines.some((l) => l.staffId === staffId)) errors.staffId = 'This employee is not on the approved payroll.'
  if (Object.keys(errors).length) return { errors }
  const key = runKey(companyId, periodKey)
  const adjustment = { id: `${staffId}-${at}`, staffId, type, amount: round2(num(amount)), reason: reason.trim(), at, by }
  return {
    state: {
      ...state,
      runs: { ...state.runs, [key]: { ...run, adjustments: [...(run.adjustments ?? []), adjustment] } },
      log: logged(state, { at, by, companyId, action: 'Payroll adjustment added', detail: `${staffId} · ${periodKey} · ${type} GH₵${adjustment.amount} · ${adjustment.reason}` }),
    },
  }
}
