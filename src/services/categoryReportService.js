/**
 * Monthly attendance reports by employee category (Warehouse Workers, Sales
 * Representatives, Merchandisers, Supervisors — plus a combined report for
 * every employee). The period is always the attendance cycle, 26th to 25th.
 *
 * Built from the shared attendance records, so every report uses the same
 * calculations as Attendance and Overtime: one record per employee per day,
 * Warehouse breaks taken off working hours, no breaks for Sales Reps and
 * Supervisors, overtime by the weekday / weekend / holiday rules, approved
 * leave and future dates never counted as absences.
 */

import { CATEGORIES } from '../constants/employeeCategories'
import { ATTENDANCE_STATUS, VERIFICATION_STATUS } from '../constants/attendanceLabels'
import { listAttendanceRecords, listAttendanceRoster } from './attendanceRecordsService'
import { overtimeForRecord } from './overtimeService'
import { getPaymentMethodLabel } from '../constants/paymentMethods'
import { holidayForKey } from '../utils/attendanceRules'
import { payPeriodDates } from '../utils/payPeriod'
import { formatAccraTime } from '../utils/accraTime'

const round2 = (n) => Math.round(n * 100) / 100

export const TIER_LABELS = {
  perfect: 'Perfect',
  excellent: 'Excellent',
  good: 'Good',
  'needs-attention': 'Needs attention',
}

function inScope(category, employeeId) {
  return (x) => (!category || category === 'all' || x.category === category) && (!employeeId || x.employeeId === employeeId)
}

/**
 * @param {{ companyId: string, period: object, category?: string, employeeId?: string, records?: object[] }} opts
 *   category: 'all' or a category id. `records` may be passed to reuse an
 *   already loaded period.
 */
