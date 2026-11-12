/**
 * ============================================================================
 * PAYROLL — category salary structures, individual overrides, payroll runs.
 * ============================================================================
 * FRONTEND-ONLY STORAGE: everything here is saved in this browser
 * (localStorage) until the backend payroll endpoints exist — see
 * docs/backend-payroll.md. Calculations are in services/payroll/payrollRules.js
 * (pure, tested). Inputs come from the real backend data already loaded by the
 * app: employees, attendance records and the Overtime calculation.
 *
 * Company separation: structures, runs, approvals and inputs are keyed by
 * company. Nothing is ever read across companies.
 * ============================================================================
 */

import { readJson, writeJson } from '../utils/localStore'
import { accraTodayKey } from '../utils/accraTime'
import { elapsedPeriodDateKeys } from '../utils/attendanceRules'
import { CATEGORIES, categoryForPosition, categoryLabel } from '../constants/employeeCategories'
import { listAttendanceRecords, listAttendanceRoster } from './attendanceRecordsService'
import { overtimeReport } from './overtimeService'
import { companyDisplayName } from './settingsService'
import { can, canAccessCompany, scopeCompanyIds } from './permissionsService'
import { tablesToCsv, tablesToPdf, tablesToXlsx } from '../utils/exportFiles'
import {
  PAY_TYPES,
  PAYROLL_CATEGORIES,
  TAX_METHODS,
  addAdjustment,
  addOverrideVersion,
  addTemplateVersion,
  approveRun,
  calculatePay,
  emptyState,
  markRunPaid,
  pickOverrideVersion,
  pickTemplateVersion,
  resolveProfile,
  round2,
  runFor,
  runKey,
  setOvertimeApproval,
  setPeriodInputs,
  withAdjustments,
} from './payroll/payrollRules'

export { PAYROLL_CATEGORIES, PAY_TYPES, TAX_METHODS }

const STORAGE_KEY = 'workforce:payroll:v1'

let state = null
let version = 0
const listeners = new Set()

function current() {
  if (!state) state = { ...emptyState(), ...readJson(STORAGE_KEY, {}) }
  return state
}

function commit(result) {
  if (result.error || result.errors) return result
  state = result.state
  writeJson(STORAGE_KEY, state)
  version += 1
  listeners.forEach((fn) => fn())
  return { ok: true, ...result }
}

