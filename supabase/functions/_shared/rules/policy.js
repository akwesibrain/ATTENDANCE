/**
 * Attendance time windows, shared by the browser and the server.
 *
 *   - Check-in window: from 06:00. Up to and including 09:00 is on time; after
 *     09:00 a check-in is still recorded but flagged late.
 *   - Check-out window: 17:00 – 19:00. After 19:00 check-out is NOT recorded.
 *   - Saturdays, Sundays and holidays are overtime and are not bound by the windows.
 *
 * All times are Africa/Accra, which is UTC+0 all year, so the UTC clock is used
 * and the result does not depend on the device. The server's evaluation is the
 * one that counts; the browser only uses this to show the right message.
 */

export const CHECK_IN_START_HOUR = 6 // 06:00
export const CHECK_IN_ON_TIME_END_HOUR = 9 // 09:00, after this is "late"
export const CHECK_OUT_START_HOUR = 17 // 17:00 (5pm)
export const CHECK_OUT_END_HOUR = 19 // 19:00 (7pm), after this, no recording

function minuteOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

/** Working days are Monday to Friday. Saturday and Sunday are weekends. */
export function isWeekend(date = new Date()) {
  const day = date.getUTCDay() // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6
}

/**
 * Evaluate the check-in window at a given time.
 * @returns {{allowed: boolean, status: 'on-time'|'late'|null, message: string}}
 */
export function evaluateCheckIn(now = new Date(), { holiday = false } = {}) {
  // Weekend and holiday work is overtime and is not bound by the weekday window.
  if (holiday || isWeekend(now)) {
    return { allowed: true, status: 'on-time', message: '', overtime: true }
  }
  const minute = minuteOfDay(now)
  if (minute < CHECK_IN_START_HOUR * 60) {
    return {
      allowed: false,
      status: null,
      message: 'Check-in opens at 6:00 AM. Please come back during the check-in window (6:00–9:00 AM).',
    }
  }
  if (minute <= CHECK_IN_ON_TIME_END_HOUR * 60) {
    return { allowed: true, status: 'on-time', message: '' }
  }
  // After 9:00 AM: still recorded, but flagged as late coming.
  return { allowed: true, status: 'late', message: '' }
}

/**
 * Evaluate the check-out window at a given time.
 * @returns {{allowed: boolean, status: 'on-time'|null, message: string}}
 */
export function evaluateCheckOut(now = new Date(), { holiday = false } = {}) {
  // Weekend and holiday work is overtime and is not bound by the weekday window.
  if (holiday || isWeekend(now)) {
    return { allowed: true, status: 'on-time', message: '', overtime: true }
  }
  const minute = minuteOfDay(now)
  if (minute < CHECK_OUT_START_HOUR * 60) {
    return {
      allowed: false,
      status: null,
      message: 'Check-out opens at 5:00 PM. You can check out between 5:00 and 7:00 PM.',
    }
  }
  if (minute >= CHECK_OUT_END_HOUR * 60) {
    return {
      allowed: false,
      status: null,
      message: 'Check-out closed at 7:00 PM. Attendance can no longer be recorded for today.',
    }
  }
  return { allowed: true, status: 'on-time', message: '' }
}

/** Evaluate the window for a given action type. */
export function evaluateAction(type, now = new Date(), options = {}) {
  return type === 'check-in' ? evaluateCheckIn(now, options) : evaluateCheckOut(now, options)
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
