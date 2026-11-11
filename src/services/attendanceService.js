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
import {
  evaluateAction,
  isWeekend,
  overtimeHours,
} from '../constants/attendancePolicy'
import { faceSimilarity, FACE_MATCH_THRESHOLD } from '../utils/faceMatch'
import { categoryForPosition, recordsVisits } from '../constants/employeeCategories'
import { defaultHoursFor } from './settingsService'
import { validateVisitOutlet, verifyVisitLocation } from './fieldVisitsService'

/**
 * Attendance actions. Which ones an employee may take depends on their
 * category and what they have already scanned today:
 *   everyone            Clock in → … → Clock out
 *   Warehouse Workers   Going on break / Back from break (as many sessions
 *                       as the company allows), between clock-in and clock-out
 *   Sales Reps and      Record outlet visit (any number), between clock-in
 *   Supervisors         and clock-out
 * A break or visit scan is never treated as a clock-in or clock-out.
 */
export const ACTIONS = {
  'check-in': { label: 'Clock in', past: 'Clocked in' },
  'break-start': { label: 'Going on break', past: 'Break started' },
  'break-end': { label: 'Back from break', past: 'Back from break' },
  visit: { label: 'Record outlet visit', past: 'Visit recorded' },
  'check-out': { label: 'Clock out', past: 'Clocked out' },
}

/** localStorage key for mock attendance events. */
const ATTENDANCE_STORAGE_KEY = 'mock-attendance:events'

/** localStorage key for failed face-verification attempts (anti-cheat). */
const ATTEMPTS_STORAGE_KEY = 'mock-attendance:attempts'

/** Simulated network latency (ms). */
const MOCK_LATENCY_MS = 1200

/**
 * ANTI-CHEAT RULE: after this many failed face-verification attempts against
 * a Staff ID in one day, the employee is automatically marked ABSENT for the
 * day (repeated mismatches mean someone is trying to cheat the system).
 */
export const MAX_FACE_ATTEMPTS = 5

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

/* ---------- Failed face-verification attempts (anti-cheat) ---------- */

