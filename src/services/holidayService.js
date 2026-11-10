/**
 * Holidays (mock, browser storage).
 *
 * Two kinds, both applying to Box For Less and Double A:
 *   - Ghana public holidays (recurring every year, built in).
 *   - Holidays HR sets for a specific date (e.g. a declared holiday or a
 *     company day off). HR can add and remove these.
 *
 * Every calculation reads holidays from here, so setting a date as a holiday
 * is picked up automatically: the day stops being a working day (nobody is
 * absent), and any time worked that day — clock-in to clock-out — counts as
 * overtime. Removing it restores the normal working day.
 */
import { HOLIDAYS as PUBLIC_HOLIDAYS } from '../constants/holidays'
import { readJson, writeJson } from './mockStore'
import { can } from './permissionsService'
import { recordAuditEvent } from './auditStore'

const STORE_KEY = 'mock-holidays:v1'
const DATE = /^\d{4}-\d{2}-\d{2}$/

function readCustom() {
  const list = readJson(STORE_KEY, [])
  return Array.isArray(list) ? list : []
}

function formatDay(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function realDate(key) {
  if (!DATE.test(key ?? '')) return false
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** The holiday name on a date (YYYY-MM-DD), or null. HR-set holidays first. */
export function holidayNameForKey(dateKey) {
  if (!dateKey) return null
  const custom = readCustom().find((h) => h.date === dateKey)
  if (custom) return custom.name
  return PUBLIC_HOLIDAYS.find((h) => h.date === dateKey.slice(5))?.name ?? null
}

/** Holidays in a year: public (recurring) and HR-set, sorted by date. */
export function listHolidays(year) {
  const y = String(year)
  const publicOnes = PUBLIC_HOLIDAYS.map((h) => ({ id: `public:${h.date}`, date: `${y}-${h.date}`, name: h.name, kind: 'public' }))
  const custom = readCustom().filter((h) => h.date.startsWith(`${y}-`)).map((h) => ({ ...h, kind: 'custom' }))
  // An HR holiday on the same date as a public one replaces it in the list.
  const byDate = new Map()
  ;[...publicOnes, ...custom].forEach((h) => byDate.set(h.date, h))
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function validateHoliday({ date, name }) {
  const errors = {}
  if (!date) errors.date = 'Choose the date.'
  else if (!realDate(date)) errors.date = 'Enter a valid date.'
  else if (date < '2000-01-01' || date > '2100-12-31') errors.date = 'Check the year.'
  else if (readCustom().some((h) => h.date === date)) errors.date = 'This date is already set as a holiday.'
  else if (PUBLIC_HOLIDAYS.some((h) => h.date === date.slice(5))) errors.date = `This date is already a public holiday (${holidayNameForKey(date)}).`
  const n = (name ?? '').trim()
  if (n.length < 3) errors.name = 'Enter the holiday name (at least 3 characters).'
  else if (n.length > 80) errors.name = 'Keep the name under 80 characters.'
  return errors
}

/** HR sets a date as a holiday for both companies. Checked here, not only in the UI. */
export function mockAddHoliday({ date, name }, actor) {
  if (!can(actor, 'settings', 'edit')) return { errors: { form: 'You are not authorised to set holidays.' } }
  const errors = validateHoliday({ date, name })
  if (Object.keys(errors).length) return { errors }
  const holiday = {
    id: `hol-${date}-${Math.random().toString(36).slice(2, 6)}`,
    date,
    name: name.trim(),
    createdBy: actor.name,
    createdAt: new Date().toISOString(),
  }
  writeJson(STORE_KEY, [...readCustom(), holiday].sort((a, b) => a.date.localeCompare(b.date)))
  recordAuditEvent({
    source: 'Settings',
    action: 'Holiday added',
    category: 'System Settings',
    actor: { name: actor.name, role: actor.role },
    companyIds: [],
    affected: `${holiday.name} — ${formatDay(date)}`,
    description: 'Applies to Box For Less and Double A. Not a working day; time worked counts as overtime.',
    previous: { holiday: 'None' },
    next: { holiday: holiday.name, date },
  })
  return { holiday }
}

/** HR removes a holiday they set. Public holidays cannot be removed. */
export function mockRemoveHoliday(id, actor) {
  if (!can(actor, 'settings', 'edit')) return { error: 'You are not authorised to change holidays.' }
  const list = readCustom()
  const holiday = list.find((h) => h.id === id)
  if (!holiday) return { error: 'Only holidays set by HR can be removed.' }
  writeJson(STORE_KEY, list.filter((h) => h.id !== id))
  recordAuditEvent({
    source: 'Settings',
    action: 'Holiday removed',
    category: 'System Settings',
    actor: { name: actor.name, role: actor.role },
    companyIds: [],
    affected: `${holiday.name} — ${formatDay(holiday.date)}`,
    description: 'The date is a normal working day again.',
    previous: { holiday: holiday.name, date: holiday.date },
    next: { holiday: 'None' },
  })
  return { removed: holiday }
}
