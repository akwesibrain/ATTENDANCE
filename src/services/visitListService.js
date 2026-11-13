/**
 * Daily shop lists for Sales Representatives, Supervisors, and Merchandisers,
 * backed by `public.employee_shops` and `PUT /hr/employees/:staffId/visit-list`.
 *
 * Company rule ("distance only, HR decides"): there is no pass/fail geofence
 * radius. A listed shop's visit is PROVEN when live tracking shows the person
 * stayed near it for at least MIN_STAY_MINUTES (within GPS_TOLERANCE_M, an
 * allowance for GPS error).
 */

import {
  MIN_STAY_MINUTES,
  shopStays,
  visitProof as sharedVisitProof,
} from '../../supabase/functions/_shared/rules/tracking.js'
import { submit } from './backend/client'
import { refresh, rows } from './backend/cache'
import { getShop } from './shopsService'

export { MIN_STAY_MINUTES, shopStays }

const AFTER_SAVE = ['employee_shops', 'employee_shop_changes', 'employees', 'shop_assignments', 'audit_events']

/** The shop IDs on an employee's daily visit list, ordered by position. */
export function getVisitList(employeeId) {
  const id = String(employeeId ?? '').trim().toUpperCase()
  if (!id) return []
  const list = rows('employee_shops')
    .filter((row) => String(row.staff_id).toUpperCase() === id)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.shop_id)
  if (list.length) return list.filter((shopId) => getShop(shopId))

  // Fallback for legacy single-shop rows if employee_shops has none.
  const emp = rows('employees').find((row) => String(row.staff_id).toUpperCase() === id)
  return emp?.assigned_shop_id && getShop(emp.assigned_shop_id) ? [emp.assigned_shop_id] : []
}

/** Shops on the list, with their details. */
export function getVisitListShops(employeeId) {
  return getVisitList(employeeId).map((id) => getShop(id)).filter(Boolean)
}

/** Change history for an employee's list, newest first. */
export function getVisitListHistory(employeeId) {
  const id = String(employeeId ?? '').trim().toUpperCase()
  return rows('employee_shop_changes')
    .filter((h) => String(h.staff_id).toUpperCase() === id)
    .slice()
    .reverse()
    .map((h) => ({
      employeeId: h.staff_id,
      at: h.at,
      by: h.by_name,
      previous: h.previous,
      next: h.next,
    }))
}

/**
 * HR saves an employee's daily visit list on the server.
 * @returns {Promise<{ shopIds: string[] } | { error: string, errors?: object }>}
 */
export async function saveVisitList({ employeeId, shopIds }) {
  const result = await submit(`/hr/employees/${encodeURIComponent(employeeId)}/visit-list`, {
    method: 'PUT',
    body: { shopIds },
  })
  if (result.error || result.errors) return result
  await refresh(...AFTER_SAVE)
  return result
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
 * The day's visits for one employee against their list, enriched with local shop objects.
 */
export function visitProof({ listIds, visits, stays, dayOver }) {
  const shopsById = new Map()
  listIds.forEach((id) => {
    const sh = getShop(id)
    if (sh) shopsById.set(id, sh)
  })
  const base = sharedVisitProof({ listIds, shopsById, visits, stays, dayOver })
  return {
    ...base,
    listed: base.listed.map((l) => ({
      ...l,
      shop: shopsById.get(l.shopId) ?? null,
      closest: l.closestM ?? null,
    })),
  }
}
