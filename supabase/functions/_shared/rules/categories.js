/**
 * Employee categories, from the job position. Shared by the browser and the
 * server, and kept identical to the frontend's src/constants/employeeCategories.js.
 *
 * Supervisors, Sales Representatives and Merchandisers work in the field: each
 * has a list of 1 to MAX_SHOPS shops, and is tracked between clock-in and
 * clock-out.
 */

/** Field categories: each has a shop list and is tracked on duty. */
export const TRACKED_CATEGORIES = ['supervisor', 'sales-rep', 'merchandiser']

/** Most shops on one employee's list. */
export const MAX_SHOPS = 7

const FIELD_SUPERVISOR_TITLES = ['supervisor', 'field supervisor', 'sales supervisor']

/** Category for a job position. */
export function categoryForPosition(position) {
  const p = String(position ?? '').trim().toLowerCase()
  if (p === 'merchandiser' || p.startsWith('merchandiser')) return 'merchandiser'
  if (p === 'sales representative' || p === 'sales rep') return 'sales-rep'
  if (FIELD_SUPERVISOR_TITLES.includes(p)) return 'supervisor'
  if (p.includes('warehouse')) return 'warehouse'
  return 'office'
}

/** Whether the position needs a list of shops. */
export function needsShopList(position) {
  return TRACKED_CATEGORIES.includes(categoryForPosition(position))
}

/** The three field supervisor titles HR may give (never self-assigned). */
export function isFieldSupervisor(position) {
  return FIELD_SUPERVISOR_TITLES.includes(String(position ?? '').trim().toLowerCase())
}