/** For useSyncExternalStore. */
export function subscribePayroll(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const payrollVersion = () => version

/* ------------------------------------------------------------ permissions */

export const canViewPayroll = (user) => can(user, 'payroll', 'view')
export const canEditPayroll = (user, companyId) => can(user, 'payroll', 'edit') && (!companyId || canAccessCompany(user, companyId))
export const canApprovePayroll = (user, companyId) => can(user, 'payroll', 'approve') && (!companyId || canAccessCompany(user, companyId))
export const canExportPayroll = (user) => can(user, 'payroll', 'export')

const denied = { error: 'You are not authorised to change payroll for this company.' }
const stamp = (user) => ({ by: user?.name ?? 'HR', at: new Date().toISOString() })

/* ---------------------------------------------------------------- helpers */

const pad = (n) => String(n).padStart(2, '0')
export const dateKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const periodRange = (period) => ({ startKey: dateKeyOf(period.start), endKey: dateKeyOf(period.end) })

const employedDuring = (e, startKey, endKey) => (!e.employmentStart || e.employmentStart <= endKey) && (!e.employmentEnd || e.employmentEnd >= startKey)

/** Everyone on the company's payroll for a period (roster from the attendance service). */
function payrollRoster(companyId, period) {
  const { startKey, endKey } = periodRange(period)
  return listAttendanceRoster(companyId)
    .filter((e) => e.companyId === companyId && employedDuring(e, startKey, endKey))
    .map((e) => ({ ...e, categoryId: categoryForPosition(e.position) }))
}

/** Active employees in a company + category, today. */
export function employeesInCategory(companyId, categoryId) {
  const today = accraTodayKey()
  return listAttendanceRoster(companyId)
    .filter((e) => e.companyId === companyId && categoryForPosition(e.position) === categoryId && (!e.employmentEnd || e.employmentEnd >= today))
}

/* ------------------------------------------------------ salary structures */

export function templateVersions(companyId, categoryId) {
  return (current().templates[companyId]?.[categoryId] ?? []).slice()
}

export function overrideVersions(staffId) {
  return (current().overrides[staffId] ?? []).slice()
}

/** The structure in force today for existing employees (the "all" version). */
export function currentTemplate(companyId, categoryId, dateKey = accraTodayKey()) {
  return pickTemplateVersion(templateVersions(companyId, categoryId), dateKey, null)
}

/** Summary card per category for a company. */
export function listCategoryStructures(companyId) {
  return PAYROLL_CATEGORIES.map((categoryId) => {
    const versions = templateVersions(companyId, categoryId)
    const people = employeesInCategory(companyId, categoryId)
    return {
      categoryId,
      label: categoryLabel(categoryId),
      description: CATEGORIES[categoryId]?.description ?? '',
      versions,
      current: currentTemplate(companyId, categoryId),
      latest: versions[0] ?? null,
      // Latest change saved for new registrations only (existing staff keep `current`).
      newHireVersion: versions[0]?.appliesTo === 'new' ? versions[0] : null,
      employees: people.length,
      withOverrides: people.filter((e) => hasActiveOverride(e.employeeId)).length,
    }
  })
}

export function hasActiveOverride(staffId, dateKey = accraTodayKey()) {
  const o = pickOverrideVersion(overrideVersions(staffId), dateKey)
  return Boolean(o && Object.keys(o.fields).length)
}

/** What saving a structure change would do — shown before HR confirms. */
export function previewStructureChange({ companyId, categoryId, appliesTo, effectiveFrom }) {
  const people = employeesInCategory(companyId, categoryId)
  const existing = people.filter((e) => !e.employmentStart || e.employmentStart < effectiveFrom)
  const first = templateVersions(companyId, categoryId).length === 0
  const affected = first || appliesTo === 'all' ? existing.length : 0
  const withOverrides = (first || appliesTo === 'all' ? existing : []).filter((e) => hasActiveOverride(e.employeeId, effectiveFrom)).length
  const frozen = Object.values(current().runs)
    .filter((r) => r.companyId === companyId && r.status !== 'draft' && `${r.periodKey}-25` >= effectiveFrom)
    .map((r) => r.periodKey)
  return { first, affected, withOverrides, frozenPeriods: frozen, total: people.length }
}

export function saveCategoryStructure({ user, companyId, categoryId, structure, appliesTo, effectiveFrom }) {
  if (!canEditPayroll(user, companyId)) return denied
  const preview = previewStructureChange({ companyId, categoryId, appliesTo, effectiveFrom })
  return commit(addTemplateVersion(current(), { companyId, categoryId, categoryName: categoryLabel(categoryId), structure, appliesTo, effectiveFrom, affected: preview.affected, ...stamp(user) }))
}

/** Resolved salary profile for an employee on a date (category default + override). */
export function profileFor(employee, dateKey = accraTodayKey()) {
  const categoryId = employee.categoryId ?? categoryForPosition(employee.position)
  const template = pickTemplateVersion(templateVersions(employee.companyId, categoryId), dateKey, employee.employmentStart ?? null)
  const override = pickOverrideVersion(overrideVersions(employee.employeeId ?? employee.staffId), dateKey)
  return { categoryId, ...resolveProfile({ template, override }) }
}

/** The category default alone (no override) — what an override is compared with. */
export function categoryDefaultFor(employee, dateKey = accraTodayKey()) {
  const categoryId = employee.categoryId ?? categoryForPosition(employee.position)
  const template = pickTemplateVersion(templateVersions(employee.companyId, categoryId), dateKey, employee.employmentStart ?? null)
  return resolveProfile({ template })
}

/** Recalculate a payroll line with a changed structure and/or period inputs (live preview). */
export function previewLine(line, { structure = line.structure, inputs = line.inputs ?? {} } = {}, period) {
  return calculatePay({
    structure,
    attendance: { daysWorked: line.calc.days, workedMinutes: line.calc.workedHours * 60 },
    overtime: { recordedMinutes: line.overtimeRecorded?.minutes ?? 0, approvedMinutes: line.overtimeApproval ? line.overtimeApproval.minutes : null, companyRatePay: line.overtimeApproval?.companyRatePay ?? 0 },
    inputs,
    dateKey: periodRange(period).endKey,
  })
}

/** Example month for the structure editor: a full month, optional overtime hours. */
export function previewStructure(structure, { overtimeHours = 0, companyRate = 0, dateKey = accraTodayKey() } = {}) {
  const minutes = Math.max(0, Number(overtimeHours) || 0) * 60
  return calculatePay({
    structure,
    attendance: { daysWorked: 22, workedMinutes: 22 * 8 * 60 },
    overtime: { recordedMinutes: minutes, approvedMinutes: minutes, companyRatePay: (minutes / 60) * companyRate },
    inputs: {},
    dateKey,
  })
}

export function saveOverride({ user, employee, fields, effectiveFrom, reason }) {
  if (!canEditPayroll(user, employee.companyId)) return denied
  return commit(addOverrideVersion(current(), { staffId: employee.employeeId ?? employee.staffId, companyId: employee.companyId, fields, effectiveFrom, reason, ...stamp(user) }))
}

/* ---------------------------------------------------------------- payroll */

function attendanceTotals(companyId, period) {
  const dates = elapsedPeriodDateKeys(period, accraTodayKey())
  const map = new Map()
  if (!dates.length) return map
  const seen = new Set()
  listAttendanceRecords({ companyId, dates }).forEach((r) => {
    if (r.companyId !== companyId || seen.has(r.key)) return
    seen.add(r.key)
    const t = map.get(r.employeeId) ?? { daysWorked: 0, workedMinutes: 0 }
    if (r.hasAttendance) t.daysWorked += 1
    if (r.workingMinutes) t.workedMinutes += r.workingMinutes
    map.set(r.employeeId, t)
  })
  return map
}

function structureLabel(categoryId, profile) {
  const custom = Object.values(profile.sources).includes('override')
  if (!profile.template && !custom) return 'No salary structure'
  return `${categoryLabel(categoryId)} · ${PAY_TYPES[profile.structure.payType].label}${custom ? ' · with override' : ''}`
}

/** Live (draft) lines for one company and period. */
function draftLines(user, companyId, period) {
  const s = current()
  const key = runKey(companyId, period.key)
  const { endKey } = periodRange(period)
  const attendance = attendanceTotals(companyId, period)
  const ot = overtimeReport({ user, companyId, period })
  const otBy = new Map(ot.employees.map((e) => [e.employeeId, e]))
  const approvals = s.overtime[key] ?? {}
  const inputs = s.inputs[key] ?? {}
  const companyName = companyDisplayName(companyId)

  return payrollRoster(companyId, period).map((e) => {
    const profile = profileFor(e, endKey)
    const rec = otBy.get(e.employeeId)
    const approval = approvals[e.employeeId] ?? null
    const calc = calculatePay({
      structure: profile.structure,
      attendance: attendance.get(e.employeeId) ?? { daysWorked: 0, workedMinutes: 0 },
      overtime: { recordedMinutes: rec?.minutes ?? 0, approvedMinutes: approval ? approval.minutes : null, companyRatePay: approval?.companyRatePay ?? 0 },
      inputs: inputs[e.employeeId] ?? {},
      dateKey: endKey,
    })
    return {
      staffId: e.employeeId,
      fullName: e.fullName,
      companyId,
      companyName: companyName || e.companyName,
      position: e.position,
      employmentStart: e.employmentStart ?? null,
      paymentMethod: e.paymentMethod,
      categoryId: profile.categoryId,
      categoryLabel: categoryLabel(profile.categoryId),
      structureLabel: structureLabel(profile.categoryId, profile),
      hasStructure: Boolean(profile.template) || Object.values(profile.sources).includes('override'),
      sources: profile.sources,
      templateVersion: profile.template ? { id: profile.template.id, effectiveFrom: profile.template.effectiveFrom, appliesTo: profile.template.appliesTo } : null,
      overrideVersion: profile.override && Object.keys(profile.override.fields).length ? { id: profile.override.id, effectiveFrom: profile.override.effectiveFrom, reason: profile.override.reason } : null,
      structure: profile.structure,
      overtimeRecorded: { minutes: rec?.minutes ?? 0, companyRatePay: rec?.pay ?? 0 },
      overtimeApproval: approval,
      overtimeChanged: Boolean(approval && rec && approval.minutes !== rec.minutes),
      inputs: inputs[e.employeeId] ?? null,
      calc,
    }
  })
}

/**
 * Payroll for a period across the user's companies (or one company).
 * Approved/paid runs return their frozen snapshot plus adjustments.
 */
export function buildPayroll({ user, companyId = '', period }) {
  const ids = scopeCompanyIds(user, companyId)
  const runs = {}
  const lines = []
  ids.forEach((cid) => {
    const run = runFor(current(), cid, period.key)
    runs[cid] = run
    if (run.status === 'draft') draftLines(user, cid, period).forEach((l) => lines.push({ ...l, status: 'draft', adjustments: [], adjustedTakeHome: l.calc.takeHome }))
    else run.lines.forEach((l) => lines.push({ ...withAdjustments(l, run.adjustments), status: run.status }))
  })
  lines.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.fullName.localeCompare(b.fullName))
  return { companyIds: ids, runs, lines, totals: totalsOf(lines) }
}

