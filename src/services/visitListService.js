/**
 * ============================================================================
 * MOCK VISIT LIST SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * Sales Representatives and Supervisors have a fixed list of shops they must
 * visit every working day (set by HR). A visit to a listed shop is PROVEN only
 * when BOTH are true:
 *   1. a face-scan visit was recorded at that shop with the phone inside the
 *      shop's geofence (150 m), and
 *   2. live tracking shows the person stayed within the geofence for at least
 *      MIN_STAY_MINUTES without a break in the signal longer than
 *      LIVE_STALE_MINUTES.
 * Anything less is flagged for HR (never automatically treated as misconduct).
 *
 * Visits to shops that are not on the list are recorded and flagged; outlets
 * typed in by the employee have no saved location and can never be proven.
 * ============================================================================
 */

import { readJson, writeJson } from './mockStore'
import { recordAuditEvent } from './auditStore'
import { GEOFENCE_RADIUS_M, mockGetShop } from './shopsService'

const LISTS_KEY = 'mock-visit-lists:v1'
const HISTORY_KEY = 'mock-visit-lists:history'

/** Minimum continuous stay near a shop for a visit to count as proven. */
export const MIN_STAY_MINUTES = 10
/** A gap in live points longer than this breaks a stay. */
const STAY_GAP_MINUTES = 5

/** The shop IDs on an employee's daily visit list (only shops that still exist). */
export function getVisitList(employeeId) {
  const list = readJson(LISTS_KEY, {})[String(employeeId).toUpperCase()]?.shopIds ?? []
  return list.filter((id) => mockGetShop(id))
}

/** Shops on the list, with their details. */
export function getVisitListShops(employeeId) {
  return getVisitList(employeeId).map((id) => mockGetShop(id))
}

/** Change history for an employee's list, newest first. */
export function getVisitListHistory(employeeId) {
  return readJson(HISTORY_KEY, []).filter((h) => h.employeeId === String(employeeId).toUpperCase()).reverse()
}

/**
 * MOCK ONLY — HR saves an employee's daily visit list.
 * Shops must belong to the employee's company.
 */
export function mockSaveVisitList({ employeeId, fullName, companyId, shopIds }, user) {
  const id = String(employeeId).toUpperCase()
  const unique = [...new Set(shopIds)]
  const bad = unique.find((sid) => mockGetShop(sid)?.companyId !== companyId)
  if (bad) return { error: 'Choose shops that belong to this employee’s company.' }
  const all = readJson(LISTS_KEY, {})
  const previous = all[id]?.shopIds ?? []
  const at = new Date().toISOString()
  all[id] = { shopIds: unique, updatedAt: at, updatedBy: user?.name ?? 'Unknown' }
  writeJson(LISTS_KEY, all)
  const history = readJson(HISTORY_KEY, [])
  history.push({ employeeId: id, at, by: user?.name ?? 'Unknown', previous, next: unique })
  writeJson(HISTORY_KEY, history)
  const names = (ids) => ids.map((sid) => mockGetShop(sid)?.shopName ?? sid).join(', ') || 'none'
  recordAuditEvent({
    action: 'Daily shop list changed',
    category: 'Shops',
    source: 'Field Monitoring',
    actor: { name: user?.name, role: user?.role },
    companyIds: [companyId],
    affected: `${fullName ?? id} (${id})`,
    description: `${unique.length} shop${unique.length === 1 ? '' : 's'} to visit every working day.`,
    previous: names(previous),
    next: names(unique),
  })
  return { shopIds: unique }
}

function distanceMeters(a, b) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * How long live tracking shows a person near each shop.
 * A stay is a run of consecutive points inside the shop's geofence with no
 * gap longer than STAY_GAP_MINUTES; its length is first-to-last point.
 * @returns {{ [shopId]: { minutes: number, longestMinutes: number } }}
 */
