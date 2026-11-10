/**
 * Time with the company, counted in whole calendar years, months and days
 * from the date the employee joined (YYYY-MM-DD, Africa/Accra) to today.
 * Example: joined 2024-01-15, today 2026-03-20 → 2 years, 2 months, 5 days.
 */

const KEY = /^\d{4}-\d{2}-\d{2}$/

function parts(key) {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m, d }
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Whether a string is a real calendar date (YYYY-MM-DD). */
export function isDateKey(value) {
  if (!KEY.test(value ?? '')) return false
  const { y, m, d } = parts(value)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

/**
 * @returns {{ years, months, days, totalDays } | null} null when the date is
 *   missing, invalid or after `todayKey`.
 */
export function tenureBetween(joinedKey, todayKey) {
  if (!isDateKey(joinedKey) || !isDateKey(todayKey) || joinedKey > todayKey) return null
  const a = parts(joinedKey)
  const b = parts(todayKey)
  // Whole months first: step forward from the joining date month by month
  // (a 31st becomes the last day of a shorter month), then count the days left.
  let totalMonths = (b.y - a.y) * 12 + (b.m - a.m)
  if (b.d < a.d) totalMonths -= 1
  const anchorMonthIndex = a.m - 1 + totalMonths
  const ay = a.y + Math.floor(anchorMonthIndex / 12)
  const am = (anchorMonthIndex % 12) + 1
  const ad = Math.min(a.d, daysInMonth(ay, am))
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(ay, am - 1, ad)) / 86400000)
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  const totalDays = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000)
  return { years, months, days, totalDays }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "2 years, 3 months and 5 days" (zero parts are left out; "0 days" when joined today). */
export function formatTenure(t) {
  if (!t) return '—'
  const list = [t.years && plural(t.years, 'year'), t.months && plural(t.months, 'month'), t.days && plural(t.days, 'day')].filter(Boolean)
  if (!list.length) return '0 days (joined today)'
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}
