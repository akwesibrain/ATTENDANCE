/**
 * Africa/Accra time helpers for the browser. The rules live in the shared
 * module; this file adds the 12/24-hour display preference from Settings.
 */

import { uses24HourClock } from '../services/backend/cache'
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

/** Settings → General: 12-hour or 24-hour clock. */
function hour12() {
  return !uses24HourClock()
}

/** "9:05 AM" in Accra time, or '—'. */
export function formatAccraTime(iso) {
  return formatTime(iso, { hour12: hour12() })
}

/** "9 Nov 2026, 9:05 AM" in Accra time, or '—'. */
export function formatAccraDateTime(iso) {
  return formatDateTime(iso, { hour12: hour12() })
}
