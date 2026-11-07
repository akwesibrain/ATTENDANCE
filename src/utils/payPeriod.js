/**
 * Pay-period (reporting month) logic.
 *
 * The company month does not start on the 1st of the calendar month. It starts
 * on the 26th and runs to the 25th of the next calendar month. So the period
 * labelled "November 2026" covers 26 Oct 2026 through 25 Nov 2026, and its
 * days are numbered from 1 (26 Oct = day 1).
 */

/** The day of the calendar month on which a new period starts. */
export const PERIOD_START_DAY = 26

/**
 * The period (reporting month) that contains a given date.
 * @param {Date} [date]
 * @returns {{ start: Date, end: Date, key: string, label: string }}
 *   start/end are inclusive calendar dates; key is YYYY-MM of the period's end
 *   month; label is e.g. "November 2026".
 */
export function getPayPeriod(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  let start
  if (d.getDate() >= PERIOD_START_DAY) {
    // On/after the 26th: the period started this calendar month.
    start = new Date(d.getFullYear(), d.getMonth(), PERIOD_START_DAY)
  } else {
    // Before the 26th: the period started on the 26th of last month.
    start = new Date(d.getFullYear(), d.getMonth() - 1, PERIOD_START_DAY)
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, PERIOD_START_DAY - 1)
  const key = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
  const label = end.toLocaleDateString([], { month: 'long', year: 'numeric' })
  return { start, end, key, label }
}

/**
 * All periods that have started up to and including the current one, newest
 * first. Used for the report month picker.
 * @param {number} [count] how many past periods to include.
 */
export function listPayPeriods(count = 12, referenceDate = new Date()) {
  const current = getPayPeriod(referenceDate)
  const periods = []
  for (let i = 0; i < count; i += 1) {
    const start = new Date(
      current.start.getFullYear(),
      current.start.getMonth() - i,
      PERIOD_START_DAY,
    )
    periods.push(getPayPeriod(start))
  }
  return periods
}

/**
 * The calendar dates (YYYY-MM-DD) that make up a period, in order, day 1 first.
 * @returns {string[]}
 */
export function payPeriodDates(period) {
  const dates = []
  const cursor = new Date(period.start)
  while (cursor <= period.end) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
    )
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

/**
 * The 1-based day number of a date within its period (26th = day 1).
 * @returns {number}
 */
export function payPeriodDayNumber(date, period) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const start = new Date(
    period.start.getFullYear(),
    period.start.getMonth(),
    period.start.getDate(),
  )
  return Math.round((d - start) / 86400000) + 1
}
