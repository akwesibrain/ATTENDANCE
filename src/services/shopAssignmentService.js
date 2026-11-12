/** Which shop each field employee works from, with the history of changes. */

import { submit } from './backend/client'
import { refresh, rows } from './backend/cache'
import { getShop } from './shopsService'

export { FIELD_POSITIONS } from '../../supabase/functions/_shared/rules/registration.js'
/** Whether a position works from shops: the same rule the server uses for shop lists. */
export { needsShopList as requiresShop } from '../../supabase/functions/_shared/rules/categories.js'

function fromRow(row) {
  return {
    shopId: row.shop_id,
    effectiveDate: row.effective_date,
    status: row.active ? 'active' : 'ended',
    assignedAt: row.assigned_at,
    previousShopId: row.previous_shop_id,
    assignedBy: row.assigned_by,
    assignedByRole: row.assigned_by_role,
  }
}

export function getActiveAssignment(employeeId) {
  const row = rows('shop_assignments').find((r) => r.employee_id === employeeId && r.active)
  return row ? fromRow(row) : null
}

export function getAssignmentWithShop(employeeId) {
  const assignment = getActiveAssignment(employeeId)
  const shop = assignment && getShop(assignment.shopId)
  if (!shop) return null
  return {
    ...assignment,
    shopName: shop.shopName,
    address: shop.addressLine,
    latitude: shop.latitude,
    longitude: shop.longitude,
    geofenceRadius: shop.geofenceRadius,
    companyId: shop.companyId,
  }
}

/** Newest first. */
export function getAssignmentHistory(employeeId) {
  return rows('shop_assignments')
    .filter((r) => r.employee_id === employeeId)
    .map(fromRow)
    .sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)))
}

/** @returns {Promise<{ ok: true } | { error: string }>} */
export async function assignShop(employeeId, shopId) {
  const result = await submit(`/hr/employees/${encodeURIComponent(employeeId)}/shop`, { method: 'POST', body: { shopId } })
  if (result.errors) return result
  await refresh('employees', 'shop_assignments', 'audit_events', 'notifications', 'notification_history')
  return result
}