export function totalsOf(lines) {
  const sum = (f) => round2(lines.reduce((t, l) => t + f(l), 0))
  return {
    employees: lines.length,
    basic: sum((l) => l.calc.basicPay),
    allowances: sum((l) => l.calc.allowanceTotal),
    overtimeHours: sum((l) => l.calc.overtime.hours),
    overtime: sum((l) => l.calc.overtime.pay),
    gross: sum((l) => l.calc.gross),
    paye: sum((l) => l.calc.paye),
    ssnitEmployee: sum((l) => l.calc.ssnitEmployee),
    otherDeductions: sum((l) => l.calc.otherDeductionsTotal),
    deductions: sum((l) => l.calc.totalDeductions),
    takeHome: sum((l) => l.adjustedTakeHome ?? l.calc.takeHome),
    employerSsnit: sum((l) => l.calc.employerSsnit),
    pendingOvertime: lines.filter((l) => l.status === 'draft' && l.calc.overtime.pending).length,
    noStructure: lines.filter((l) => !l.hasStructure).length,
  }
}

/** Lines that would be frozen by approval — always recomputed fresh. */
export function draftLinesFor(user, companyId, period) {
  return draftLines(user, companyId, period)
}

export function savePeriodInputs({ user, companyId, period, staffId, inputs }) {
  if (!canEditPayroll(user, companyId)) return denied
  return commit(setPeriodInputs(current(), { companyId, periodKey: period.key, staffId, inputs, ...stamp(user) }))
}

