/**
 * ============================================================================
 * MOCK ATTENDANCE SERVICE  —  NOT A PRODUCTION BACKEND
 * ============================================================================
 * Simulates the backend attendance API so the frontend check-in/check-out
 * flow can be built and tested end to end.
 *
 * In the real implementation:
 *   - The backend looks up the employee by Staff ID.
 *   - The captured face image is verified server-side against the enrolled
 *     biometric template (real face matching — NOT done in the frontend).
 *   - The backend records the attendance event and returns the result.
 *
 * Replace these functions with real API calls once the backend contract is
 * defined. Do NOT invent endpoints here.
 * ============================================================================
 */

import { mockFindEmployeeByStaffId } from './registrationService'
import { evaluateAction } from '../constants/attendancePolicy'

/** localStorage key for mock attendance events. */
const ATTENDANCE_STORAGE_KEY = 'mock-attendance:events'

/** Simulated network latency (ms). */
const MOCK_LATENCY_MS = 1200

function readEvents() {
  try {
    return JSON.parse(window.localStorage.getItem(ATTENDANCE_STORAGE_KEY)) ?? []
  } catch {
    return []
  }
}

function writeEvents(events) {
  try {
    window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(events))
  } catch {
    // Ignore — mock persistence only.
  }
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

/**
 * MOCK ONLY — look up an employee by Staff ID for attendance.
 * @returns {Promise<object>} the employee record.
 * Rejects if the Staff ID is not registered.
 */
export function lookupEmployee(staffId) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const employee = mockFindEmployeeByStaffId(staffId)
      if (!employee) {
        reject(
          new Error(
            'Staff ID not found. Check the ID and try again, or register first.',
          ),
        )
        return
      }
      resolve(employee)
    }, MOCK_LATENCY_MS)
  })
}

/**
 * MOCK ONLY — today's events for an employee, oldest first.
 */
function getTodayEvents(staffId) {
  return readEvents().filter(
    (event) =>
      event.staffId.toUpperCase() === staffId.toUpperCase() &&
      event.date === todayKey(),
  )
}

/**
 * MOCK ONLY — determine the next attendance action for an employee today.
 * Returns 'check-in' if they have not checked in yet, 'check-out' if they are
 * currently checked in, or null if they have completed both for the day.
 */
export function getNextAction(staffId) {
  const events = getTodayEvents(staffId)
  const last = events[events.length - 1]
  if (!last) return 'check-in'
  if (last.type === 'check-in') return 'check-out'
  return null // already checked in AND out today
}

/**
 * MOCK ONLY — record an attendance event after (simulated) face verification.
 *
 * The frontend passes the freshly captured face image; the real backend would
 * compare it to the enrolled template. Here we only check that an image was
 * provided, then record the event.
 *
 * @param {object} params - { staffId, faceImage }
 * @returns {Promise<object>} the recorded attendance event.
 */
export function recordAttendance({ staffId, faceImage }) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const employee = mockFindEmployeeByStaffId(staffId)
      if (!employee) {
        reject(new Error('Staff ID not found. Please register first.'))
        return
      }
      if (!faceImage) {
        reject(
          new Error(
            'Face verification is required. Please capture your photo to continue.',
          ),
        )
        return
      }

      // STRICT RULE: one check-in and one check-out per employee per day.
      // Re-derive the allowed action at record time and refuse duplicates so
      // a double-submit or repeat visit cannot create a second check-in.
      const type = getNextAction(staffId)
      if (type === null) {
        reject(
          new Error(
            'You have already completed check-in and check-out for today.',
          ),
        )
        return
      }
      const alreadyDone = getTodayEvents(staffId).some((e) => e.type === type)
      if (alreadyDone) {
        reject(
          new Error(
            type === 'check-in'
              ? 'You are already checked in for today.'
              : 'You have already checked out for today.',
          ),
        )
        return
      }

      // TIME-WINDOW RULE: enforce the check-in / check-out windows.
      const now = new Date()
      const window = evaluateAction(type, now)
      if (!window.allowed) {
        reject(new Error(window.message))
        return
      }

      const event = {
        id: `${staffId}-${now.getTime()}`,
        staffId: employee.staffId,
        fullName: employee.fullName,
        companyName: employee.companyName,
        type,
        // 'on-time' | 'late' (late only applies to check-in after 9:00 AM)
        status: window.status,
        date: todayKey(now),
        time: now.toISOString(),
      }
      const events = readEvents()
      events.push(event)
      writeEvents(events)
      resolve(event)
    }, MOCK_LATENCY_MS)
  })
}
