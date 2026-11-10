import { PUBLIC_HOLIDAYS } from '../../supabase/functions/_shared/rules/holidays.js'

export { PUBLIC_HOLIDAYS as HOLIDAYS }

/**
 * Whether a date is a public holiday.
 * @param {Date} date
 * @returns {{ holiday: boolean, name: string|null }}
 */
export function getHoliday(date) {
  const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
  const found = PUBLIC_HOLIDAYS.find((h) => h.date === key)
  return { holiday: Boolean(found), name: found?.name ?? null }
}
