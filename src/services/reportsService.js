/**
 * ============================================================================
 * REPORTS & ANALYTICS — calculations over the shared mock data
 * ============================================================================
 * Every figure is computed from the attendance records built by
 * attendanceRecordsService (digital, SMS verification, approved historical
 * imports, corrections, leave). Nothing is stored or hardcoded here.
 *
 * Rules (shared with Attendance):
 *   - Attendance periods run from the 26th to the 25th (Africa/Accra).
 *   - Future dates are never included, so never counted as absences.
 *   - "Due" days = present + absent. Approved leave, rest days, holidays,
 *     Unknown (missing historical) days and shifts not yet ended are not due.
 *   - Attendance rate = present ÷ due. With no due days the rate is "no data",
 *     never 0%.
 *   - A missed SMS verification is an exception count, never an absence.
 * ============================================================================
 */

import { COMPANIES } from '../constants/companies'
import { canViewCompany } from '../constants/hrUser'
import { ATTENDANCE_SOURCE, ATTENDANCE_STATUS, VERIFICATION_STATUS } from '../constants/attendanceLabels'
import { listAttendanceRecords, listAttendanceRoster } from './attendanceRecordsService'
import { mockListAllShops } from './shopsService'
import { mockListShifts } from './shiftsService'
import { listPayPeriods, payPeriodDates, getPayPeriod } from '../utils/payPeriod'
import { DEFAULT_SCHEDULE } from '../utils/attendanceRules'
import {
  accraMidnightMs,
  accraTodayKey,
  addDaysToKey,
  dayOfWeekForKey,
  formatAccraDate,
  formatAccraDateTime,
  formatAccraTime,
} from '../utils/accraTime'

export const MAX_CUSTOM_DAYS = 186
const NOT_DUE = ['scheduled', 'awaiting']
const DATE = /^\d{4}-\d{2}-\d{2}$/

const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/* --------------------------------------------------------------------------
 * Reporting range
 * ------------------------------------------------------------------------ */

/** Attendance periods for the selector, newest first (current included). */
export function reportPeriods(count = 12) {
  return listPayPeriods(count)
}

export function validateCustomRange(from, to) {
  if (!DATE.test(from ?? '') || !DATE.test(to ?? '')) return 'Choose both a start and an end date.'
  if (from > to) return 'The start date must be on or before the end date.'
  const days = Math.round((accraMidnightMs(to) - accraMidnightMs(from)) / 86400000) + 1
  if (days > MAX_CUSTOM_DAYS) return `A custom range can cover at most ${MAX_CUSTOM_DAYS} days.`
  if (from > accraTodayKey()) return 'The range starts in the future, so there is nothing to report yet.'
  return null
}

/**
 * The dates a report covers. Future dates are dropped (never absences).
 * @returns {{ dates, start, end, label, slug, futureExcluded, error }}
 */
export function resolveRange({ mode, periodKey, from, to }) {
  const today = accraTodayKey()
  if (mode === 'custom') {
    const error = validateCustomRange(from, to)
    if (error) return { dates: [], start: from, end: to, label: 'Custom range', slug: 'custom', futureExcluded: false, error }
    const all = []
    for (let d = from; d <= to; d = addDaysToKey(d, 1)) all.push(d)
    return {
      dates: all.filter((d) => d <= today),
      start: from,
      end: to,
      label: `${formatAccraDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatAccraDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`,
      slug: `${from}_to_${to}`,
      futureExcluded: to > today,
      error: null,
    }
  }
  const period = reportPeriods(24).find((p) => p.key === periodKey) ?? getPayPeriod()
  const all = payPeriodDates(period)
  return {
    dates: all.filter((d) => d <= today),
    start: keyOf(period.start),
    end: keyOf(period.end),
    label: `${period.label} period`,
    slug: `period-${period.key}`,
    period,
    futureExcluded: all[all.length - 1] > today,
    error: null,
  }
}

/* --------------------------------------------------------------------------
 * Scope and filters
 * ------------------------------------------------------------------------ */

/** Companies in scope: the chosen one, or every company the user may see. */
export function scopeCompanies(user, companyId) {
  if (companyId) return canViewCompany(user, companyId) ? [companyId] : []
  return COMPANIES.filter((c) => canViewCompany(user, c.id)).map((c) => c.id)
}