/** Approve the overtime currently recorded for these employees (from the Overtime calculation). */
export function approveOvertime({ user, companyId, period, staffIds }) {
  if (!canApprovePayroll(user, companyId)) return denied
  const ot = overtimeReport({ user, companyId, period })
  const by = new Map(ot.employees.map((e) => [e.employeeId, e]))
  let next = current()
  let count = 0
  for (const id of staffIds) {
    const rec = by.get(id)
    if (!rec || !rec.minutes) continue
    const r = setOvertimeApproval(next, { companyId, periodKey: period.key, staffId: id, approval: { minutes: rec.minutes, companyRatePay: rec.pay }, ...stamp(user) })
    if (r.error) return r
    next = r.state
    count += 1
  }
  return { ...commit({ state: next }), count }
}

export function withdrawOvertime({ user, companyId, period, staffId }) {
  if (!canApprovePayroll(user, companyId)) return denied
  return commit(setOvertimeApproval(current(), { companyId, periodKey: period.key, staffId, approval: null, ...stamp(user) }))
}

export function approvePayroll({ user, companyId, period }) {
  if (!canApprovePayroll(user, companyId)) return denied
  const lines = draftLines(user, companyId, period)
  return commit(approveRun(current(), { companyId, periodKey: period.key, lines, ...stamp(user) }))
}

export function markPayrollPaid({ user, companyId, period }) {
  if (!canApprovePayroll(user, companyId)) return denied
  return commit(markRunPaid(current(), { companyId, periodKey: period.key, ...stamp(user) }))
}

export function addPayrollAdjustment({ user, companyId, period, staffId, type, amount, reason }) {
  if (!canApprovePayroll(user, companyId)) return denied
  return commit(addAdjustment(current(), { companyId, periodKey: period.key, staffId, type, amount, reason, ...stamp(user) }))
}

export function payrollLog(companyIds) {
  return current().log.filter((l) => companyIds.includes(l.companyId))
}

/* ---------------------------------------------------------------- exports */

export const EXPORT_KINDS = [
  { id: 'all', label: 'All employees’ payroll' },
  { id: 'category', label: 'One employee category' },
  { id: 'employee', label: 'One employee' },
  { id: 'company', label: 'Company payroll summary' },
  { id: 'statutory', label: 'PAYE and SSNIT summary' },
  { id: 'overtime', label: 'Overtime report' },
]

const money = (label) => ({ label: `${label} (GH₵)`, money: true })
const number = (label) => ({ label, number: true })

