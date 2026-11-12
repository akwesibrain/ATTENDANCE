/**
 * ============================================================================
 * DAILY SHOP LISTS — Sales Representatives and Supervisors
 * ============================================================================
 * Each person has a fixed list of 1 to MAX_SHOPS shops to visit every working
 * day, set by HR. There is NO pass/fail radius (company decision,
 * 11 Nov 2026 — "distance only, HR decides"): HR sees how far people were.
 *
 * A listed shop's visit is PROVEN when live tracking shows the person stayed
 * near it for at least MIN_STAY_MINUTES — "near" meaning within
 * GPS_TOLERANCE_M, an allowance for GPS error only. A recorded visit without
 * such a stay is flagged for HR, as are missed shops, visits to shops not on
 * the list and typed-in outlets. A flag is never automatic misconduct.
 *
 * FRONTEND-ONLY for now: lists are kept in this browser until the backend
 * provides GET/PUT /employees/:staffId/visit-list
 * (docs/backend-multi-shop-and-places.md).
 * ============================================================================
 */

import { readJson, writeJson } from '../utils/localStore'
import { getShop } from './shopsService'
import { GPS_TOLERANCE_M, distanceMeters } from '../utils/distance'
import { visitDistance } from './fieldVisitsService'

const LISTS_KEY = 'mock-visit-lists:v1'
const HISTORY_KEY = 'mock-visit-lists:history'

/** Minimum stay near a shop, on live tracking, for a visit to count as proven. */
export const MIN_STAY_MINUTES = 10
/** A gap in live points longer than this breaks a stay. */
const STAY_GAP_MINUTES = 5

/** The shop IDs on an employee's daily visit list (only shops that still exist). */
export function getVisitList(employeeId) {
  const list = readJson(LISTS_KEY, {})[String(employeeId).toUpperCase()]?.shopIds ?? []
  return list.filter((id) => getShop(id))
}

/** Shops on the list, with their details. */
export function getVisitListShops(employeeId) {
  return getVisitList(employeeId).map((id) => getShop(id))
}

/** Change history for an employee's list, newest first. */
export function getVisitListHistory(employeeId) {
  return readJson(HISTORY_KEY, []).filter((h) => h.employeeId === String(employeeId).toUpperCase()).reverse()
}

/**
 * HR saves an employee's daily visit list (kept in this browser for now).
 * Shops must belong to the employee's company.
 */
export function mockSaveVisitList({ employeeId, companyId, shopIds }, user) {
  const id = String(employeeId).toUpperCase()
  const unique = [...new Set(shopIds)]
  const bad = unique.find((sid) => getShop(sid)?.companyId !== companyId)
  if (bad) return { error: 'Choose shops that belong to this employee’s company.' }
  const all = readJson(LISTS_KEY, {})
  const previous = all[id]?.shopIds ?? []
  const at = new Date().toISOString()
  all[id] = { shopIds: unique, updatedAt: at, updatedBy: user?.name ?? 'Unknown' }
  writeJson(LISTS_KEY, all)
  const history = readJson(HISTORY_KEY, [])
  history.push({ employeeId: id, at, by: user?.name ?? 'Unknown', previous, next: unique })
  writeJson(HISTORY_KEY, history)
  return { shopIds: unique }
}

/**
 * How long live tracking shows a person near each shop.
 * A stay is a run of consecutive points within GPS_TOLERANCE_M of the shop
 * with no gap longer than STAY_GAP_MINUTES; its length is first-to-last point.
 * Also records the closest the person came to the shop.
 * @returns {{ [shopId]: { minutes, longestMinutes, closest } }}
 */
export function shopStays(points, shops) {
  const out = {}
  shops.forEach((shop) => {
    if (!shop || shop.latitude == null || shop.longitude == null) return
    let total = 0
    let longest = 0
    let closest = null
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
      const d = distanceMeters(p, shop)
      if (d != null && (closest == null || d < closest)) closest = d
      if (d == null || d > GPS_TOLERANCE_M) { close(); return }
      if (runLast != null && t - runLast > STAY_GAP_MINUTES * 60000) close()
      if (runStart == null) runStart = t
      runLast = t
    })
    close()
    out[shop.shopId] = { minutes: Math.round(total / 60000), longestMinutes: Math.round(longest / 60000), closest }
  })
  return out
}

/** Result for a shop on the list. `tone` drives the badge colour. */
export const SHOP_RESULT = {
  proven: { label: `Live tracking shows a stay of ${MIN_STAY_MINUTES}+ minutes at the shop`, short: `Stayed ${MIN_STAY_MINUTES}+ min`, tone: 'ok' },
  'no-stay': { label: `A visit was recorded, but live tracking does not show a ${MIN_STAY_MINUTES}-minute stay`, short: 'Visited, no stay shown', tone: 'warn' },
  unmeasured: { label: 'A visit was recorded; the shop has no map location, so the stay cannot be measured', short: 'Visited (no map location)', tone: 'pending' },
  pending: { label: 'Not visited yet today', short: 'Not yet', tone: 'pending' },
  missed: { label: 'Not visited by the end of the working day', short: 'Missed', tone: 'crit' },
}

/** Result for a visit to a shop that is not on the list. */
export const OFF_LIST = {
  'off-list': { label: 'Shop not on the daily list', short: 'Not on list', tone: 'warn' },
  'not-in-list': { label: 'Typed-in outlet that is not in the shop list', short: 'Typed in', tone: 'warn' },
}

/**
 * The day's visits for one employee against their list.
 * @param {object} p
 * @param {string[]} p.listIds   shop IDs on the daily list
 * @param {object[]} p.visits    the day's visit events (outlet, time, location)
 * @param {object|null} p.stays  shopStays() result, or null when there is no live tracking
 * @param {boolean} p.dayOver    the working day has ended (missing visits become "missed")
 */
export function visitProof({ listIds, visits, stays, dayOver }) {
  const listed = listIds.map((shopId) => {
    const shop = getShop(shopId)
    const scans = visits.filter((v) => v.outlet?.shopId === shopId).sort((a, b) => a.time.localeCompare(b.time))
    const stay = stays?.[shopId] ?? null
    const stayed = (stay?.longestMinutes ?? 0) >= MIN_STAY_MINUTES
    const measurable = shop?.latitude != null
    let status
    if (stayed) status = 'proven'
    else if (scans.length) status = measurable ? 'no-stay' : 'unmeasured'
    else status = dayOver ? 'missed' : 'pending'
    const distances = scans.map(visitDistance).filter((d) => d != null)
    return {
      shopId,
      shop,
      status,
      first: scans[0] ?? null,
      scans: scans.length,
      scanned: scans.length > 0,
      visitDistance: distances.length ? Math.min(...distances) : null,
      stayMinutes: stay ? stay.longestMinutes : null,
      closest: stay?.closest ?? null,
    }
  })
  const listSet = new Set(listIds)
  const offList = visits
    .filter((v) => !v.outlet?.shopId || !listSet.has(v.outlet.shopId))
    .map((v) => ({ visit: v, status: v.outlet?.shopId ? 'off-list' : 'not-in-list', distance: visitDistance(v) }))
  const count = (s) => listed.filter((l) => l.status === s).length
  return {
    listed,
    offList,
    counts: {
      listed: listed.length,
      proven: count('proven'),
      visited: listed.filter((l) => l.scanned || l.status === 'proven').length,
      missed: count('missed'),
      flagged: count('no-stay') + count('missed') + offList.length,
    },
  }
}
