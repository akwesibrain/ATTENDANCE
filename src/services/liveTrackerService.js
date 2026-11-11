/**
 * Live Field Tracker — where Supervisors, Sales Representatives and
 * Merchandisers were last recorded today.
 *
 * Positions are never invented. Supervisors, Sales Reps and Merchandisers who
 * use the attendance app are tracked LIVE from their phone between clock-in
 * and clock-out ("live", see locationTrackingService); tracking stops at
 * clock-out and they leave the map. Until a live location arrives they are
 * shown at a recorded position, flagged:
 *   Supervisors / Sales Reps  the phone's GPS at their latest outlet visit
 *                             ("gps"), or the visited outlet ("outlet").
 *   Merchandisers             their allocated shop ("shop").
 * Demo staff without the app keep those recorded positions (demo
 * merchandisers also show their latest verification check).
 * Anyone else is listed as "no position yet".
 */

import { listAttendanceRecords } from './attendanceRecordsService'
import { FIELD_STATE, getLiveFieldBoard } from './salesMonitoringService'
import { VISIT_RESULT, outletLabel } from './fieldVisitsService'
import { getShop } from './shopsService'
import { accraTodayKey } from '../utils/accraTime'
import { LIVE_STALE_MINUTES, latestLocation, trackingStatus } from './locationTrackingService'

/** Marker colours (the map also shows a letter badge, so colour is not the only cue). */
export const TRACKER_GROUPS = {
  supervisor: { label: 'Supervisors', single: 'Supervisor', color: '#15803d' },
  'sales-rep': { label: 'Sales Reps', single: 'Sales Rep', color: '#dc2626' },
  merchandiser: { label: 'Merchandisers', single: 'Merchandiser', color: '#111827' },
}

const MERCH_ON_DUTY = new Set(['inside', 'outside', 'face-failed', 'location-unknown', 'no-response', 'awaiting-check'])

export const POSITION_SOURCE = {
  gps: 'Phone GPS at last outlet visit',
  outlet: 'Outlet location (visit had no GPS)',
  live: 'Live phone location',
  shop: 'Allocated shop',
}

function dutyText(r) {
  if (r.status === 'on-leave') return 'On leave'
  if (r.atWork) return 'On duty'
  if (r.clockOut) return 'Clocked out'
  if (r.status === 'absent') return 'Absent'
  if (r.status === 'incomplete') return 'No clock-out'
  if (!r.workday) return 'Not scheduled'
  return 'Not clocked in'
}

function visitPerson(r) {
  // Newest visit first: the latest one with GPS, and the latest at a mapped outlet.
  let withGps = null
  let atOutlet = null
  let shop = null
  for (let i = r.visits.length - 1; i >= 0 && !(withGps && atOutlet); i -= 1) {
    const v = r.visits[i]
    if (!withGps && v.location && Number.isFinite(v.location.latitude)) withGps = v
    if (!atOutlet && v.outlet?.shopId) {
      const s = getShop(v.outlet.shopId)
      if (s && s.latitude != null) { atOutlet = v; shop = s }
    }
  }
  const latest = r.visits[r.visits.length - 1] ?? null
  let position = null
  if (withGps && (!atOutlet || withGps.time >= atOutlet.time)) {
    position = { latitude: withGps.location.latitude, longitude: withGps.location.longitude, accuracy: withGps.location.accuracy ?? null, source: 'gps', at: withGps.time, place: outletLabel(withGps.outlet) }
  } else if (atOutlet) {
    position = { latitude: shop.latitude, longitude: shop.longitude, accuracy: null, source: 'outlet', at: atOutlet.time, place: shop.shopName }
  }
  return {
    employeeId: r.employeeId,
    fullName: r.fullName,
    category: r.category,
    duty: dutyText(r),
    onDuty: Boolean(r.atWork),
    visitsToday: r.visits.length,
    lastEvent: latest ? `${VISIT_RESULT[latest.verification?.status]?.short ?? 'Visit'} at ${outletLabel(latest.outlet)}` : r.clockIn ? 'Clocked in, no visits yet' : null,
    lastEventAt: latest?.time ?? r.clockIn ?? null,
    position,
  }
}