/** Attendance records for the user's scope over a set of dates. */
export function loadScopedRecords(user, companyId, dates) {
  const companies = scopeCompanies(user, companyId)
  if (!companies.length || !dates.length) return []
  const all = listAttendanceRecords({ companyId: companies.length === 1 ? companies[0] : null, dates })
  return all.filter((r) => companies.includes(r.companyId))
}

export function scopedRoster(user, companyId) {
  const companies = scopeCompanies(user, companyId)
  return listAttendanceRoster(null).filter((e) => companies.includes(e.companyId))
}

function matchesWho(e, f, shiftIdOf) {
  const term = (f.search ?? '').trim().toLowerCase()
  if (term && !e.fullName.toLowerCase().includes(term) && !e.employeeId.toLowerCase().includes(term)) return false
  if (f.position && e.position !== f.position) return false
  if (f.shopId && e.shopId !== f.shopId) return false
  if (f.shiftId) {
    const sid = shiftIdOf(e)
    if (f.shiftId === '__none' ? sid : sid !== f.shiftId) return false
  }
  return true
}

export function filterRoster(roster, f) {
  return roster.filter((e) => matchesWho(e, f, (x) => x.shiftId ?? null))
}

export function filterRecords(records, f) {
  return records.filter((r) => matchesWho(r, f, (x) => x.schedule.shiftId ?? null))
}

/* --------------------------------------------------------------------------
 * Tallies
 * ------------------------------------------------------------------------ */

export function tally(records) {
  const t = {
    scheduled: 0, present: 0, late: 0, absent: 0, leave: 0, unknown: 0, incomplete: 0,
    knownArrival: 0, minutes: 0, restDayDays: 0, restDayMinutes: 0, historicalDays: 0, digitalDays: 0,
  }
  records.forEach((r) => {
    if (r.workday && !NOT_DUE.includes(r.status)) t.scheduled += 1
    if (r.workday && r.hasAttendance) {
      t.present += 1
      if (!r.lateUnknown) t.knownArrival += 1
      if (r.isLate) t.late += 1
    }
    if (r.status === 'absent') t.absent += 1
    if (r.status === 'on-leave') t.leave += 1
    if (r.status === 'unknown') t.unknown += 1
    if (r.status === 'incomplete') t.incomplete += 1
    if (r.workingMinutes) t.minutes += r.workingMinutes
    if (r.restDayWork) {
      t.restDayDays += 1
      t.restDayMinutes += r.workingMinutes ?? 0
    }
    if (r.hasAttendance) {
      if (r.historical) t.historicalDays += 1
      else t.digitalDays += 1
    }
  })
  t.due = t.present + t.absent
  t.rate = t.due ? (t.present / t.due) * 100 : null
  t.onTimeRate = t.knownArrival ? ((t.knownArrival - t.late) / t.knownArrival) * 100 : null
  t.hours = Math.round((t.minutes / 60) * 10) / 10
  return t
}

export function pct(value, digits = 1) {
  return value == null ? 'No data' : `${value.toFixed(digits)}%`
}

function groupBy(list, keyFn) {
  const map = new Map()
  list.forEach((x) => {
    const k = keyFn(x)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(x)
  })
  return map
}

const TIER_LABELS = { perfect: 'Perfect', excellent: 'Excellent', good: 'Good', 'needs-attention': 'Needs Attention', 'no-data': 'No data' }

function tierFor(rate) {
  if (rate == null) return 'no-data'
  if (rate >= 99) return 'perfect'
  if (rate >= 95) return 'excellent'
  if (rate >= 90) return 'good'
  return 'needs-attention'
}

export { TIER_LABELS }

/* --------------------------------------------------------------------------
 * Employee summaries
 * ------------------------------------------------------------------------ */

function shiftNameFor(e, shiftsById) {
  if (!e.shiftId) return `${DEFAULT_SCHEDULE.name} (no shift)`
  const s = shiftsById.get(e.shiftId)
  return s ? `${s.name} (${s.code})` : 'Unknown shift'
}

