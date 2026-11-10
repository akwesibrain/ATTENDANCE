/**
 * Holiday rules, shared by the browser and the server.
 *
 * Two kinds, both applying to Box For Less and Double A:
 *   - Ghana public holidays, recurring every year and built in here.
 *   - Holidays HR sets for a specific date. These are passed in as `custom`
 *     ([{ id, date, name }]) because they live in the database.
 *
 * A holiday is not a working day, so nobody is absent, and time worked counts
 * as overtime from clock-in to clock-out.
 */

import { isDateKey } from './tenure.js'

/** Dates are MM-DD and recur yearly. */
export const PUBLIC_HOLIDAYS = [
  { date: '01-01', name: "New Year's Day" },
  { date: '01-07', name: 'Constitution Day' },
  { date: '03-06', name: 'Independence Day' },
  { date: '05-01', name: "Workers' Day" },
  { date: '08-04', name: "Founders' Day" },
  { date: '09-21', name: 'Kwame Nkrumah Memorial Day' },
  { date: '12-25', name: 'Christmas Day' },
  { date: '12-26', name: 'Boxing Day' },
]

/** The holiday name on a date (YYYY-MM-DD), or null. HR-set holidays first. */
export function holidayNameFor(dateKey, custom = []) {
  if (!dateKey) return null
  const set = custom.find((h) => h.date === dateKey)
  if (set) return set.name
  return PUBLIC_HOLIDAYS.find((h) => h.date === dateKey.slice(5))?.name ?? null
}

/** Holidays in a year: public (recurring) and HR-set, sorted by date. */
export function holidaysInYear(year, custom = []) {
  const y = String(year)
  const publicOnes = PUBLIC_HOLIDAYS.map((h) => ({ id: `public:${h.date}`, date: `${y}-${h.date}`, name: h.name, kind: 'public' }))
  const set = custom.filter((h) => h.date.startsWith(`${y}-`)).map((h) => ({ ...h, kind: 'custom' }))
  // An HR holiday on the same date as a public one replaces it in the list.
  const byDate = new Map()
  ;[...publicOnes, ...set].forEach((h) => byDate.set(h.date, h))
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function validateHoliday({ date, name }, custom = []) {
  const errors = {}
  if (!date) errors.date = 'Choose the date.'
  else if (!isDateKey(date)) errors.date = 'Enter a valid date.'
  else if (date < '2000-01-01' || date > '2100-12-31') errors.date = 'Check the year.'
  else if (custom.some((h) => h.date === date)) errors.date = 'This date is already set as a holiday.'
  else if (PUBLIC_HOLIDAYS.some((h) => h.date === date.slice(5))) errors.date = `This date is already a public holiday (${holidayNameFor(date, custom)}).`
  const n = (name ?? '').trim()
  if (n.length < 3) errors.name = 'Enter the holiday name (at least 3 characters).'
  else if (n.length > 80) errors.name = 'Keep the name under 80 characters.'
  return errors
}
