/**
 * Kiosk time windows, shared by the browser and the server.
 *
 * The windows come from Settings, so they follow whatever HR has configured:
 *   - Check-in opens at 06:00, or at the official clock-in time if that is
 *     earlier. Up to and including the late-coming time is on time; after it
 *     a check-in is still recorded but flagged late.
 *   - Check-out opens at the official clock-out time and stays open for the
 *     clock-out window (Attendance Settings), never past the end of the day.
 *     Working late therefore records overtime instead of being refused.
 *   - Days that are not working days, and holidays, are overtime and are not
 *     bound by the windows.
 *
 * All times are Africa/Accra, which is UTC+0 all year, so the UTC clock is used
 * and the result does not depend on the device. The server's evaluation is the
 * one that counts.
 */

import { DEFAULT_HOURS } from './settings.js'

export const CHECK_IN_OPENS = '06:00'
export const DEFAULT_CLOCK_OUT_WINDOW_MINUTES = 360
const END_OF_DAY = 24 * 60

function toMinutes(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

function minuteOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

/** "6:00 AM", "5:30 PM", or "midnight". */
export function clockLabel(minutes) {
  if (minutes >= END_OF_DAY) return 'midnight'
  const hours = Math.floor(minutes / 60)
  const suffix = hours < 12 ? 'AM' : 'PM'
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${suffix}`
}

/** The kiosk windows for a company's hours and the attendance rules in force. */
export function kioskWindows(hours = DEFAULT_HOURS, rules = {}) {
  const end = toMinutes(hours.endTime)
  const window = Number(rules.clockOutWindowMinutes ?? DEFAULT_CLOCK_OUT_WINDOW_MINUTES)
  return {
    checkInOpens: Math.min(toMinutes(CHECK_IN_OPENS), toMinutes(hours.startTime)),
    lateAfter: toMinutes(hours.lateAfter),
    checkOutOpens: end,
    checkOutCloses: Math.min(end + window, END_OF_DAY),
  }
}

/** Whether the kiosk windows apply today: a working day that is not a holiday. */
export function isWorkingDay(now = new Date(), { holiday = false, hours = DEFAULT_HOURS } = {}) {
  return !holiday && hours.workingDays.includes(now.getUTCDay())
}

/**
 * @param {Date} now
 * @param {{ holiday?: boolean, hours?: object, rules?: object }} options
 * @returns {{allowed: boolean, status: 'on-time'|'late'|null, message: string, overtime?: boolean}}
 */
export function evaluateCheckIn(now = new Date(), options = {}) {
  if (!isWorkingDay(now, options)) return { allowed: true, status: 'on-time', message: '', overtime: true }
  const w = kioskWindows(options.hours, options.rules)
  const minute = minuteOfDay(now)
  if (minute < w.checkInOpens) {
    return {
      allowed: false,
      status: null,
      message: `Check-in opens at ${clockLabel(w.checkInOpens)}. Arrive by ${clockLabel(w.lateAfter)} to be on time.`,
    }
  }
  if (minute <= w.lateAfter) return { allowed: true, status: 'on-time', message: '' }
  // After the late-coming time: still recorded, but flagged as late coming.
  return { allowed: true, status: 'late', message: '' }
}

/**
 * @param {Date} now
 * @param {{ holiday?: boolean, hours?: object, rules?: object }} options
 * @returns {{allowed: boolean, status: 'on-time'|null, message: string, overtime?: boolean}}
 */
export function evaluateCheckOut(now = new Date(), options = {}) {
  if (!isWorkingDay(now, options)) return { allowed: true, status: 'on-time', message: '', overtime: true }
  const w = kioskWindows(options.hours, options.rules)
  const minute = minuteOfDay(now)
  const range = `${clockLabel(w.checkOutOpens)} and ${clockLabel(w.checkOutCloses)}`
  if (minute < w.checkOutOpens) {
    return {
      allowed: false,
      status: null,
      message: `Check-out opens at ${clockLabel(w.checkOutOpens)}. You can check out between ${range}.`,
    }
  }
  if (minute >= w.checkOutCloses) {
    return {
      allowed: false,
      status: null,
      message: `Check-out closed at ${clockLabel(w.checkOutCloses)}. Please ask HR to record your clock-out time.`,
    }
  }
  return { allowed: true, status: 'on-time', message: '' }
}

/** Evaluate the window for a given action type. */
export function evaluateAction(type, now = new Date(), options = {}) {
  return type === 'check-in' ? evaluateCheckIn(now, options) : evaluateCheckOut(now, options)
}

/**
 * Hours worked on a day off (a non-working day or a holiday): the time between
 * check-in and check-out, rounded to one decimal. 0 on a working day, or when
 * there is no complete pair. Weekday overtime is calculated from the hours in
 * the attendance records instead.
 */
export function overtimeHours(checkInTime, checkOutTime, dayOff) {
  if (!dayOff) return 0
  if (!checkInTime || !checkOutTime) return 0
  const hours = (Date.parse(checkOutTime) - Date.parse(checkInTime)) / 3600000
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.round(hours * 10) / 10
}
