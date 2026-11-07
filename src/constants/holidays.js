/**
 * Public holidays (Ghana). Used in the reports to mark days that are not
 * working days. Dates are MM-DD (recurring yearly). In production these would
 * come from the backend / HR configuration.
 */
export const HOLIDAYS = [
  { date: '01-01', name: "New Year's Day" },
  { date: '01-07', name: 'Constitution Day' },
  { date: '03-06', name: 'Independence Day' },
  { date: '05-01', name: "Workers' Day" },
  { date: '08-04', name: "Founders' Day" },
  { date: '09-21', name: 'Kwame Nkrumah Memorial Day' },
  { date: '12-25', name: 'Christmas Day' },
  { date: '12-26', name: 'Boxing Day' },
]

/**
 * Whether a date is a public holiday.
 * @param {Date} date
 * @returns {{ holiday: boolean, name: string|null }}
 */
export function getHoliday(date) {
  const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
  const found = HOLIDAYS.find((h) => h.date === key)
  return { holiday: Boolean(found), name: found?.name ?? null }
}
