/**
 * Africa/Accra time helpers, shared by the browser and the Edge Functions.
 *
 * Accra is UTC+0 all year (no daylight saving), so an Accra calendar date maps
 * to a fixed UTC day. Nothing here depends on the device or server time zone.
 */

export const TIMEZONE = 'Africa/Accra'

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Accra calendar date (YYYY-MM-DD) of an instant. */
export function accraDateKey(date = new Date()) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Today's date in Accra (YYYY-MM-DD). */
export function accraTodayKey() {
  return accraDateKey(new Date())
}

/** Epoch milliseconds of 00:00 Accra time on a date key. */
export function accraMidnightMs(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** ISO timestamp for a number of minutes after Accra midnight on a date. */
export function accraIso(dateKey, minutes) {
  return new Date(accraMidnightMs(dateKey) + minutes * 60000).toISOString()
}

/** Minutes between Accra midnight of `dateKey` and an ISO instant. */
export function minutesFromAccraMidnight(iso, dateKey) {
  return Math.round((Date.parse(iso) - accraMidnightMs(dateKey)) / 60000)
}

/** Shift a date key by a number of days. */
export function addDaysToKey(dateKey, days) {
  return accraDateKey(new Date(accraMidnightMs(dateKey) + days * 86400000))
}

/** Day of week for a date key (0 = Sunday … 6 = Saturday). */
export function dayOfWeekForKey(dateKey) {
  return new Date(accraMidnightMs(dateKey)).getUTCDay()
}

/** "9:05 AM" in Accra time, or '—'. */
export function formatAccraTime(iso, { hour12 = true } = {}) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    timeZone: TIMEZONE,
  })
}

/** "Mon, 9 Nov 2026" in Accra time. */
export function formatAccraDate(dateKey, options) {
  if (!dateKey) return '—'
  return new Date(accraMidnightMs(dateKey)).toLocaleDateString([], {
    timeZone: TIMEZONE,
    ...(options ?? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  })
}

/** "9 Nov 2026, 9:05 AM" in Accra time, or '—'. */
export function formatAccraDateTime(iso, { hour12 = true } = {}) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  })
}
