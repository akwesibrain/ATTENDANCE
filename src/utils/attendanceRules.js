/**
 * Attendance rules for the browser. The rules live in the shared module; this
 * file binds them to the holidays currently loaded.
 */

import { holidayNameForKey } from '../services/holidayService'
import { isShiftDay } from '../../supabase/functions/_shared/rules/attendanceRules.js'

export {
  DIGITAL_GO_LIVE_DATE,
  CLOCK_OUT_GRACE_MINUTES,
  DEFAULT_SCHEDULE,
  isShiftDay,
  isFutureDateKey,
  periodForDateKey,
  periodDateKeys,
  elapsedPeriodDateKeys,
} from '../../supabase/functions/_shared/rules/attendanceRules.js'

/** The holiday name on a date key (public or set by HR), or null. */
export function holidayForKey(dateKey) {
  return holidayNameForKey(dateKey)
}

/** Whether a date is a scheduled working day: a working weekday and not a holiday. */
export function isScheduledWorkday(workingDays, dateKey) {
  return isShiftDay(workingDays, dateKey) && !holidayForKey(dateKey)
}