function readAttempts() {
  try {
    return JSON.parse(window.localStorage.getItem(ATTEMPTS_STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeAttempts(attempts) {
  try {
    window.localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts))
  } catch {
    // Ignore — mock persistence only.
  }
}

function attemptsKey(staffId, date = todayKey()) {
  return `${staffId.toUpperCase()}:${date}`
}

/** MOCK ONLY — how many failed face attempts this Staff ID has today. */
export function getFailedAttempts(staffId, date = todayKey()) {
  return readAttempts()[attemptsKey(staffId, date)] ?? 0
}

/** MOCK ONLY — remaining face attempts before the employee is marked absent. */
export function getRemainingAttempts(staffId, date = todayKey()) {
  return Math.max(MAX_FACE_ATTEMPTS - getFailedAttempts(staffId, date), 0)
}

/** Record a failed face attempt; returns the new failed-attempt count. */
function incrementFailedAttempts(staffId, date = todayKey()) {
  const attempts = readAttempts()
  const key = attemptsKey(staffId, date)
  attempts[key] = (attempts[key] ?? 0) + 1
  writeAttempts(attempts)
  return attempts[key]
}

/** MOCK ONLY — whether this Staff ID has been auto-marked absent today. */
export function isMarkedAbsent(staffId, date = todayKey()) {
  return readEvents().some(
    (e) =>
      e.staffId.toUpperCase() === staffId.toUpperCase() &&
      e.date === date &&
      e.type === 'absent',
  )
}

/**
 * Record an ABSENT event for an employee who exhausted their face attempts.
 * Idempotent — only one absent record per employee per day.
 */
function markAbsent(employee, date = todayKey()) {
  if (isMarkedAbsent(employee.staffId, date)) return
  const now = new Date()
  const events = readEvents()
  events.push({
    id: `${employee.staffId}-absent-${now.getTime()}`,
    staffId: employee.staffId,
    fullName: employee.fullName,
    companyName: employee.companyName,
    type: 'absent',
    status: 'absent',
    reason: `Marked absent after ${MAX_FACE_ATTEMPTS} failed face-verification attempts (possible attempt to cheat the system).`,
    date,
    time: now.toISOString(),
  })
  writeEvents(events)
}

/**
 * MOCK ONLY — list attendance events (for the HR dashboard), newest first.
 * Optionally filter by date (YYYY-MM-DD) and/or company name.
 */
export function mockListAttendanceEvents({ date, companyName } = {}) {
  let events = readEvents().slice().reverse()
  if (date) events = events.filter((event) => event.date === date)
  if (companyName) events = events.filter((event) => event.companyName === companyName)
  return events
}

/** MOCK ONLY — expose the raw events array (for dashboard aggregation). */
export function mockGetAllEvents() {
  return readEvents()
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
  const actions = getAvailableActions(staffId)
  return actions.length ? actions[0] : null
}

/** Where an employee is in today's workflow. */
export function getDayState(staffId) {
  const events = getTodayEvents(staffId).filter((e) => e.type !== 'absent')
  const breakEvents = events.filter((e) => e.type === 'break-start' || e.type === 'break-end')
  const lastBreak = breakEvents[breakEvents.length - 1]
  return {
    checkedIn: events.some((e) => e.type === 'check-in'),
    checkedOut: events.some((e) => e.type === 'check-out'),
    onBreak: lastBreak?.type === 'break-start',
    breaksTaken: events.filter((e) => e.type === 'break-start').length,
    visits: events.filter((e) => e.type === 'visit').length,
  }
}

/**
 * MOCK ONLY — the actions an employee can take now, in the order to offer
 * them. Empty when the day is complete (or the employee was marked absent).
 */
export function getAvailableActions(staffId) {
  if (isMarkedAbsent(staffId)) return []
  const employee = mockFindEmployeeByStaffId(staffId)
  const category = categoryForPosition(employee?.position)
  const st = getDayState(staffId)
  if (!st.checkedIn) return ['check-in']
  if (st.checkedOut) return []
  if (category === 'warehouse') {
    if (st.onBreak) return ['break-end']
    const allowed = Number(defaultHoursFor(employee?.companyId).warehouseBreakSessions ?? 1)
    return st.breaksTaken < allowed ? ['break-start', 'check-out'] : ['check-out']
  }
  if (recordsVisits(category)) return ['visit', 'check-out']
  return ['check-out']
}

/**
 * MOCK ONLY — record an attendance event after face verification.
 *
 * STRICT IDENTITY RULE: the freshly scanned face must match the photo
 * registered to this Staff ID. The frontend passes the captured frame; this
 * compares it to the enrolled image and refuses to record anything when the
 * faces do not match — so one employee cannot scan their face against another
 * employee's Staff ID. (A production backend would do real biometric matching
 * server-side; this mock uses image similarity to enforce the same rule.)
 *
 * @param {object} params - { staffId, faceImage }
 * @returns {Promise<object>} the recorded attendance event.
 */
export function recordAttendance({ staffId, faceImage, action = null, visit = null }) {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
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

      // STRICT IDENTITY RULE: verify the scanned face matches the registered
      // face for this Staff ID before recording anything.
      if (!employee.faceImage) {
        reject(
          new Error(
            'No registered face photo on file for this Staff ID. Please contact HR.',
          ),
        )
        return
      }
      let score = 0
      try {
        score = await faceSimilarity(faceImage, employee.faceImage)
      } catch {
        reject(
          new Error('Face verification failed. Please try the scan again.'),
        )
        return
      }
      if (score < FACE_MATCH_THRESHOLD) {
        // ANTI-CHEAT: count the failed attempt. After MAX_FACE_ATTEMPTS failed
        // scans against this Staff ID today, mark the employee ABSENT — repeated
        // mismatches mean someone is trying to cheat the system.
        const failed = incrementFailedAttempts(employee.staffId)
        if (failed >= MAX_FACE_ATTEMPTS) {
          markAbsent(employee)
          reject(
            new Error(
              `Face does not match this Staff ID. ${employee.fullName} has been marked ABSENT for today after ${MAX_FACE_ATTEMPTS} failed verification attempts.`,
            ),
          )
          return
        }
        const remaining = MAX_FACE_ATTEMPTS - failed
        reject(
          new Error(
            `Face does not match this Staff ID. You can only check in or out with your own registered face. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before this Staff ID is marked absent.`,
          ),
        )
        return
      }

      // STRICT RULE: one check-in and one check-out per employee per day,
      // and only the actions allowed right now (re-checked at record time so
      // a double-submit cannot create a duplicate or out-of-order scan).
      const available = getAvailableActions(staffId)
      const type = action ?? available[0] ?? null
      if (type === null || !available.length) {
        reject(
          new Error(
            'You have already completed check-in and check-out for today.',
          ),
        )
        return
      }
      if (!available.includes(type)) {
        const st = getDayState(staffId)
        reject(new Error(
          type === 'check-out' && st.onBreak ? 'You are on break. Scan "Back from break" before clocking out.'
            : type === 'break-start' ? 'No more breaks are allowed today, or you are not clocked in.'
              : type === 'break-end' ? 'You have not started a break.'
                : type === 'visit' ? 'Outlet visits are recorded by Sales Representatives and Supervisors after clocking in.'
                  : `"${ACTIONS[type]?.label ?? type}" is not available right now.`,
        ))
        return
      }
      if (type === 'visit') {
        const problem = validateVisitOutlet(visit?.outlet)
        if (problem) {
          reject(new Error(problem))
          return
        }
      }
      const alreadyDone = (type === 'check-in' || type === 'check-out') && getTodayEvents(staffId).some((e) => e.type === type)
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

      // TIME-WINDOW RULE: enforce the check-in / check-out windows. Break
      // and visit scans happen during the working day and have no window.
      const now = new Date()
      const window = type === 'check-in' || type === 'check-out'
        ? evaluateAction(type, now)
        : { allowed: true, status: 'on-time' }
      if (!window.allowed) {
        reject(new Error(window.message))
        return
      }

      const weekend = isWeekend(now)
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
        // Weekend work is overtime.
        weekend,
      }
      if (type === 'visit') {
        const location = visit.location && Number.isFinite(visit.location.latitude) ? {
          latitude: visit.location.latitude,
          longitude: visit.location.longitude,
          accuracy: Number.isFinite(visit.location.accuracy) ? Math.round(visit.location.accuracy) : null,
        } : null
        event.outlet = visit.outlet.shopId
          ? { shopId: visit.outlet.shopId }
          : { shopId: null, name: String(visit.outlet.name).trim(), town: String(visit.outlet.town).trim() }
        event.location = location
        event.locationError = location ? null : (visit.locationError ?? 'Location not provided')
        event.verification = verifyVisitLocation(event.outlet, location)
      }

      // On a weekend check-out, compute the overtime hours worked today
      // (check-in to check-out) and store them on the check-out event.
      if (type === 'check-out' && weekend) {
        const checkIn = getTodayEvents(staffId).find((e) => e.type === 'check-in')
        event.overtimeHours = overtimeHours(checkIn?.time, event.time, now)
      }

      const events = readEvents()
      events.push(event)
      writeEvents(events)
      resolve(event)
    }, MOCK_LATENCY_MS)
  })
}
