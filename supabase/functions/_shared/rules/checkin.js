/**
 * What an employee may do at the attendance kiosk right now.
 * One check-in and one check-out per day, inside the time windows.
 */

import { evaluateAction } from './policy.js'

/** After this many failed face scans in a day, the employee is marked absent. */
export const MAX_FACE_ATTEMPTS = 5

const STAFF_ID_PATTERN = /^[A-Z]{2,5}-\d{1,8}$/

/** @returns {string|null} the Staff ID in its stored form, or null if malformed. */
export function normalizeStaffId(value) {
  const staffId = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return STAFF_ID_PATTERN.test(staffId) ? staffId : null
}

/** @returns {'check-in'|'check-out'|null} */
export function nextAttendanceAction(eventTypes) {
  if (eventTypes.includes('absent')) return null
  if (!eventTypes.includes('check-in')) return 'check-in'
  if (!eventTypes.includes('check-out')) return 'check-out'
  return null
}

/**
 * Decide the next action, and why it is refused if it is.
 * Runs before the face scan, so a refused action never costs an attempt.
 * @returns {{ nextAction: string|null, windowStatus: string|null, blockedReason: string|null }}
 */
export function attendanceGate({ fullName, status, eventTypes, now = new Date() }) {
  if (status !== 'ACTIVE') {
    return { nextAction: null, windowStatus: null, blockedReason: 'This Staff ID is not active. Please contact HR.' }
  }
  if (eventTypes.includes('absent')) {
    return {
      nextAction: null,
      windowStatus: null,
      blockedReason: `${fullName} has been marked ABSENT for today after too many failed face-verification attempts. Please contact HR.`,
    }
  }
  const nextAction = nextAttendanceAction(eventTypes)
  if (nextAction === null) {
    return { nextAction: null, windowStatus: null, blockedReason: 'You have already completed check-in and check-out for today.' }
  }
  const window = evaluateAction(nextAction, now)
  if (!window.allowed) return { nextAction, windowStatus: null, blockedReason: window.message }
  return { nextAction, windowStatus: window.status, blockedReason: null }
}
