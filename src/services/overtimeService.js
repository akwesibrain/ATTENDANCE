/**
 * ============================================================================
 * OVERTIME
 * ============================================================================
 * Overtime is calculated from the shared attendance records, one record per
 * employee per day, so nothing is counted twice. Corrections are already
 * applied to those records.
 *
 *   Saturday, Sunday and holidays (public or set by HR): the whole time
 *     worked is overtime (clock-in to clock-out), for every employee.
 *   Monday to Friday: overtime minutes = recorded clock-out − overtime start
 *     (only time AFTER the overtime start counts; never negative)
 *   Overtime start = the company's configured overtime start time
 *     (Settings → Working Hours). Everyone works the standard hours;
 *     there are no shifts.
 *   Overtime pay = (total overtime minutes ÷ 60) × hourly overtime rate (GH₵)
 *     using the rate in force on each day; rounded to the pesewa at the end.
 *   Period = the company attendance cycle, 26th to 25th (Africa/Accra).
 *
 * Excluded (shown with the reason): approved leave, incomplete records
 * (no clock-out), unknown or unreadable times, and invalid times. VAT on
 * overtime follows each company's choice in Settings → Overtime Pay & VAT
 * (not applied / deducted from the employee / added on top as a company cost).
 * ============================================================================
 */

import { listAttendanceRecords } from './attendanceRecordsService'
import { defaultHoursFor, overtimeRateFor, vatRateFor, companyDisplayName } from './settingsService'
import { scopeCompanyIds } from './permissionsService'
import { overtimeVat, vatOnOvertimeFor, VAT_OVERTIME_MODES } from './vatOvertimeService'
import { elapsedPeriodDateKeys, holidayForKey } from '../utils/attendanceRules'
import { accraTodayKey } from '../utils/accraTime'
import {
  OVERTIME_KINDS,
  calculateRecordOvertime,
  isWeekendKey,
  overtimeKindFor as overtimeKindForDate,
  overtimePay,
  overtimeThreshold as overtimeThresholdFor,
} from '../../supabase/functions/_shared/rules/overtime.js'

export { OVERTIME_KINDS, isWeekendKey, overtimePay }