export function buildMonthlyReport({ companyId, period, category = 'all', employeeId = '', records = null }) {
  const dates = payPeriodDates(period)
  const holidays = dates.filter((d) => holidayForKey(d)).length
  const keep = inScope(category, employeeId)
  const all = records ?? listAttendanceRecords({ companyId, dates })
  const periodRecords = all.filter(keep)
  const roster = listAttendanceRoster(companyId).filter(keep)

  const rows = roster.map((emp) => {
    const own = periodRecords.filter((r) => r.employeeId === emp.employeeId)
    const scheduled = own.filter((r) => r.workday)
    const present = scheduled.filter((r) => r.hasAttendance).length
    const late = scheduled.filter((r) => r.isLate).length
    const absent = scheduled.filter((r) => r.status === 'absent').length
    const leave = scheduled.filter((r) => r.status === 'on-leave').length
    const unknown = scheduled.filter((r) => r.status === 'unknown').length
    const ot = own.map(overtimeForRecord).filter((o) => o.status === 'counted')
    const overtimeMinutes = ot.reduce((sum, o) => sum + o.minutes, 0)
    const due = present + absent
    const rate = due ? (present / due) * 100 : 0
    let tier = 'needs-attention'
    if (!due) tier = 'good'
    else if (rate >= 99) tier = 'perfect'
    else if (rate >= 95) tier = 'excellent'
    else if (rate >= 90) tier = 'good'
    const attended = own.filter((r) => r.hasAttendance)
    return {
      emp: { staffId: emp.employeeId, fullName: emp.fullName, position: emp.position, paymentMethod: emp.paymentMethod, faceImage: emp.photo },
      category: emp.category,
      workingDays: present + absent + leave + unknown,
      present,
      late,
      absent,
      leave,
      workingHours: round2(own.reduce((sum, r) => sum + (r.workingMinutes ?? 0), 0) / 60),
      breakHours: emp.category === 'warehouse' ? round2(own.reduce((sum, r) => sum + (r.breakMinutes ?? 0), 0) / 60) : null,
      breakIssues: own.filter((r) => r.breakIssue).length,
      visits: own.reduce((sum, r) => sum + (r.visits?.length ?? 0), 0),
      verifiedDays: attended.filter((r) => r.verification === 'verified').length,
      reviewDays: attended.filter((r) => ['review', 'failed', 'not-verified'].includes(r.verification)).length,
      overtime: round2(overtimeMinutes / 60),
      overtimePay: round2(ot.reduce((sum, o) => sum + o.minutes * o.rate, 0) / 60),
      holidays,
      rate,
      due,
      tier,
    }
  }).sort((a, b) => a.emp.fullName.localeCompare(b.emp.fullName))

  const detail = periodRecords
    .filter((r) => r.hasAttendance || ['absent', 'on-leave', 'incomplete'].includes(r.status))
    .map((r) => ({ r, ot: overtimeForRecord(r) }))
    .sort((a, b) => a.r.fullName.localeCompare(b.r.fullName) || a.r.date.localeCompare(b.r.date))

  const totals = rows.reduce((t, r) => ({
    employees: t.employees + 1,
    present: t.present + r.present,
    absent: t.absent + r.absent,
    leave: t.leave + r.leave,
    late: t.late + r.late,
    workingHours: round2(t.workingHours + r.workingHours),
    overtime: round2(t.overtime + r.overtime),
    overtimePay: round2(t.overtimePay + r.overtimePay),
  }), { employees: 0, present: 0, absent: 0, leave: 0, late: 0, workingHours: 0, overtime: 0, overtimePay: 0 })

  return { rows, detail, totals, holidays }
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csv = (rows) => rows.map((r) => r.map(q).join(',')).join('\n')
const categoryName = (id) => CATEGORIES[id]?.single ?? ''
const clock = (iso, unknown) => (unknown ? 'Unknown' : iso ? formatAccraTime(iso) : '')

/** Summary CSV: one line per employee. */
export function monthlyReportSummaryCsv(report) {
  const head = ['#', 'Employee Name', 'Employee ID', 'Category', 'Position', 'Payment Method', 'Working Days', 'Present', 'Late Arrivals', 'Absent', 'Approved Leave', 'Working Hours', 'Break Hours (Warehouse)', 'Breaks Needing Review', 'Outlet Visits', 'Verified Days', 'Days Needing Verification Review', 'Overtime (hrs)', 'Overtime Earnings (GH₵)', 'Holidays', 'Attendance %', 'Status']
  const lines = report.rows.map((r, i) => [
    i + 1, r.emp.fullName, r.emp.staffId, categoryName(r.category), r.emp.position, getPaymentMethodLabel(r.emp.paymentMethod),
    r.workingDays, r.present, r.late, r.absent, r.leave, r.workingHours.toFixed(2),
    r.breakHours == null ? 'Not applicable' : r.breakHours.toFixed(2), r.breakIssues,
    r.category === 'sales-rep' || r.category === 'supervisor' ? r.visits : 'Not applicable',
    r.verifiedDays, r.reviewDays, r.overtime.toFixed(2), r.overtimePay.toFixed(2), r.holidays,
    r.due ? `${r.rate.toFixed(1)}%` : '—', TIER_LABELS[r.tier],
  ])
  return csv([head, ...lines])
}

/** Daily CSV: one line per employee per day (attendance dates). */
export function monthlyReportDailyCsv(report) {
  const head = ['Date', 'Employee Name', 'Employee ID', 'Category', 'Position', 'Clock-In', 'Break Departure(s)', 'Break Return(s)', 'Clock-Out', 'Status', 'Late (minutes)', 'Break (minutes)', 'Working Hours', 'Outlet Visits', 'Verification', 'Overtime (min)', 'Overtime Earnings (GH₵)', 'Notes']
  const lines = report.detail.map(({ r, ot }) => [
    r.date, r.fullName, r.employeeId, categoryName(r.category), r.position,
    clock(r.clockIn, r.clockInUnknown),
    r.breaks.map((b) => formatAccraTime(b.start)).join(' / '),
    r.breaks.map((b) => (b.end ? formatAccraTime(b.end) : 'Not scanned')).join(' / '),
    clock(r.clockOut, r.clockOutUnknown),
    ATTENDANCE_STATUS[r.status]?.label ?? r.status,
    r.isLate ? r.lateMinutes : '',
    r.category === 'warehouse' ? r.breakMinutes : '',
    r.breakIssue ? 'Needs review' : r.workingMinutes ? (r.workingMinutes / 60).toFixed(2) : '',
    r.category === 'sales-rep' || r.category === 'supervisor' ? r.visits.length : '',
    VERIFICATION_STATUS[r.verification]?.label ?? r.verification,
    ot.status === 'counted' ? ot.minutes : '',
    ot.status === 'counted' ? ot.pay.toFixed(2) : '',
    r.notes.join(' '),
  ])
  return csv([head, ...lines])
}
