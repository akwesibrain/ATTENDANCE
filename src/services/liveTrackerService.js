/**
 * Live Field Tracker — where Supervisors, Sales Representatives and
 * Merchandisers were last recorded today.
 *
 * Positions are never invented. A person is placed on the map only from a
 * recorded position:
 *   Supervisors / Sales Reps  the phone's GPS at their latest outlet visit
 *                             ("gps"); if that visit had no GPS but the outlet
 *                             has saved coordinates, the outlet's location
 *                             ("outlet").
 *   Merchandisers             their allocated shop ("shop"), with the result of
 *                             their latest verification check.
 * Everyone else is listed as "no position yet". Between recorded events the
 * real position is unknown — this is not continuous tracking.
 */

import { listAttendanceRecords } from './attendanceRecordsService'
import { FIELD_STATE, mockGetLiveFieldBoard } from './salesMonitoringService'
import { VISIT_RESULT, outletLabel } from './fieldVisitsService'
import { mockGetShop } from './shopsService'
import { accraTodayKey } from '../utils/accraTime'

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
      const s = mockGetShop(v.outlet.shopId)
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
export function getLiveTracker(companyId, now = new Date()) {
  const today = accraTodayKey()
  const records = listAttendanceRecords({ companyId, dates: [today] })
  const people = records
    .filter((r) => r.category === 'supervisor' || r.category === 'sales-rep')
    .map(visitPerson)

  const board = mockGetLiveFieldBoard(companyId)
  board.reps.forEach((rep) => {
    const shop = rep.shop
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
