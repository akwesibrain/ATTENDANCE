/**
 * Daily Live Tracker report: one row per Supervisor, Sales Rep and
 * Merchandiser for a day, combining their attendance record (clock-in,
 * clock-out, visits) with their live-tracking summary (time tracked, signal
 * coverage, signal lost, distance). Positions are never included.
 *
 * `fetchTrackingDailyReport` loads the authoritative report from
 * `GET /hr/tracking/reports/daily` (computing today's stays live from
 * `location_points`, or summarising past days on demand). `trackingDailyReport`
 * provides a synchronous initial view from the HR cache while the request loads.
 */
import { trackingResult } from '../../supabase/functions/_shared/rules/tracking.js'
import { api } from './backend/client'
import { rows } from './backend/cache'
import { listAttendanceRecords } from './attendanceRecordsService'
import { TRACKED_CATEGORIES } from './locationTrackingService'
import { getVisitList, visitProof } from './visitListService'
import { getShop } from './shopsService'
import { categoryForPosition } from '../constants/employeeCategories'
import { formatAccraTime } from '../utils/accraTime'

/** Report statuses, best first. `tone` drives the colour of the badge. */
export const TRACKING_RESULT = {
  good: { label: 'Good coverage', tone: 'ok' },
  partial: { label: 'Partial coverage', tone: 'warn' },
  poor: { label: 'Poor coverage', tone: 'crit' },
  'no-signal': { label: 'No location received', tone: 'crit' },
  'not-clocked-in': { label: 'Not clocked in', tone: 'muted' },
  unavailable: { label: 'Trail expired before summary', tone: 'muted' },
  'no-app': { label: 'Not using the app', tone: 'muted' },
}

function summaryMap() {
  return new Map(
    rows('tracking_day_summaries').map((row) => [
      `${row.staff_id}|${row.date}`,
      {
        points: row.points,
        trackedMinutes: row.tracked_minutes,
        coverage: row.coverage,
        signalLost: row.signal_lost,
        longestGapMinutes: row.longest_gap_minutes,
        distanceM: row.distance_m,
        shopStays: row.shop_stays ?? {},
      },
    ]),
  )
}

function expiredSet() {
  return new Set(
    rows('tracking_sessions')
      .filter((row) => row.trail_expired)
      .map((row) => `${row.staff_id}|${row.date}`),
  )
}

/**
 * Proof of a Sales Rep's or Supervisor's shop visits for an attendance record
 * from cached data (used before `fetchTrackingDailyReport` resolves).
 */
export function visitProofForRecord(record, now = new Date()) {
  if (!record.clockIn) {
    const listIds = getVisitList(record.employeeId)
    return {
      listed: listIds.map((shopId) => ({
        shopId,
        shop: getShop(shopId),
        status: 'pending',
        first: null,
        scans: 0,
        scanned: false,
        visitDistance: null,
        stayMinutes: null,
        closest: null,
      })),
      offList: [],
      counts: { listed: listIds.length, proven: 0, visited: 0, missed: 0, flagged: 0 },
    }
  }
  const key = `${record.employeeId}|${record.date}`
  const summary = summaryMap().get(key) ?? null
  const unavailable = !summary && expiredSet().has(key)
  const dayOver = !unavailable && (!record.isToday || Boolean(record.clockOut) || now.getTime() >= Date.parse(record.expectedEnd))
  return visitProof({
    listIds: getVisitList(record.employeeId),
    visits: record.visits ?? [],
    stays: summary ? summary.shopStays : null,
    dayOver,
  })
}

/** Enrich a server `proof` object from `/hr/tracking/reports/daily` with cached shop metadata. */
export function hydrateServerProof(serverProof) {
  if (!serverProof) return null
  return {
    ...serverProof,
    listed: (serverProof.listed ?? []).map((l) => {
      const shop = getShop(l.shopId) ?? (l.shopName ? { shopId: l.shopId, shopName: l.shopName, latitude: l.hasMapLocation ? 0 : null } : null)
      return {
        ...l,
        shop,
        closest: l.closestM ?? l.closest ?? null,
      }
    }),
  }
}

export function summariseReportRows(dateKey, reportRows) {
  const tracked = reportRows.filter((r) => r.coverage != null)
  const totals = {
    staff: reportRows.length,
    clockedIn: reportRows.filter((r) => r.clockIn).length,
    tracked: tracked.length,
    averageCoverage: tracked.length ? tracked.reduce((n, r) => n + r.coverage, 0) / tracked.length : null,
    distanceKm: Math.round(tracked.reduce((n, r) => n + (r.distanceKm ?? 0), 0) * 10) / 10,
    noSignal: reportRows.filter((r) => r.result === 'no-signal' || r.result === 'poor').length,
  }
  return { dateKey, rows: reportRows, totals }
}

/**
 * Synchronous initial report built from cached rows (before the server response arrives).
 * @returns {{ dateKey, rows: object[], totals: object }}
 */
export function trackingDailyReport(companyId, dateKey, now = new Date()) {
  const summaries = summaryMap()
  const expired = expiredSet()
  const records = listAttendanceRecords({ companyId, dates: [dateKey] })
    .map((r) => ({ ...r, category: r.category ?? categoryForPosition(r.position), visits: r.visits ?? [] }))
    .filter((r) => TRACKED_CATEGORIES.has(r.category))

  const reportRows = records.map((r) => {
    const key = `${r.employeeId}|${dateKey}`
    const s = r.clockIn ? summaries.get(key) ?? null : null
    const unavailable = Boolean(r.clockIn) && !s && expired.has(key)
    const result = unavailable ? 'unavailable' : trackingResult({ clockIn: r.clockIn, summary: s })
    const proof = r.category === 'merchandiser' || !r.clockIn ? null : visitProofForRecord(r, now)
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category: r.category,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      stillClockedIn: Boolean(r.clockIn && !r.clockOut && r.isToday),
      visits: r.category === 'merchandiser' ? null : r.visits.length,
      visitRecords: r.category === 'merchandiser' ? [] : r.visits,
      trackedMinutes: s?.trackedMinutes ?? null,
      coverage: s?.coverage ?? null,
      signalLost: s ? s.signalLost : null,
      longestGapMinutes: s ? s.longestGapMinutes : null,
      distanceKm: s ? Math.round(s.distanceM / 100) / 10 : null,
      points: s?.points ?? null,
      shops: proof ? proof.counts : null,
      proof,
      result,
    }
  }).sort((a, b) => a.fullName.localeCompare(b.fullName))

  return summariseReportRows(dateKey, reportRows)
}

/**
 * Authoritative daily report from the server (includes live trail summaries for today
 * and closes/summarises past days on demand).
 */
export async function fetchTrackingDailyReport(companyId, dateKey, role = '') {
  const qs = new URLSearchParams({ companyId, date: dateKey })
  if (role) qs.set('role', role)
  return await api(`/hr/tracking/reports/daily?${qs.toString()}`)
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
    (TRACKING_RESULT[r.result] ?? TRACKING_RESULT['not-clocked-in']).label,
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\n')
}
