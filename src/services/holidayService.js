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
import {
  holidayNameFor,
  holidaysInYear,
  validateHoliday as validateHolidayRules,
} from '../../supabase/functions/_shared/rules/holidays.js'
import { readJson, writeJson } from './mockStore'
import { can } from './permissionsService'
import { recordAuditEvent } from './auditStore'

const STORE_KEY = 'mock-holidays:v1'

function readCustom() {
  const list = readJson(STORE_KEY, [])
  return Array.isArray(list) ? list : []
}

function formatDay(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The holiday name on a date (YYYY-MM-DD), or null. HR-set holidays first. */
export function holidayNameForKey(dateKey) {
  return holidayNameFor(dateKey, readCustom())
}

/** Holidays in a year: public (recurring) and HR-set, sorted by date. */
export function listHolidays(year) {
  return holidaysInYear(year, readCustom())
}

export function validateHoliday(values) {
  return validateHolidayRules(values, readCustom())
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