export function shopStays(points, shops) {
  const out = {}
  shops.forEach((shop) => {
    if (!shop || shop.latitude == null || shop.longitude == null) return
    const radius = shop.geofenceRadius ?? GEOFENCE_RADIUS_M
    let total = 0
    let longest = 0
    let runStart = null
    let runLast = null
    const close = () => {
      if (runStart != null) {
        const len = runLast - runStart
        total += len
        longest = Math.max(longest, len)
      }
      runStart = null
      runLast = null
    }
    points.forEach((p) => {
      const t = Date.parse(p.at)
      const inside = distanceMeters(p, shop) <= radius
      if (!inside) { close(); return }
      if (runLast != null && t - runLast > STAY_GAP_MINUTES * 60000) close()
      if (runStart == null) runStart = t
      runLast = t
    })
    close()
    out[shop.shopId] = { minutes: Math.round(total / 60000), longestMinutes: Math.round(longest / 60000) }
  })
  return out
}

/** Per-shop result for a listed shop. `tone` drives the badge colour. */
export const SHOP_PROOF = {
  proven: { label: 'Visit proven', short: 'Proven', tone: 'ok' },
  'no-stay': { label: `Scanned, but live tracking does not show a ${MIN_STAY_MINUTES}-minute stay`, short: 'No stay shown', tone: 'crit' },
  outside: { label: 'Scanned outside the shop area', short: 'Scanned outside', tone: 'crit' },
  'no-location': { label: 'Scanned without a phone location', short: 'No location', tone: 'warn' },
  'stay-no-scan': { label: 'Live tracking shows a stay, but no visit was scanned', short: 'Stayed, no scan', tone: 'warn' },
  missed: { label: 'Not visited', short: 'Missed', tone: 'crit' },
  pending: { label: 'Not visited yet today', short: 'Not yet', tone: 'pending' },
  'no-shop-location': { label: 'The shop has no saved location, so the visit cannot be proven', short: 'Shop has no location', tone: 'pending' },
}

/** Result for a visit to a shop that is not on the list. */
export const OFF_LIST = {
  'off-list': { label: 'Shop not on the daily list', short: 'Not on list', tone: 'warn' },
  'cannot-verify': { label: 'Typed-in outlet with no saved location — cannot be verified', short: 'Cannot be verified', tone: 'warn' },
}

const RANK = { inside: 3, outside: 2, unverified: 1, 'location-unavailable': 0 }

/**
 * Proof of the day's visits for one employee.
 * @param {object} p
 * @param {string[]} p.listIds   shop IDs on the daily list
 * @param {object[]} p.visits    the day's visit events (outlet, verification, time)
 * @param {object|null} p.stays  shopStays() result, or null when there is no live tracking data
 * @param {boolean} p.dayOver    the working day has ended (missing visits become "missed")
 */
export function visitProof({ listIds, visits, stays, dayOver }) {
  const listed = listIds.map((shopId) => {
    const shop = mockGetShop(shopId)
    const scans = visits.filter((v) => v.outlet?.shopId === shopId)
    // The best scan at this shop: inside beats outside beats no location.
    const scan = scans.slice().sort((a, b) => (RANK[b.verification?.status] ?? 0) - (RANK[a.verification?.status] ?? 0))[0] ?? null
    const stay = stays?.[shopId] ?? null
    const stayed = (stay?.longestMinutes ?? 0) >= MIN_STAY_MINUTES
    let status
    if (!shop || shop.latitude == null) status = 'no-shop-location'
    else if (scan?.verification?.status === 'inside') status = stayed ? 'proven' : 'no-stay'
    else if (scan?.verification?.status === 'outside') status = 'outside'
    else if (scan) status = 'no-location'
    else if (stayed) status = 'stay-no-scan'
    else status = dayOver ? 'missed' : 'pending'
    return { shopId, shop, status, scan, scans: scans.length, stayMinutes: stay?.longestMinutes ?? null }
  })
  const listSet = new Set(listIds)
  const offList = visits
    .filter((v) => !v.outlet?.shopId || !listSet.has(v.outlet.shopId))
    .map((v) => ({ visit: v, status: v.outlet?.shopId ? 'off-list' : 'cannot-verify' }))
  const proven = listed.filter((l) => l.status === 'proven').length
  const flagged = listed.filter((l) => SHOP_PROOF[l.status].tone === 'crit' || SHOP_PROOF[l.status].tone === 'warn').length + offList.length
  return { listed, offList, counts: { listed: listed.length, proven, flagged, missed: listed.filter((l) => l.status === 'missed').length } }
}