export function employeeSummaries(records, roster) {
  const byEmp = groupBy(records, (r) => r.employeeId)
  const shops = new Map(mockListAllShops().map((s) => [s.shopId, s]))
  const shifts = new Map(mockListShifts().map((s) => [s.shiftId, s]))
  return roster.map((e) => {
    const own = byEmp.get(e.employeeId) ?? []
    const t = tally(own)
    return {
      employeeId: e.employeeId,
      fullName: e.fullName,
      companyId: e.companyId,
      companyName: e.companyName,
      position: e.position,
      paymentMethod: e.paymentMethod ?? '',
      photo: e.photo,
      isFieldRole: e.isFieldRole,
      shopId: e.shopId,
      shopName: e.shopId ? shops.get(e.shopId)?.shopName ?? 'Unknown shop' : e.isFieldRole ? 'Not assigned' : 'Not applicable',
      shiftId: e.shiftId ?? null,
      shiftName: shiftNameFor(e, shifts),
      records: own.length,
      tier: tierFor(t.rate),
      ...t,
    }
  })
}

/* --------------------------------------------------------------------------
 * Daily / weekly / company / shop / shift breakdowns
 * ------------------------------------------------------------------------ */

export function dailyRows(records, dates) {
  const byDate = groupBy(records, (r) => r.date)
  return dates.map((d) => ({ key: d, label: formatAccraDate(d, { weekday: 'short', day: 'numeric', month: 'short' }), ...tally(byDate.get(d) ?? []) }))
}

/** Monday of the week containing a date (Accra). */
function weekStart(dateKey) {
  const dow = dayOfWeekForKey(dateKey)
  return addDaysToKey(dateKey, -((dow + 6) % 7))
}

export function weeklyRows(records, dates) {
  const weeks = []
  const seen = new Map()
  dates.forEach((d) => {
    const w = weekStart(d)
    if (!seen.has(w)) {
      seen.set(w, { key: w, first: d, last: d })
      weeks.push(seen.get(w))
    } else seen.get(w).last = d
  })
  const byWeek = groupBy(records, (r) => weekStart(r.date))
  return weeks.map((w) => ({
    key: w.key,
    label: `${formatAccraDate(w.first, { day: 'numeric', month: 'short' })} – ${formatAccraDate(w.last, { day: 'numeric', month: 'short' })}`,
    ...tally(byWeek.get(w.key) ?? []),
  }))
}

export function companyRows(records, companyIds) {
  const byCo = groupBy(records, (r) => r.companyId)
  return companyIds.map((id) => ({ key: id, label: COMPANIES.find((c) => c.id === id)?.name ?? id, ...tally(byCo.get(id) ?? []) }))
}

/** Open attendance / sales exceptions for a set of employees within the dates. */
export function pendingExceptions(notifications, employeeIds, dates) {
  const ids = new Set(employeeIds)
  const days = new Set(dates)
  return notifications.filter(
    (n) =>
      ['new', 'under-review'].includes(n.status) &&
      n.kind === 'exception' &&
      ['attendance', 'sales-monitoring'].includes(n.category) &&
      n.employeeId && ids.has(n.employeeId) &&
      (!n.relatedDate || days.has(n.relatedDate)),
  )
}

export function shopRows(records, roster, notifications, dates, companyIds) {
  const byShop = groupBy(records.filter((r) => r.shopId), (r) => r.shopId)
  const ver = verificationByEmployee(records)
  return mockListAllShops()
    .filter((s) => companyIds.includes(s.companyId))
    .map((shop) => {
      const staff = roster.filter((e) => e.shopId === shop.shopId)
      const t = tally(byShop.get(shop.shopId) ?? [])
      const v = sumVerification(staff.map((e) => ver.get(e.employeeId)).filter(Boolean))
      return {
        key: shop.shopId,
        label: shop.shopName,
        companyName: COMPANIES.find((c) => c.id === shop.companyId)?.name ?? '',
        status: shop.status,
        assigned: staff.length,
        ...t,
        checks: v.checks,
        verified: v.verified,
        verificationRate: v.checks ? (v.verified / v.checks) * 100 : null,
        pendingExceptions: pendingExceptions(notifications, staff.map((e) => e.employeeId), dates).length,
      }
    })
}

