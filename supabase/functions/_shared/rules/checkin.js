/**
 * What an employee may do at the attendance kiosk right now.
 * One check-in and one check-out per day, inside the windows set in Settings.
 */

import { evaluateAction } from './policy.js'

/**
 * After this many failed face scans in a day, the Staff ID is locked at the
 * kiosk until the next day and HR is alerted. Nobody is marked absent by it:
 * anyone can type a Staff ID, so a lockout proves nothing about the employee.
 */
export const MAX_FACE_ATTEMPTS = 5

/** The event recorded when the limit is reached. */
export const FACE_LOCKOUT = 'face-lockout'

const STAFF_ID_PATTERN = /^[A-Z]{2,5}-\d{1,8}$/

/** @returns {string|null} the Staff ID in its stored form, or null if malformed. */
export function normalizeStaffId(value) {
  const staffId = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return STAFF_ID_PATTERN.test(staffId) ? staffId : null
}

/** @returns {'check-in'|'check-out'|null} */
export function nextAttendanceAction(eventTypes) {
  if (eventTypes.includes(FACE_LOCKOUT)) return null
  if (!eventTypes.includes('check-in')) return 'check-in'
  if (!eventTypes.includes('check-out')) return 'check-out'
  return null
}

/**
 * Decide the next action, and why it is refused if it is.
 * Runs before the face scan, so a refused action never costs an attempt.
 * @returns {{ nextAction: string|null, windowStatus: string|null, blockedReason: string|null }}
 */
export function attendanceGate({ fullName, status, eventTypes, now = new Date(), holiday = false, hours, rules }) {
  if (status !== 'ACTIVE') {
    return { nextAction: null, windowStatus: null, blockedReason: 'This Staff ID is not active. Please contact HR.' }
  }
  if (eventTypes.includes(FACE_LOCKOUT)) {
    return { nextAction: null, windowStatus: null, blockedReason: lockoutMessage(fullName) }
  }
  const nextAction = nextAttendanceAction(eventTypes)
  if (nextAction === null) {
    return { nextAction: null, windowStatus: null, blockedReason: 'You have already completed check-in and check-out for today.' }
  }
  const window = evaluateAction(nextAction, now, { holiday, hours, rules })
  if (!window.allowed) return { nextAction, windowStatus: null, blockedReason: window.message }
  return { nextAction, windowStatus: window.status, blockedReason: null }
}

export function lockoutMessage(fullName) {
  return `Face verification failed ${MAX_FACE_ATTEMPTS} times today for ${fullName}, so this Staff ID cannot check in or out again until tomorrow. HR has been alerted and can record today's attendance.`
}
