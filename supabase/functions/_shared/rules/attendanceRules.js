/**
 * Shared company attendance rules.
 *
 *   - Attendance periods run from the 26th of one month to the 25th of the
 *     next. Calendar-month boundaries are never used.
 *   - Time zone: Africa/Accra.
 *   - Future dates are never counted as absences.
 *   - Nobody is marked absent before the working day has ended.
 *   - Approved leave is not absence.
 *   - Weekends and holidays are not working days, so they are never absences.
 *   - Missing or unreadable historical information is "Unknown", never guessed.
 *   - A missed SMS verification is an exception for HR review. It never
 *     becomes an absence or a disciplinary decision automatically.
 */

import { getPayPeriod, payPeriodDates } from './payPeriod.js'
import { accraTodayKey, dayOfWeekForKey } from './accraTime.js'

/**
 * The date digital attendance (face check-in and SMS verification) went live.
 * Attendance before this date was kept in paper notebooks.
 */
export const DIGITAL_GO_LIVE_DATE = '2026-10-01'

/**
 * After the working day ends, employees have this long to clock out (mirrors
 * the 17:00–19:00 check-out window). After that a clock-in without a clock-out
 * is an Incomplete record.
 */
export const CLOCK_OUT_GRACE_MINUTES = 120

/** Standard hours: on time until 09:00, check-out from 17:00, Monday to Friday. */
export const DEFAULT_SCHEDULE = {
  name: 'Standard office hours',
  startTime: '08:00',
  endTime: '17:00',
  graceMinutes: 60,
  breakStart: null,
  breakEnd: null,
  workingDays: [1, 2, 3, 4, 5],
}

/** Whether a date is one of the working days (ignores holidays). */
export function isShiftDay(workingDays, dateKey) {
  return Array.isArray(workingDays) && workingDays.includes(dayOfWeekForKey(dateKey))
}

/** Whether a date key is after today (Accra). */
export function isFutureDateKey(dateKey, today = accraTodayKey()) {
  return dateKey > today
}

/** The attendance period (26th–25th) containing a date key. */
export function periodForDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return getPayPeriod(new Date(y, m - 1, d))
}

/** All date keys in a period, day 1 (the 26th) first. */
export function periodDateKeys(period) {
  return payPeriodDates(period)
}

/** Period date keys up to and including today; future dates are excluded. */
export function elapsedPeriodDateKeys(period, today = accraTodayKey()) {
  return payPeriodDates(period).filter((d) => d <= today)
}