export function shiftRows(records, roster, companyIds) {
  const bySchedule = groupBy(records, (r) => r.schedule.shiftId ?? '__none')
  const rows = mockListShifts()
    .filter((s) => companyIds.includes(s.companyId))
    .map((s) => ({
      key: s.shiftId,
      label: `${s.name} (${s.code})`,
      companyName: COMPANIES.find((c) => c.id === s.companyId)?.name ?? '',
      hours: `${s.startTime}–${s.endTime}`,
      status: s.status,
      assigned: roster.filter((e) => e.shiftId === s.shiftId).length,
      ...tally(bySchedule.get(s.shiftId) ?? []),
    }))
  const unassigned = roster.filter((e) => !e.shiftId)
  if (unassigned.length) {
    rows.push({
      key: '__none',
      label: `${DEFAULT_SCHEDULE.name} (no shift assigned)`,
      companyName: companyIds.length > 1 ? 'All' : COMPANIES.find((c) => c.id === companyIds[0])?.name ?? '',
      hours: `${DEFAULT_SCHEDULE.startTime}–${DEFAULT_SCHEDULE.endTime}`,
      status: 'active',
      assigned: unassigned.length,
      ...tally(bySchedule.get('__none') ?? []),
    })
  }
  return rows
}

/* --------------------------------------------------------------------------
 * Sales representative verification (past events only)
 * ------------------------------------------------------------------------ */

const EXCEPTION_RESULTS = ['missed', 'failed-face', 'outside-shop', 'gps-unavailable', 'sms-failed']

function emptyVer() {
  return { checks: 0, verified: 0, missed: 0, faceFailed: 0, outside: 0, gpsUnavailable: 0, smsFailed: 0, daysWithChecks: 0, repeatedDays: 0, lastCheckAt: null }
}

function sumVerification(list) {
  const s = emptyVer()
  list.forEach((v) => Object.keys(s).forEach((k) => {
    if (k === 'lastCheckAt') { if (v.lastCheckAt && (!s.lastCheckAt || v.lastCheckAt > s.lastCheckAt)) s.lastCheckAt = v.lastCheckAt }
    else s[k] += v[k]
  }))
  return s
}

/** Per-employee verification counts from the records' SMS events. */
export function verificationByEmployee(records) {
  const map = new Map()
  records.forEach((r) => {
    if (!r.smsEvents.length) return
    const v = map.get(r.employeeId) ?? emptyVer()
    v.daysWithChecks += 1
    let exceptions = 0
    r.smsEvents.forEach((e) => {
      v.checks += 1
      if (e.result === 'verified') v.verified += 1
      if (e.result === 'missed') v.missed += 1
      if (e.result === 'failed-face') v.faceFailed += 1
      if (e.result === 'outside-shop') v.outside += 1
      if (e.result === 'gps-unavailable') v.gpsUnavailable += 1
      if (e.result === 'sms-failed') v.smsFailed += 1
      if (EXCEPTION_RESULTS.includes(e.result)) exceptions += 1
      const at = e.respondedAt ?? e.dispatchedAt
      if (!v.lastCheckAt || at > v.lastCheckAt) v.lastCheckAt = at
    })
    if (exceptions >= 2) v.repeatedDays += 1
    map.set(r.employeeId, v)
  })
  return map
}

export function verificationReport(records, roster) {
  const field = roster.filter((e) => e.isFieldRole)
  const byEmp = verificationByEmployee(records)
  const shops = new Map(mockListAllShops().map((s) => [s.shopId, s]))
  const employees = field.map((e) => {
    const v = byEmp.get(e.employeeId) ?? emptyVer()
    return {
      employeeId: e.employeeId,
      fullName: e.fullName,
      companyName: e.companyName,
      position: e.position,
      shopId: e.shopId,
      shopName: e.shopId ? shops.get(e.shopId)?.shopName ?? 'Unknown shop' : 'Not assigned',
      hasSmsData: byEmp.has(e.employeeId),
      ...v,
      gpsFailed: v.outside + v.gpsUnavailable,
      successRate: v.checks ? (v.verified / v.checks) * 100 : null,
      repeated: v.repeatedDays > 0,
    }
  })
  const totals = sumVerification(employees)
  totals.gpsFailed = totals.outside + totals.gpsUnavailable
  totals.successRate = totals.checks ? (totals.verified / totals.checks) * 100 : null

  const shopMap = groupBy(employees.filter((e) => e.shopId), (e) => e.shopId)
  const shopSummaries = [...shopMap.entries()].map(([shopId, list]) => {
    const s = sumVerification(list)
    return {
      key: shopId,
      label: shops.get(shopId)?.shopName ?? shopId,
      employees: list.length,
      ...s,
      gpsFailed: s.outside + s.gpsUnavailable,
      exceptions: s.missed + s.faceFailed + s.outside + s.gpsUnavailable + s.smsFailed,
      successRate: s.checks ? (s.verified / s.checks) * 100 : null,
    }
  }).sort((a, b) => a.label.localeCompare(b.label))

  const nowIso = new Date().toISOString()
  const exceptionEvents = []
  records.forEach((r) => r.smsEvents.forEach((e) => {
    if (!EXCEPTION_RESULTS.includes(e.result)) return
    const at = e.respondedAt ?? e.dispatchedAt
    if (at > nowIso) return // never anything in the future
    exceptionEvents.push({ key: e.eventId, at, employeeId: r.employeeId, fullName: r.fullName, shopName: r.shop?.shopName ?? '—', date: r.date, number: e.verificationNumber, result: e.result, sentAt: e.dispatchedAt, respondedAt: e.respondedAt, distance: e.distanceFromShop })
  }))
  exceptionEvents.sort((a, b) => b.at.localeCompare(a.at))

  return {
    fieldCount: field.length,
    withShop: field.filter((e) => e.shopId).length,
    needShop: field.filter((e) => !e.shopId).length,
    repeatedEmployees: employees.filter((e) => e.repeated).length,
    totals,
    employees,
    shops: shopSummaries,
    exceptionEvents,
  }
}

