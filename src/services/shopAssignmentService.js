/**
 * ============================================================================
 * MOCK SHOP ASSIGNMENT SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * Tracks which shop a field employee (Sales Representative or Merchandiser) is
 * assigned to. The ACTIVE assignment is the employee's official workplace; every
 * change is recorded in an assignment history with an effective date — previous
 * assignments are preserved, never deleted.
 *
 * The employee record stores only the active shop ID. Shop details (name,
 * address, coordinates, geofence) are read from the shops service, which is the
 * source of truth.
 *
 * Replace these functions with real API calls once the backend contract is
 * defined. Do NOT invent endpoints here.
 * ============================================================================
 */

import { mockGetShop } from './shopsService'
import { getSessionUser } from './permissionsService'

const ASSIGNMENTS_KEY = 'mock-shop-assignments:active'
const HISTORY_KEY = 'mock-shop-assignments:history'

function readJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore — mock persistence only.
  }
}

/** Positions that require a sales shop assignment. */
export const FIELD_POSITIONS = ['sales representative', 'merchandiser']

/** Whether a job position requires an assigned shop. */
export function requiresShop(position) {
  const p = (position ?? '').trim().toLowerCase()
  return FIELD_POSITIONS.includes(p)
}

/**
 * The active assignment for an employee, or null if none.
 * @returns {{ shopId: string, effectiveDate: string, status: string } | null}
 */
export function mockGetActiveAssignment(employeeId) {
  const active = readJson(ASSIGNMENTS_KEY, {})
  return active[employeeId] ?? null
}

/**
 * The active assignment joined with the shop record (source of truth).
 * Returns null when there is no assignment.
 */
export function mockGetAssignmentWithShop(employeeId) {
  const assignment = mockGetActiveAssignment(employeeId)
  if (!assignment) return null
  const shop = mockGetShop(assignment.shopId)
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

/** Full assignment history for an employee, newest first. */
export function mockGetAssignmentHistory(employeeId) {
  const history = readJson(HISTORY_KEY, {})
  return (history[employeeId] ?? []).slice().reverse()
}

/**
 * Assign (or reassign) a shop to an employee. Records the change in history
 * with an effective date and preserves the previous assignment.
 * @returns {object|null} the new active assignment, or null on bad input.
 */
export function mockAssignShop(employeeId, shopId, { effectiveDate } = {}) {
  const shop = mockGetShop(shopId)
  if (!shop) return null
  const active = readJson(ASSIGNMENTS_KEY, {})
  const previous = active[employeeId] ?? null
  const now = new Date().toISOString()
  const assignment = {
    shopId,
    effectiveDate: effectiveDate ?? now,
    status: 'active',
    assignedAt: now,
  }
  active[employeeId] = assignment
  writeJson(ASSIGNMENTS_KEY, active)

  const history = readJson(HISTORY_KEY, {})
  const list = history[employeeId] ?? []
  list.push({
    shopId,
    effectiveDate: assignment.effectiveDate,
    assignedAt: now,
    previousShopId: previous?.shopId ?? null,
    // Who made the change (demo session; empty for employee self-registration).
    assignedBy: getSessionUser()?.name ?? null,
    assignedByRole: getSessionUser()?.role ?? null,
  })
  history[employeeId] = list
  writeJson(HISTORY_KEY, history)
  return assignment
}
