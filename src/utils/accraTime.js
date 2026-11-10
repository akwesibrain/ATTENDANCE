/**
 * Africa/Accra time helpers for the browser. The rules live in the shared
 * module; this file adds the 12/24-hour display preference from Settings.
 */

import { SETTINGS_KEY, readJson } from '../services/mockStore'
import {
  formatAccraDateTime as formatDateTime,
  formatAccraTime as formatTime,
} from '../../supabase/functions/_shared/rules/accraTime.js'

export {
  TIMEZONE,
  accraDateKey,
  accraTodayKey,
  accraMidnightMs,
  accraIso,
  minutesFromAccraMidnight,
  addDaysToKey,
  dayOfWeekForKey,
  formatAccraDate,
} from '../../supabase/functions/_shared/rules/accraTime.js'

/** Settings → General: 12-hour or 24-hour clock (read directly; no cycle). */
function hour12() {
  return readJson(SETTINGS_KEY, {})?.general?.timeFormat !== '24h'
}

/** "9:05 AM" in Accra time, or '—'. */
export function formatAccraTime(iso) {
  return formatTime(iso, { hour12: hour12() })
}

/** "9 Nov 2026, 9:05 AM" in Accra time, or '—'. */
export function formatAccraDateTime(iso) {
  return formatDateTime(iso, { hour12: hour12() })
}