/* --------------------------------------------------------------------------
 * Period trend
 * ------------------------------------------------------------------------ */

/** The `count` periods ending with the one containing `endKey`, oldest first. */
export function trendPeriods(endKey, count = 6) {
  const [y, m, d] = endKey.split('-').map(Number)
  return listPayPeriods(count, new Date(y, m - 1, d)).reverse()
}

/* --------------------------------------------------------------------------
 * Record-level lists and CSV
 * ------------------------------------------------------------------------ */

export function recordRowsFor(kind, records) {
  const pick = {
    late: (r) => r.isLate,
    absences: (r) => r.status === 'absent',
    leave: (r) => r.status === 'on-leave',
    incomplete: (r) => r.status === 'incomplete',
  }[kind]
  return records.filter(pick).sort((a, b) => b.date.localeCompare(a.date) || a.fullName.localeCompare(b.fullName))
}

export function sourceText(r) {
  if (!r.source) return 'No record'
  const base = ATTENDANCE_SOURCE[r.source]?.label ?? r.source
  if (r.source === 'hr-correction' && r.historical) return `${base} (of ${ATTENDANCE_SOURCE.historical.label})`
  return base
}

export function toCsv(header, rows) {
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

const num = (v, d = 1) => (v == null ? '' : Number(v.toFixed(d)))

/** CSV builders. Each respects whatever records/rows it is given (already filtered). */
export const csv = {
  employees(rows) {
    return toCsv(
      ['Employee Name', 'Employee ID', 'Company', 'Position', 'Assigned Shop', 'Assigned Shift', 'Payment Method', 'Days Scheduled', 'Days Present', 'Days Absent', 'Days Late', 'Days On Leave', 'Unknown (no record)', 'Incomplete', 'Historical Days', 'Digital Days', 'Total Working Hours', 'Rest-day Hours', 'Attendance %', 'On-time %', 'Status'],
      rows.map((r) => [r.fullName, r.employeeId, r.companyName, r.position, r.shopName, r.shiftName, r.paymentMethod, r.scheduled, r.present, r.absent, r.late, r.leave, r.unknown, r.incomplete, r.historicalDays, r.digitalDays, r.hours, Math.round((r.restDayMinutes / 60) * 10) / 10, num(r.rate), num(r.onTimeRate), TIER_LABELS[r.tier]]),
    )
  },
  breakdown(rows, firstColumn) {
    return toCsv(
      [firstColumn, 'Days Scheduled', 'Present', 'Absent', 'Late', 'On Leave', 'Unknown', 'Incomplete', 'Working Hours', 'Attendance %', 'On-time %'],
      rows.map((r) => [r.label, r.scheduled, r.present, r.absent, r.late, r.leave, r.unknown, r.incomplete, r.hours, num(r.rate), num(r.onTimeRate)]),
    )
  },
  records(records) {
    return toCsv(
      ['Date', 'Employee Name', 'Employee ID', 'Company', 'Position', 'Assigned Shop', 'Assigned Shift', 'Expected Start', 'Clock-In', 'Clock-Out', 'Working Hours', 'Status', 'Late (min)', 'Verification', 'Source', 'Notes'],
      records.map((r) => [
        r.date, r.fullName, r.employeeId, r.companyName, r.position, r.shop?.shopName ?? '', r.schedule.name,
        formatAccraTime(r.expectedStart),
        r.clockInUnknown ? 'Unknown' : r.clockIn ? formatAccraTime(r.clockIn) : '',
        r.clockOutUnknown ? 'Unknown' : r.clockOut ? formatAccraTime(r.clockOut) : '',
        r.workingMinutes ? Math.round((r.workingMinutes / 60) * 100) / 100 : '',
        ATTENDANCE_STATUS[r.status]?.label ?? r.status,
        r.isLate ? r.lateMinutes : '',
        VERIFICATION_STATUS[r.verification]?.label ?? '',
        sourceText(r),
        r.notes.join(' '),
      ]),
    )
  },
  hours(rows) {
    return toCsv(
      ['Employee Name', 'Employee ID', 'Company', 'Position', 'Assigned Shift', 'Days With Hours', 'Total Working Hours', 'Average Hours / Day', 'Rest-day Days', 'Rest-day Hours', 'Days With Unknown Duration'],
      rows.map((r) => [r.fullName, r.employeeId, r.companyName, r.position, r.shiftName, r.daysWithHours, r.hours, r.avgHours ?? '', r.restDayDays, Math.round((r.restDayMinutes / 60) * 10) / 10, r.unknownDuration]),
    )
  },
  shops(rows) {
    return toCsv(
      ['Shop', 'Company', 'Status', 'Assigned Employees', 'Days Scheduled', 'Present', 'Absent', 'Late', 'Attendance %', 'Verification Checks', 'Verified', 'Verification Success %', 'Pending Exceptions'],
      rows.map((r) => [r.label, r.companyName, r.status, r.assigned, r.scheduled, r.present, r.absent, r.late, num(r.rate), r.checks, r.verified, num(r.verificationRate), r.pendingExceptions]),
    )
  },
  shifts(rows) {
    return toCsv(
      ['Shift', 'Company', 'Hours', 'Status', 'Assigned Employees', 'Days Scheduled', 'Present', 'Absent', 'Late', 'Incomplete', 'Attendance %', 'On-time %'],
      rows.map((r) => [r.label, r.companyName, r.hours, r.status, r.assigned, r.scheduled, r.present, r.absent, r.late, r.incomplete, num(r.rate), num(r.onTimeRate)]),
    )
  },
  verificationEmployees(rows) {
    return toCsv(
      ['Employee Name', 'Employee ID', 'Company', 'Position', 'Assigned Shop', 'Days With Checks', 'Checks', 'Verified', 'Missed', 'Face Failed', 'Outside Geofence', 'GPS Unavailable', 'SMS Delivery Failed', 'Success %', 'Days With 2+ Exceptions', 'Last Check (actual)'],
      rows.map((r) => [r.fullName, r.employeeId, r.companyName, r.position, r.shopName, r.daysWithChecks, r.checks, r.verified, r.missed, r.faceFailed, r.outside, r.gpsUnavailable, r.smsFailed, num(r.successRate), r.repeatedDays, r.lastCheckAt ? formatAccraDateTime(r.lastCheckAt) : '']),
    )
  },
  verificationShops(rows) {
    return toCsv(
      ['Shop', 'Employees', 'Checks', 'Verified', 'Missed', 'Face Failed', 'Outside Geofence', 'GPS Unavailable', 'SMS Delivery Failed', 'Success %'],
      rows.map((r) => [r.label, r.employees, r.checks, r.verified, r.missed, r.faceFailed, r.outside, r.gpsUnavailable, r.smsFailed, num(r.successRate)]),
    )
  },
}

/** Working-hours rows per employee. */
export function hoursRows(summaries, records) {
  const byEmp = groupBy(records, (r) => r.employeeId)
  return summaries.map((s) => {
    const own = byEmp.get(s.employeeId) ?? []
    const withHours = own.filter((r) => r.workingMinutes)
    const unknownDuration = own.filter((r) => r.hasAttendance && !r.workingMinutes).length
    return {
      ...s,
      daysWithHours: withHours.length,
      avgHours: withHours.length ? Math.round((s.minutes / 60 / withHours.length) * 10) / 10 : null,
      unknownDuration,
    }
  })
}

/** Filename: attendance-<report>-<company>-<period>.csv */
export function reportFilename(report, companyId, range) {
  return `attendance-${report}-${companyId || 'all-authorised-companies'}-${range.slug}.csv`
}