function payrollTable(title, subtitle, lines) {
  const t = totalsOf(lines)
  return {
    title,
    subtitle,
    sheet: 'Payroll',
    columns: [{ label: 'Staff ID' }, { label: 'Employee' }, { label: 'Company' }, { label: 'Category' }, { label: 'Salary structure' }, money('Basic'), money('Allowances'), number('OT hours'), money('Overtime'), money('Bonus/other'), money('Gross'), money('PAYE'), money('Employee SSNIT'), money('Other deductions'), money('Total deductions'), money('Take-home'), money('Employer SSNIT'), { label: 'Status' }],
    rows: lines.map((l) => [l.staffId, l.fullName, l.companyName, l.categoryLabel, l.structureLabel, l.calc.basicPay, l.calc.allowanceTotal, l.calc.overtime.hours, l.calc.overtime.pay, round2(l.calc.bonus + l.calc.commission + l.calc.otherEarnings), l.calc.gross, l.calc.paye, l.calc.ssnitEmployee, l.calc.otherDeductionsTotal, l.calc.totalDeductions, l.adjustedTakeHome ?? l.calc.takeHome, l.calc.employerSsnit, l.status === 'draft' ? 'Draft' : l.status === 'paid' ? 'Paid' : 'Approved']),
    totals: ['', `Total (${t.employees})`, '', '', '', t.basic, t.allowances, t.overtimeHours, t.overtime, round2(lines.reduce((s, l) => s + l.calc.bonus + l.calc.commission + l.calc.otherEarnings, 0)), t.gross, t.paye, t.ssnitEmployee, t.otherDeductions, t.deductions, t.takeHome, t.employerSsnit, ''],
  }
}

export function employeeBreakdownRows(l) {
  const c = l.calc
  const rows = [
    ['Earnings', `Basic salary (${c.basicNote})`, c.basicPay],
    ...c.allowances.map((a) => ['Earnings', a.kind === 'percent' ? `${a.name} (${a.value}% of basic)` : a.name, a.amount]),
    ['Earnings', `Overtime (${c.overtime.hours} h${c.overtime.rate ? ` × GH₵${c.overtime.rate}/h` : ''})`, c.overtime.pay],
    ['Earnings', 'Bonus', c.bonus],
    ['Earnings', 'Commission', c.commission],
    ['Earnings', 'Other earnings', c.otherEarnings],
    ['Total', 'Gross earnings', c.gross],
    ['Deductions', `PAYE (${TAX_METHODS[c.taxMethod].short})`, c.paye],
    ['Deductions', `Employee SSNIT (${c.taxMethod === 'statutory' ? `${c.statutory.ssnitEmployeeRate}% of basic` : 'manual'})`, c.ssnitEmployee],
    ...c.deductions.map((d) => ['Deductions', d.kind === 'percent' ? `${d.name} (${d.value}% of basic)` : d.name, d.amount]),
    ['Deductions', 'Loan repayment', c.loan],
    ['Deductions', 'Salary advance', c.advance],
    ['Deductions', 'Other deductions', c.otherDeduction],
    ['Total', 'Total deductions', c.totalDeductions],
    ...(l.adjustments ?? []).map((a) => ['Adjustment', `${a.type === 'earning' ? 'Added' : 'Deducted'}: ${a.reason}`, a.type === 'earning' ? a.amount : -a.amount]),
    ['Total', 'Take-home pay', l.adjustedTakeHome ?? c.takeHome],
    ['Employer (not deducted)', `Employer SSNIT (${c.statutory.ssnitEmployerRate}% of basic)`, c.employerSsnit],
  ]
  return rows.filter((r) => r[0] === 'Total' || r[2] !== 0 || /Basic|PAYE|SSNIT/.test(r[1]))
}