/** Money in Ghana cedis, e.g. GH₵1,234.50. */
export function formatCedis(amount) {
  const n = Number(amount) || 0
  return `GH₵${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "2h 05m" for minutes. */
export function formatOvertime(minutes) {
  const m = Math.max(0, Math.round(minutes || 0))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Which overtime rule applies to a date. */
export function overtimeKindFor(dateKey) {
  return overtimeKindForDate(dateKey, holidayForKey(dateKey))
}

/** The minute overtime starts for a record (ISO), from company settings. */
export function overtimeThreshold(record) {
  return overtimeThresholdFor(record, defaultHoursFor(record.companyId, record.date))
}

/**
 * Overtime for one attendance record.
 * @returns {{ status: 'counted'|'none'|'excluded'|'skip', reason?, kind, minutes, rate, pay, threshold }}
 */
export function overtimeForRecord(record) {
  return calculateRecordOvertime(record, {
    rate: overtimeRateFor(record.companyId, record.date),
    holidayName: holidayForKey(record.date),
    hours: defaultHoursFor(record.companyId, record.date),
  })
}

/**
 * Overtime for an attendance period, limited to the user's companies.
 * @param {{ user, companyId?: string, period, filter?: (record) => boolean }} opts
 */
export function overtimeReport({ user, companyId = '', period, filter }) {
  const ids = scopeCompanyIds(user, companyId)
  const today = accraTodayKey()
  const dates = elapsedPeriodDateKeys(period, today)
  const records = ids.length
    ? listAttendanceRecords({ companyId: ids.length === 1 ? ids[0] : null, dates }).filter((r) => ids.includes(r.companyId) && (!filter || filter(r)))
    : []

  const seen = new Set()
  const days = []
  const excluded = []
  records.forEach((r) => {
    if (seen.has(r.key)) return // one record per employee per day
    seen.add(r.key)
    const ot = overtimeForRecord(r)
    if (ot.status === 'counted') days.push({ record: r, ...ot })
    else if (ot.status === 'excluded' && (r.workday !== false || r.hasAttendance)) excluded.push({ record: r, reason: ot.reason })
  })

  const byEmp = new Map()
  days.forEach((d) => {
    const r = d.record
    const row = byEmp.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      fullName: r.fullName,
      companyId: r.companyId,
      companyName: companyDisplayName(r.companyId, r.companyName),
      position: r.position,
      days: 0,
      minutes: 0,
      rateMinutes: 0, // Σ minutes × rate, for exact pay
      rates: new Set(),
      entries: [],
    }
    row.days += 1
    row.minutes += d.minutes
    row.rateMinutes += d.minutes * d.rate
    row.rates.add(d.rate)
    row.entries.push(d)
    byEmp.set(r.employeeId, row)
  })
  const vatBy = new Map(ids.map((id) => [id, vatOnOvertimeFor(id)]))
  const vatFor = (id) => vatBy.get(id) ?? vatOnOvertimeFor(id)
  const employees = [...byEmp.values()].map((row) => {
    const pay = Math.round((row.rateMinutes / 60) * 100) / 100
    return {
      ...row,
      rates: [...row.rates],
      hours: Math.round((row.minutes / 60) * 100) / 100,
      pay,
      vat: overtimeVat(pay, vatFor(row.companyId)),
      entries: row.entries.sort((a, b) => a.record.date.localeCompare(b.record.date)),
    }
  }).sort((a, b) => b.minutes - a.minutes || a.fullName.localeCompare(b.fullName))

  const byDate = new Map()
  days.forEach((d) => {
    const k = d.record.date
    const row = byDate.get(k) ?? { date: k, minutes: 0, rateMinutes: 0, employees: 0 }
    row.minutes += d.minutes
    row.rateMinutes += d.minutes * d.rate
    row.employees += 1
    byDate.set(k, row)
  })
  const daily = dates.map((date) => {
    const row = byDate.get(date) ?? { date, minutes: 0, rateMinutes: 0, employees: 0 }
    return { ...row, pay: Math.round((row.rateMinutes / 60) * 100) / 100 }
  })

  const companies = ids.map((id) => {
    const list = employees.filter((e) => e.companyId === id)
    const minutes = list.reduce((s, e) => s + e.minutes, 0)
    const rateMinutes = list.reduce((s, e) => s + e.rateMinutes, 0)
    return {
      companyId: id,
      name: companyDisplayName(id),
      currentRate: overtimeRateFor(id, today),
      vatRate: vatRateFor(id),
      vatMode: vatFor(id).mode,
      employees: list.length,
      minutes,
      hours: Math.round((minutes / 60) * 100) / 100,
      pay: Math.round((rateMinutes / 60) * 100) / 100,
      vatAmount: round2(list.reduce((s, e) => s + e.vat.amount, 0)),
      employeeGets: round2(list.reduce((s, e) => s + e.vat.employeeGets, 0)),
      companyCost: round2(list.reduce((s, e) => s + e.vat.companyCost, 0)),
    }
  })

  const totalMinutes = employees.reduce((s, e) => s + e.minutes, 0)
  const totalRateMinutes = employees.reduce((s, e) => s + e.rateMinutes, 0)
  return {
    companyIds: ids,
    dates,
    employees,
    daily,
    excluded: excluded.sort((a, b) => b.record.date.localeCompare(a.record.date)),
    companies,
    totals: {
      minutes: totalMinutes,
      hours: Math.round((totalMinutes / 60) * 100) / 100,
      pay: Math.round((totalRateMinutes / 60) * 100) / 100,
      vatAmount: round2(employees.reduce((s, e) => s + e.vat.amount, 0)),
      employeeGets: round2(employees.reduce((s, e) => s + e.vat.employeeGets, 0)),
      companyCost: round2(employees.reduce((s, e) => s + e.vat.companyCost, 0)),
      employees: employees.length,
      days: days.length,
    },
  }
}

const round2 = (n) => Math.round(n * 100) / 100

/** "5.5% deducted" / "5.5% added (company cost)" / "Not applied". */
export function vatModeLabel(vat) {
  if (!vat || vat.mode === 'none') return VAT_OVERTIME_MODES.none.label
  return `${vat.rate}% ${vat.mode === 'deduct' ? 'deducted' : 'added (company cost)'}`
}

/** CSV for the employee summary (and one line per overtime day). */
export function overtimeToCsv(report, { detail = false } = {}) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  if (detail) {
    const rows = report.employees.flatMap((e) => e.entries.map((d) => [
      d.record.date, OVERTIME_KINDS[d.kind], e.fullName, e.employeeId, e.companyName, d.record.clockOut, d.threshold, d.minutes, d.rate, d.pay.toFixed(2), d.record.source,
    ]))
    return [['Date', 'Type', 'Employee', 'Employee ID', 'Company', 'Clock-out (ISO)', 'Overtime start (ISO)', 'Overtime minutes', 'Rate (GH₵/h)', 'Overtime pay (GH₵)', 'Source'], ...rows].map((r) => r.map(q).join(',')).join('\n')
  }
  const rows = report.employees.map((e) => [e.fullName, e.employeeId, e.companyName, e.position, e.days, e.minutes, e.hours.toFixed(2), e.rates.join(' / '), e.pay.toFixed(2), vatModeLabel(e.vat), e.vat.amount.toFixed(2), e.vat.employeeGets.toFixed(2), e.vat.companyCost.toFixed(2)])
  return [['Employee', 'Employee ID', 'Company', 'Position', 'Days with overtime', 'Overtime minutes', 'Overtime hours', 'Rate (GH₵/h)', 'Overtime pay (GH₵)', 'VAT on overtime', 'VAT amount (GH₵)', 'Employee gets (GH₵)', 'Company cost (GH₵)'], ...rows].map((r) => r.map(q).join(',')).join('\n')
}
