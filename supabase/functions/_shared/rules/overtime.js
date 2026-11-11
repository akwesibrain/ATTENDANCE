/**
 * Overtime for one attendance record, shared by the browser and the server.
 *
 *   Saturday, Sunday and holidays: the whole time worked is overtime
 *     (clock-in to clock-out).
 *   Monday to Friday: only time after the overtime start counts.
 *   Pay = (minutes ÷ 60) × the hourly rate in force on that day, to the pesewa.
 *
 * Excluded, with a reason for HR: approved leave, no clock-out, unknown times
 * and invalid times. VAT is a separate setting and is never deducted here.
 *
 * Everything that depends on stored data (the holiday name, the working hours
 * and rate in force that day) is passed in by the caller.
 */

import { dayOfWeekForKey } from './accraTime.js'

/** "17:01" → minutes after midnight. */
export function timeToMinutes(time) {
  const [h, m] = (time ?? '0:0').split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Pay for minutes at an hourly rate, to the pesewa. */
export function overtimePay(minutes, hourlyRate) {
  return Math.round(((minutes / 60) * hourlyRate) * 100) / 100
}

/** Saturday or Sunday (Africa/Accra date). */
export function isWeekendKey(dateKey) {
  return [0, 6].includes(dayOfWeekForKey(dateKey))
}

/** 'holiday' / 'weekend' (whole day is overtime) or 'after-hours' (after the overtime start). */
export const OVERTIME_KINDS = { holiday: 'Holiday', weekend: 'Weekend', 'after-hours': 'After hours' }

/** Which overtime rule applies to a date. */
export function overtimeKindFor(dateKey, holidayName) {
  if (holidayName) return 'holiday'
  return isWeekendKey(dateKey) ? 'weekend' : 'after-hours'
}

/** The instant overtime starts for a record (ISO), given the company's hours that day. */
export function overtimeThreshold(record, hours) {
  const gap = Math.max(0, timeToMinutes(hours.overtimeStart) - timeToMinutes(hours.endTime))
  return new Date(Date.parse(record.expectedEnd) + gap * 60000).toISOString()
}

/**
 * Overtime for one attendance record.
 * @param {object} record the day's attendance record
 * @param {{ rate: number, holidayName: string|null, hours: { overtimeStart: string, endTime: string } }} context
 * @returns {{ status: 'counted'|'none'|'excluded'|'skip', reason?, kind, minutes, rate, pay, threshold }}
 */
export function calculateRecordOvertime(record, { rate, holidayName, hours }) {
  const kind = overtimeKindFor(record.date, holidayName)
  const base = { kind, minutes: 0, rate, pay: 0, threshold: null }
  if (record.status === 'on-leave') return { ...base, status: 'excluded', reason: 'Approved leave' }
  if (!record.hasAttendance) return { ...base, status: 'skip' }
  if (record.status === 'incomplete') return { ...base, status: 'excluded', reason: 'Incomplete record (no clock-out)' }
  if (record.clockInUnknown || record.clockOutUnknown) return { ...base, status: 'excluded', reason: 'Unknown or unreadable time' }
  if (!record.clockIn || !record.clockOut) {
    // Still at work today: nothing to count yet.
    return { ...base, status: 'skip' }
  }
  if (Date.parse(record.clockOut) <= Date.parse(record.clockIn)) return { ...base, status: 'excluded', reason: 'Invalid times (clock-out not after clock-in)' }
  // Weekend or holiday: overtime runs from clock-in. Weekday: from the overtime start.
  const threshold = kind === 'after-hours' ? overtimeThreshold(record, hours) : record.clockIn
  const minutes = Math.max(0, Math.floor((Date.parse(record.clockOut) - Date.parse(threshold)) / 60000))
  if (!minutes) return { ...base, status: 'none', threshold }
  return { status: 'counted', kind, minutes, rate, pay: overtimePay(minutes, rate), threshold }
}
