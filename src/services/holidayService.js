/**
 * Holidays: Ghana public holidays are built into the rules, and HR can set
 * others for a date. Records are derived, so a change here applies everywhere
 * the next time they are built.
 */

import {
  holidayNameFor,
  holidaysInYear,
  validateHoliday as validateHolidayRules,
} from '../../supabase/functions/_shared/rules/holidays.js'
import { api, submit } from './backend/client'
import { refresh, rows } from './backend/cache'

function custom() {
  return rows('holidays').map((row) => ({
    id: row.id,
    date: row.date,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }))
}

export function holidayNameForKey(dateKey) {
  return holidayNameFor(dateKey, custom())
}

export function listHolidays(year) {
  return holidaysInYear(year, custom())
}

export function validateHoliday(values) {
  return validateHolidayRules(values, custom())
}

const REFRESH = ['holidays', 'audit_events', 'notifications', 'notification_history']

export async function addHoliday({ date, name }) {
  const result = await submit('/hr/holidays', { method: 'POST', body: { date, name } })
  if (result.errors) return result
  await refresh(...REFRESH)
  return result
}

export async function removeHoliday(id) {
  try {
    await api(`/hr/holidays/${id}`, { method: 'DELETE' })
  } catch (failure) {
    return { error: failure.message }
  }
  await refresh(...REFRESH)
  return { removed: true }
}