/** Build the tables for an export. */
export function exportTables({ kind, payroll, period, categoryId, staffId }) {
  const sub = `${period.label} payroll period · amounts in Ghana cedis (GH₵) · exported ${new Date().toLocaleString('en-GH')}`
  const lines = payroll.lines
  if (kind === 'all') return [payrollTable('Payroll — all employees', sub, lines)]
  if (kind === 'category') return [payrollTable(`Payroll — ${categoryLabel(categoryId)}`, sub, lines.filter((l) => l.categoryId === categoryId))]
  if (kind === 'employee') {
    const l = lines.find((x) => x.staffId === staffId)
    if (!l) return []
    return [{
      title: `Payroll — ${l.fullName} (${l.staffId})`,
      subtitle: `${l.companyName} · ${l.categoryLabel} · ${sub}`,
      sheet: l.staffId,
      columns: [{ label: 'Section' }, { label: 'Item' }, money('Amount')],
      rows: employeeBreakdownRows(l),
    }]
  }
  if (kind === 'company') {
    const rows = payroll.companyIds.map((cid) => {
      const t = totalsOf(lines.filter((l) => l.companyId === cid))
      const run = payroll.runs[cid]
      return [companyDisplayName(cid) || cid, t.employees, t.basic, t.allowances, t.overtime, t.gross, t.paye, t.ssnitEmployee, t.otherDeductions, t.deductions, t.takeHome, t.employerSsnit, run.status === 'draft' ? 'Draft' : run.status === 'paid' ? 'Paid' : 'Approved']
    })
    const t = totalsOf(lines)
    return [{
      title: 'Company payroll summary',
      subtitle: sub,
      sheet: 'Company summary',
      columns: [{ label: 'Company' }, number('Employees'), money('Basic'), money('Allowances'), money('Overtime'), money('Gross'), money('PAYE'), money('Employee SSNIT'), money('Other deductions'), money('Total deductions'), money('Take-home'), money('Employer SSNIT'), { label: 'Status' }],
      rows,
      totals: rows.length > 1 ? ['All companies', t.employees, t.basic, t.allowances, t.overtime, t.gross, t.paye, t.ssnitEmployee, t.otherDeductions, t.deductions, t.takeHome, t.employerSsnit, ''] : undefined,
    }]
  }
  if (kind === 'statutory') {
    const t = totalsOf(lines)
    return [{
      title: 'PAYE and SSNIT summary',
      subtitle: `${sub} · employer SSNIT is a company cost, not deducted from employees`,
      sheet: 'PAYE and SSNIT',
      columns: [{ label: 'Staff ID' }, { label: 'Employee' }, { label: 'Company' }, { label: 'Method' }, money('Basic'), money('Gross'), money('Chargeable income'), money('PAYE'), money('Employee SSNIT'), money('Employer SSNIT'), money('Total SSNIT')],
      rows: lines.map((l) => [l.staffId, l.fullName, l.companyName, TAX_METHODS[l.calc.taxMethod].short, l.calc.basicPay, l.calc.gross, l.calc.chargeable ?? '', l.calc.paye, l.calc.ssnitEmployee, l.calc.employerSsnit, round2(l.calc.ssnitEmployee + l.calc.employerSsnit)]),
      totals: ['', `Total (${t.employees})`, '', '', t.basic, t.gross, '', t.paye, t.ssnitEmployee, t.employerSsnit, round2(t.ssnitEmployee + t.employerSsnit)],
    }]
  }
  if (kind === 'overtime') {
    const ot = lines.filter((l) => l.overtimeRecorded?.minutes || l.calc.overtime.minutes)
    return [{
      title: 'Overtime report',
      subtitle: `${sub} · only approved overtime is paid`,
      sheet: 'Overtime',
      columns: [{ label: 'Staff ID' }, { label: 'Employee' }, { label: 'Company' }, { label: 'Category' }, number('Recorded hours'), number('Approved hours'), { label: 'Rate' }, money('Overtime pay'), { label: 'Status' }],
      rows: ot.map((l) => [l.staffId, l.fullName, l.companyName, l.categoryLabel, round2((l.overtimeRecorded?.minutes ?? 0) / 60), l.calc.overtime.hours, l.calc.overtime.rateSource === 'company' ? 'Company rate' : `GH₵${l.calc.overtime.rate}/h`, l.calc.overtime.pay, !l.calc.overtime.eligible ? 'Not eligible' : l.calc.overtime.approved ? 'Approved' : 'Awaiting approval']),
      totals: ['', `Total (${ot.length})`, '', '', round2(ot.reduce((s, l) => s + (l.overtimeRecorded?.minutes ?? 0) / 60, 0)), round2(ot.reduce((s, l) => s + l.calc.overtime.hours, 0)), '', round2(ot.reduce((s, l) => s + l.calc.overtime.pay, 0)), ''],
    }]
  }
  return []
}

export function exportBlob(tables, format, heading) {
  if (format === 'csv') return new Blob([tablesToCsv(tables)], { type: 'text/csv;charset=utf-8' })
  if (format === 'xlsx') return tablesToXlsx(tables)
  return tablesToPdf(tables, { heading })
}