/**
 * @returns {{ asOf, people: object[], counts: object }}
 *   counts[category] = { total, placed, onDuty }
 */
/**
 * Live tracking for anyone who uses the attendance app (Supervisors, Sales
 * Reps, Merchandisers): placed by their phone's latest location between
 * clock-in and clock-out, and taken off the map after clock-out. If no live
 * location has arrived yet, `fallback` (latest visit or allocated shop) is
 * shown and flagged.
 */
function withLiveTracking(person, fallback, tracked, now) {
  if (!tracked.active) {
    const duty = { 'clocked-out': 'Clocked out — tracking stopped', 'not-clocked-in': 'Not clocked in', absent: 'Marked absent' }[tracked.reason] ?? person.duty
    return { ...person, duty, onDuty: false, position: null }
  }
  const live = latestLocation(person.employeeId)
  if (!live) {
    return {
      ...person,
      duty: 'Clocked in — no live location yet',
      onDuty: true,
      lastEvent: 'Phone has not sent a location (mobile data, Location or the page may be off)',
      position: fallback,
    }
  }
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(live.at)) / 60000))
  const lost = mins > LIVE_STALE_MINUTES
  return {
    ...person,
    duty: lost ? `Clocked in — signal lost ${mins} min ago` : 'Clocked in — live',
    onDuty: true,
    lastEvent: lost ? 'No location for a while (mobile data or Location may be off, or the page closed)' : person.lastEvent ?? 'Live location',
    lastEventAt: live.at,
    position: { latitude: live.latitude, longitude: live.longitude, accuracy: live.accuracy, source: 'live', at: live.at, place: null },
  }
}

export function getLiveTracker(companyId, now = new Date()) {
  const today = accraTodayKey()
  const records = listAttendanceRecords({ companyId, dates: [today] })
  const people = records
    .filter((r) => r.category === 'supervisor' || r.category === 'sales-rep')
    .map((r) => {
      const person = visitPerson(r)
      const tracked = trackingStatus(r.employeeId)
      return tracked.reason === 'not-found' ? person : withLiveTracking(person, person.position, tracked, now)
    })

  const board = getLiveFieldBoard(companyId)
  board.reps.forEach((rep) => {
    const shop = rep.shop
    const tracked = trackingStatus(rep.employeeId)
    if (tracked.reason !== 'not-found') {
      const person = { employeeId: rep.employeeId, fullName: rep.fullName, category: 'merchandiser', duty: '—', onDuty: false, visitsToday: null, lastEvent: null, lastEventAt: null, position: null }
      const atShop = shop && shop.latitude != null
        ? { latitude: shop.latitude, longitude: shop.longitude, accuracy: null, source: 'shop', at: null, place: shop.shopName }
        : null
      people.push(withLiveTracking(person, atShop, tracked, now))
      return
    }
    people.push({
      employeeId: rep.employeeId,
      fullName: rep.fullName,
      category: 'merchandiser',
      duty: FIELD_STATE[rep.state]?.short ?? '—',
      onDuty: MERCH_ON_DUTY.has(rep.state),
      visitsToday: null,
      lastEvent: rep.lastCheck ? `Last check: ${FIELD_STATE[rep.state]?.short ?? ''}` : null,
      lastEventAt: rep.lastCheckAt ?? rep.checkInTime ?? null,
      position: shop && shop.latitude != null
        ? { latitude: shop.latitude, longitude: shop.longitude, accuracy: null, source: 'shop', at: rep.lastCheckAt ?? null, place: shop.shopName }
        : null,
    })
  })

  const counts = Object.fromEntries(Object.keys(TRACKER_GROUPS).map((c) => [c, { total: 0, placed: 0, onDuty: 0 }]))
  people.forEach((p) => {
    const c = counts[p.category]
    c.total += 1
    if (p.position) c.placed += 1
    if (p.onDuty) c.onDuty += 1
  })
  return { asOf: now.toISOString(), people, counts }
}
