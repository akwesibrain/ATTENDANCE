/**
 * ============================================================================
 * MOCK SHIFT ASSIGNMENT SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * Tracks which shift each employee is assigned to. The ACTIVE assignment drives
 * attendance expectations and the verification window; every change is recorded
 * in an assignment history with an effective start date — previous assignments
 * are preserved, never deleted.
 *
 * An employee can only be assigned to a shift belonging to their own company.
 *
 * Replace these functions with real API calls once the backend contract is
 * defined. Do NOT invent endpoints here.
 * ============================================================================
 */

import { mockGetShift } from './shiftsService'
import { getSessionUser } from './permissionsService'

const ACTIVE_KEY = 'mock-shift-assignments:active'
const HISTORY_KEY = 'mock-shift-assignments:history'

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

/** The active shift assignment for an employee, or null. */
export function mockGetActiveShiftAssignment(employeeId) {
  const active = readJson(ACTIVE_KEY, {})
  return active[employeeId] ?? null
}

/** The active assignment joined with the shift record, or null. */
export function mockGetShiftAssignmentWithShift(employeeId) {
  const assignment = mockGetActiveShiftAssignment(employeeId)
  if (!assignment) return null
  const shift = mockGetShift(assignment.shiftId)
  if (!shift) return null
  return { ...assignment, shift }
}

/** Full shift-assignment history for an employee, newest first. */
export function mockGetShiftAssignmentHistory(employeeId) {
  const history = readJson(HISTORY_KEY, {})
  return (history[employeeId] ?? []).slice().reverse()
}

/**
 * Assign a shift to an employee. Company separation is enforced: the shift must
 * belong to the employee's company. Records the change in history with an
 * effective start date and preserves the previous assignment.
 * @returns {object} { assignment } on success, { error } on failure.
 */
export function mockAssignShift(employeeId, shiftId, { effectiveDate, companyId } = {}) {
  const shift = mockGetShift(shiftId)
  if (!shift) return { error: 'Shift not found.' }
  if (companyId && shift.companyId !== companyId) {
    return { error: 'An employee can only be assigned to a shift in their own company.' }
  }
  const active = readJson(ACTIVE_KEY, {})
  const previous = active[employeeId] ?? null
  const now = new Date().toISOString()
  const assignment = {
    shiftId,
    effectiveDate: effectiveDate ?? now,
    assignedAt: now,
  }
  active[employeeId] = assignment
  writeJson(ACTIVE_KEY, active)

  const history = readJson(HISTORY_KEY, {})
  const list = history[employeeId] ?? []
  list.push({
    shiftId,
    effectiveDate: assignment.effectiveDate,
    assignedAt: now,
    previousShiftId: previous?.shiftId ?? null,
    // Who made the change (demo session), for the audit log.
    assignedBy: getSessionUser()?.name ?? null,
    assignedByRole: getSessionUser()?.role ?? null,
  })
  history[employeeId] = list
  writeJson(HISTORY_KEY, history)
  return { assignment }
}

/**
 * Assign a shift to multiple employees at once (company-specific). Returns a
 * summary of how many were assigned and how many were skipped (wrong company).
 */
export function mockAssignShiftToMany(employeeIds, shiftId, { effectiveDate, companyId } = {}) {
  let assigned = 0
  let skipped = 0
  employeeIds.forEach((employeeId) => {
    const result = mockAssignShift(employeeId, shiftId, { effectiveDate, companyId })
    if (result.error) skipped += 1
    else assigned += 1
  })
  return { assigned, skipped }
}
