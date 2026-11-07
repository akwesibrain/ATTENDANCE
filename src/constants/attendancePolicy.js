/**
 * Attendance time-window policy (shared by the UI and the mock service).
 *
 * Business rules:
 *   - Check-in window: 06:00 – 09:00. After 09:00 a check-in is still
 *     recorded but flagged as LATE.
 *   - Check-out window: 17:00 – 19:00. After 19:00 check-out is NOT recorded.
 *   - Outside a window the corresponding action is not allowed.
 *
 * Times are local device time. In production the backend must enforce these
 * rules authoritatively (server time), not the client.
 */

export const CHECK_IN_START_HOUR = 6 // 06:00
export const CHECK_IN_ON_TIME_END_HOUR = 9 // 09:00 — after this is "late"
export const CHECK_OUT_START_HOUR = 17 // 17:00 (5pm)
export const CHECK_OUT_END_HOUR = 19 // 19:00 (7pm) — after this, no recording

function hourOf(date) {
  return date.getHours() + date.getMinutes() / 60
}

/**
 * Evaluate the check-in window at a given time.
 * @returns {{allowed: boolean, status: 'on-time'|'late'|null, message: string}}
 */
export function evaluateCheckIn(now = new Date()) {
  // Weekend work is overtime and is not bound by the weekday window.
  if (isWeekend(now)) {
    return { allowed: true, status: 'on-time', message: '', overtime: true }
  }
  const h = hourOf(now)
  if (h < CHECK_IN_START_HOUR) {
    return {
      allowed: false,
      status: null,
      message: 'Check-in opens at 6:00 AM. Please come back during the check-in window (6:00–9:00 AM).',
    }
  }
  if (h < CHECK_IN_ON_TIME_END_HOUR) {
    return { allowed: true, status: 'on-time', message: '' }
  }
  // After 9:00 AM — still recorded, but flagged as late coming.
  return { allowed: true, status: 'late', message: '' }
}

/**
 * Evaluate the check-out window at a given time.
 * @returns {{allowed: boolean, status: 'on-time'|null, message: string}}
 */
export function evaluateCheckOut(now = new Date()) {
  // Weekend work is overtime and is not bound by the weekday window.
  if (isWeekend(now)) {
    return { allowed: true, status: 'on-time', message: '', overtime: true }
  }
  const h = hourOf(now)
  if (h < CHECK_OUT_START_HOUR) {
    return {
      allowed: false,
      status: null,
      message: 'Check-out opens at 5:00 PM. You can check out between 5:00 and 7:00 PM.',
    }
  }
  if (h >= CHECK_OUT_END_HOUR) {
    return {
      allowed: false,
      status: null,
      message: 'Check-out closed at 7:00 PM. Attendance can no longer be recorded for today.',
    }
  }
  return { allowed: true, status: 'on-time', message: '' }
}

/** Evaluate the window for a given action type. */
export function evaluateAction(type, now = new Date()) {
  return type === 'check-in' ? evaluateCheckIn(now) : evaluateCheckOut(now)
}

/* ---------- Working days, weekends and overtime ---------- */

/** Working days are Monday to Friday. Saturday and Sunday are weekends. */
export function isWeekend(date = new Date()) {
  const day = date.getDay() // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6
}

/**
 * Overtime hours for a day's work. Weekend work (Sat/Sun) counts as overtime:
 * the hours between check-in and check-out. Returns hours rounded to one
 * decimal, or 0 when there is no complete in/out pair or it is a weekday.
 */
export function overtimeHours(checkInTime, checkOutTime, date = new Date()) {
  if (!isWeekend(date)) return 0
  if (!checkInTime || !checkOutTime) return 0
  const start = new Date(checkInTime).getTime()
  const end = new Date(checkOutTime).getTime()
  const hours = (end - start) / 3600000
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.round(hours * 10) / 10
}
