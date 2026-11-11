/**
 * Daily Live Tracker report: one row per Supervisor, Sales Rep and
 * Merchandiser for a day, combining their attendance record (clock-in,
 * clock-out, visits) with their live-tracking summary (time tracked, signal
 * coverage, signal lost, distance). Positions are never included.
 *
 * Only people who use the attendance app can be tracked; demo staff without
 * the app are listed as "Not using the app" rather than given invented data.
 */
import { listAttendanceRecords } from './attendanceRecordsService'
import { TRACKED_CATEGORIES, dayShopStays, daySummary } from './locationTrackingService'
import { getVisitList, visitProof } from './visitListService'
import { mockFindEmployeeByStaffId } from './registrationService'
import { formatAccraTime } from '../utils/accraTime'

/** Report statuses, best first. `tone` drives the colour of the badge. */
export const TRACKING_RESULT = {
  good: { label: 'Good coverage', tone: 'ok' },
  partial: { label: 'Partial coverage', tone: 'warn' },
  poor: { label: 'Poor coverage', tone: 'crit' },
  'no-signal': { label: 'No location received', tone: 'crit' },
  'not-clocked-in': { label: 'Not clocked in', tone: 'muted' },
  'no-app': { label: 'Not using the app', tone: 'muted' },
}
const GOOD = 0.9
const PARTIAL = 0.6

function resultFor(record, usesApp, s) {
  if (!usesApp) return 'no-app'
  if (!record.clockIn) return 'not-clocked-in'
  if (!s || !s.points) return 'no-signal'
  if (s.coverage >= GOOD) return 'good'
  if (s.coverage >= PARTIAL) return 'partial'
  return 'poor'
}

/**
 * Proof of a Sales Rep's or Supervisor's shop visits for the day of an
 * attendance record (see visitListService for the rules).
 */
export function visitProofForRecord(record, now = new Date()) {
  const dayOver = !record.isToday || Boolean(record.clockOut) || now.getTime() >= Date.parse(record.expectedEnd)
  return visitProof({
    listIds: getVisitList(record.employeeId),
    visits: record.visits ?? [],
    stays: dayShopStays(record.employeeId, record.date),
    dayOver,
  })
}

/**
 * @returns {{ dateKey, rows: object[], totals: object }}
 */
export function trackingDailyReport(companyId, dateKey, now = new Date()) {
  const records = listAttendanceRecords({ companyId, dates: [dateKey] })
    .filter((r) => TRACKED_CATEGORIES.has(r.category))
  const rows = records.map((r) => {
    const usesApp = Boolean(mockFindEmployeeByStaffId(r.employeeId))
    const s = usesApp && r.clockIn ? daySummary(r.employeeId, dateKey, r.clockIn, r.clockOut, now) : null
    const result = resultFor(r, usesApp, s)
    const proof = r.category === 'merchandiser' ? null : visitProofForRecord(r, now)
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category: r.category,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      stillClockedIn: Boolean(r.clockIn && !r.clockOut && r.isToday),
      visits: r.category === 'merchandiser' ? null : r.visits.length,
      trackedMinutes: s?.trackedMinutes ?? null,
      coverage: s?.coverage ?? null,
      signalLost: s ? s.signalLost : null,
      longestGapMinutes: s ? s.longestGapMinutes : null,
      distanceKm: s ? Math.round(s.distanceM / 100) / 10 : null,
      points: s?.points ?? null,
      // Sales Reps / Supervisors: listed shops proven today.
      shops: proof ? proof.counts : null,
      result,
    }
  }).sort((a, b) => a.fullName.localeCompare(b.fullName))

  const tracked = rows.filter((r) => r.coverage != null)
  const totals = {
    staff: rows.length,
    clockedIn: rows.filter((r) => r.clockIn).length,
    tracked: tracked.length,
    averageCoverage: tracked.length ? tracked.reduce((n, r) => n + r.coverage, 0) / tracked.length : null,
    distanceKm: Math.round(tracked.reduce((n, r) => n + (r.distanceKm ?? 0), 0) * 10) / 10,
    noSignal: rows.filter((r) => r.result === 'no-signal' || r.result === 'poor').length,
  }
  return { dateKey, rows, totals }
}

export function minutesText(m) {
  if (m == null) return '—'
  const h = Math.floor(m / 60)
  return h ? `${h} h ${m % 60} min` : `${m} min`
}

export function percentText(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

const CATEGORY = { supervisor: 'Supervisor', 'sales-rep': 'Sales Rep', merchandiser: 'Merchandiser' }

export function trackingReportToCsv(report) {
  const cell = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Date', 'Employee ID', 'Name', 'Role', 'Clock in', 'Clock out', 'Time tracked (min)', 'Live coverage (%)', 'Signal lost (times)', 'Longest gap (min)', 'Distance (km)', 'Location points', 'Outlet visits', 'Listed shops', 'Shops proven', 'Visits flagged', 'Result']
  const lines = report.rows.map((r) => [
    report.dateKey,
    r.employeeId,
    r.fullName,
    CATEGORY[r.category],
    r.clockIn ? formatAccraTime(r.clockIn) : '',
    r.clockOut ? formatAccraTime(r.clockOut) : r.stillClockedIn ? 'Still clocked in' : '',
    r.trackedMinutes ?? '',
    r.coverage == null ? '' : Math.round(r.coverage * 100),
    r.signalLost ?? '',
    r.longestGapMinutes ?? '',
    r.distanceKm ?? '',
    r.points ?? '',
    r.visits ?? '',
    r.shops?.listed ?? '',
    r.shops?.proven ?? '',
    r.shops?.flagged ?? '',
    TRACKING_RESULT[r.result].label,
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\n')
}
