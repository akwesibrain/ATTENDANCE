/**
 * Live Field Tracker — where Supervisors, Sales Representatives and
 * Merchandisers were last recorded today.
 *
 * Positions are never invented. Field staff who clock in with the attendance
 * app are tracked LIVE from their phone (`tracking_latest`) between clock-in
 * and clock-out; tracking stops at clock-out and they leave the map.
 * Until a live location arrives while clocked in:
 *   - Supervisors / Sales Reps show at their latest visited mapped outlet ("outlet").
 *   - Merchandisers show at their primary allocated shop ("shop").
 */

import { LIVE_STALE_MINUTES } from '../../supabase/functions/_shared/rules/tracking.js'
import { rows } from './backend/cache'
import { listAttendanceRecords } from './attendanceRecordsService'
import { VISIT_RESULT, outletLabel } from './fieldVisitsService'
import { getShop } from './shopsService'
import { getVisitListShops } from './visitListService'
import { categoryForPosition } from '../constants/employeeCategories'
import { accraTodayKey } from '../utils/accraTime'

/** Marker colours (the map also shows a letter badge, so colour is not the only cue). */
export const TRACKER_GROUPS = {
  supervisor: { label: 'Supervisors', single: 'Supervisor', color: '#15803d' },
  'sales-rep': { label: 'Sales Reps', single: 'Sales Rep', color: '#dc2626' },
  merchandiser: { label: 'Merchandisers', single: 'Merchandiser', color: '#111827' },
}

export const POSITION_SOURCE = {
  gps: 'Phone GPS at last outlet visit',
  outlet: 'Visited shop location',
  live: 'Live phone location',
  shop: 'Allocated shop',
}

function dutyText(r) {
  if (r.status === 'on-leave') return 'On leave'
  if (r.atWork) return 'On duty'
  if (r.clockOut) return 'Clocked out — tracking stopped'
  if (r.status === 'absent') return 'Marked absent'
  if (r.status === 'incomplete') return 'No clock-out'
  if (!r.workday) return 'Not scheduled'
  return 'Not clocked in'
}

function fallbackPosition(r, shops) {
  if (r.category === 'merchandiser') {
    const primary = shops[0] ?? r.shop ?? null
    return primary && primary.latitude != null
      ? { latitude: primary.latitude, longitude: primary.longitude, accuracy: null, source: 'shop', at: null, place: primary.shopName }
      : null
  }
  const visits = r.visits ?? []
  for (let i = visits.length - 1; i >= 0; i -= 1) {
    const v = visits[i]
    if (v.location && Number.isFinite(v.location.latitude)) {
      return {
        latitude: v.location.latitude,
        longitude: v.location.longitude,
        accuracy: v.location.accuracy ?? null,
        source: 'gps',
        at: v.time,
        place: outletLabel(v.outlet),
      }
    }
    if (v.outlet?.shopId) {
      const sh = getShop(v.outlet.shopId)
      if (sh && sh.latitude != null) {
        return { latitude: sh.latitude, longitude: sh.longitude, accuracy: null, source: 'outlet', at: v.time, place: sh.shopName }
      }
    }
  }
  return null
}

/**
 * @returns {{ asOf: string, people: object[], counts: object }}
 *   counts[category] = { total, placed, onDuty }
 */
export function getLiveTracker(companyId, now = new Date()) {
  const today = accraTodayKey()
  const latestById = new Map(
    rows('tracking_latest')
      .filter((row) => row.date === today)
      .map((row) => [row.staff_id, row]),
  )
  const sessionById = new Map(
    rows('tracking_sessions')
      .filter((row) => row.date === today)
      .map((row) => [row.staff_id, row]),
  )

  const records = listAttendanceRecords({ companyId, dates: [today] })
    .map((r) => ({ ...r, category: r.category ?? categoryForPosition(r.position), visits: r.visits ?? [] }))
    .filter((r) => Boolean(TRACKER_GROUPS[r.category]))

  const people = records.map((r) => {
    const isMerch = r.category === 'merchandiser'
    const shops = getVisitListShops(r.employeeId)
    const visits = r.visits
    const latestVisit = visits[visits.length - 1] ?? null
    const session = sessionById.get(r.employeeId) ?? null
    const live = latestById.get(r.employeeId) ?? null
    const visitSummary = latestVisit
      ? `${VISIT_RESULT[latestVisit.verification?.status ?? latestVisit.status]?.short ?? 'Visit'} at ${outletLabel(latestVisit.outlet)}`
      : null

    const clockedOut = Boolean(r.clockOut) ||
      session?.status === 'closed' ||
      (session?.closes_at && Date.parse(session.closes_at) <= now.getTime())

    if (!r.clockIn || clockedOut) {
      return {
        employeeId: r.employeeId,
        fullName: r.fullName,
        category: r.category,
        duty: clockedOut && r.clockIn ? 'Clocked out — tracking stopped' : dutyText(r),
        onDuty: false,
        visitsToday: isMerch ? null : visits.length,
        lastEvent: visitSummary,
        lastEventAt: r.clockOut ?? latestVisit?.time ?? r.clockIn ?? null,
        shops,
        position: null,
      }
    }

    if (!live || live.session_status !== 'open') {
      return {
        employeeId: r.employeeId,
        fullName: r.fullName,
        category: r.category,
        duty: 'Clocked in — no live location yet',
        onDuty: true,
        visitsToday: isMerch ? null : visits.length,
        lastEvent: visitSummary ?? 'Phone has not sent a location (mobile data, Location or the page may be off)',
        lastEventAt: latestVisit?.time ?? r.clockIn ?? null,
        shops,
        position: fallbackPosition(r, shops),
      }
    }

    const mins = Math.max(0, Math.round((now.getTime() - Date.parse(live.recorded_at)) / 60000))
    const lost = mins > LIVE_STALE_MINUTES
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category: r.category,
      duty: lost ? `Clocked in — signal lost ${mins} min ago` : 'Clocked in — live',
      onDuty: true,
      visitsToday: isMerch ? null : visits.length,
      lastEvent: lost
        ? 'No location for a while (mobile data or Location may be off, or the page closed)'
        : (visitSummary ?? 'Live location'),
      lastEventAt: live.recorded_at,
      shops,
      position: {
        latitude: live.latitude,
        longitude: live.longitude,
        accuracy: live.accuracy ?? null,
        source: 'live',
        at: live.recorded_at,
        place: null,
      },
    }
  }).sort((a, b) => a.fullName.localeCompare(b.fullName))

  const counts = Object.fromEntries(Object.keys(TRACKER_GROUPS).map((c) => [c, { total: 0, placed: 0, onDuty: 0 }]))
  people.forEach((p) => {
    const c = counts[p.category]
    c.total += 1
    if (p.position) c.placed += 1
    if (p.onDuty) c.onDuty += 1
  })
  return { asOf: now.toISOString(), people, counts }
}
