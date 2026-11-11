/**
 * Builds one attendance record per employee per day from stored facts, and
 * validates corrections and manual entries against those records. Shared by the
 * browser and the server.
 *
 * Records are always derived, never stored, so a new holiday, correction or
 * settings version is reflected the next time they are built.
 *
 * The facts come in through a context (see createRecordContext). Nothing here
 * reads browser storage or the database.
 */

import { accraDateKey, accraIso, accraMidnightMs, accraTodayKey } from './accraTime.js'
import { DEFAULT_SCHEDULE, DIGITAL_GO_LIVE_DATE, isShiftDay } from './attendanceRules.js'
import { holidayNameFor } from './holidays.js'
import { timeToMinutes } from './overtime.js'

export const VERIFICATIONS_PER_SHIFT = 3

export const CORRECTION_REASONS = [
  'Forgot to clock in',
  'Forgot to clock out',
  'Device or system failure',
  'Incorrect time recorded',
  'Authorised off-site work',
  'Historical notebook entry',
  'Other',
]

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NOT_AVAILABLE = { status: 'not-available', label: 'Not available' }

export function recordKey(employeeId, dateKey) {
  return `${employeeId}:${dateKey}`
}

export function shiftWindowMinutes(shift) {
  const start = timeToMinutes(shift.startTime)
  let end = timeToMinutes(shift.endTime)
  if (end <= start) end += 1440 // overnight: end is next day
  return { start, end, span: end - start }
}

export function formatWorkingDays(days) {
  if (!Array.isArray(days) || days.length === 0) return '—'
  const sorted = days.slice().sort((a, b) => a - b)
  const isConsecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (isConsecutive && sorted.length > 1) {
    return `${DAY_NAMES[sorted[0]]} to ${DAY_NAMES[sorted[sorted.length - 1]]}`
  }
  return sorted.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ')
}

/**
 * The first day attendance counts for an employee: the later of the date HR
 * says they joined and the date they registered.
 */
export function employmentStartFor(joinedOn, registeredAt) {
  const registered = registeredAt ? accraDateKey(new Date(registeredAt)) : null
  return [joinedOn, registered].filter(Boolean).sort().pop() ?? null
}

/* --------------------------------------------------------------------------
 * Schedule: the company's standard hours in force on a date
 * ------------------------------------------------------------------------ */

function resolveSchedule(hours) {
  const breakStartTime = hours.breakMinutes > 0 ? hours.breakStart : null
  const graceMinutes = Math.max(0, timeToMinutes(hours.lateAfter) - timeToMinutes(hours.startTime))
  const { start, end } = shiftWindowMinutes(hours)
  let breakStart = breakStartTime ? timeToMinutes(breakStartTime) : null
  let breakEnd = breakStart != null ? breakStart + hours.breakMinutes : null
  if (breakStart != null && breakStart < start) {
    breakStart += 1440
    breakEnd += 1440
  }
  return {
    assigned: false,
    name: DEFAULT_SCHEDULE.name,
    startTime: hours.startTime,
    endTime: hours.endTime,
    startMin: start,
    endMin: end,
    overnight: end > 1440,
    graceMinutes,
    breakStart,
    breakEnd,
    workingDays: hours.workingDays,
    workingDaysLabel: formatWorkingDays(hours.workingDays),
  }
}

/* --------------------------------------------------------------------------
 * Context
 * ------------------------------------------------------------------------ */

/**
 * @param {object} facts
 * @param {Array} facts.events attendance events: { staffId, date, type, time, reason }
 * @param {object} facts.corrections recordKey -> { manualType, entryMethod, clockIn, clockOut, history }
 * @param {Array} facts.customHolidays [{ date, name }]
 * @param {Array} facts.leaves [{ employeeId, leaveType, startDate, endDate, status }]
 * @param {Map} facts.shopsById shopId -> shop
 * @param {function} facts.hoursFor (companyId, dateKey) -> working hours in force, with effectiveFrom
 * @param {function} facts.attendanceRulesFor (dateKey) -> attendance rules in force
 * @param {function} [facts.smsDay] (emp, dateKey) -> { events, checkInTime?, checkOutTime? } or null
 * @param {Date} [facts.now]
 */
export function createRecordContext(facts) {
  const now = facts.now ?? new Date()
  const eventIndex = new Map()
  facts.events.forEach((e) => {
    const key = recordKey(e.staffId, e.date)
    const entry = eventIndex.get(key) ?? {}
    if (e.type === 'check-in' && !entry.checkIn) entry.checkIn = e
    if (e.type === 'check-out' && !entry.checkOut) entry.checkOut = e
    if (e.type === 'face-lockout' && !entry.lockout) entry.lockout = e
    eventIndex.set(key, entry)
  })
  const scheduleCache = new Map()
  return {
    ...facts,
    today: accraDateKey(now),
    nowMs: now.getTime(),
    eventIndex,
    schedule(companyId, dateKey) {
      const hours = facts.hoursFor(companyId, dateKey)
      const key = `${companyId}:${hours.effectiveFrom}`
      if (!scheduleCache.has(key)) scheduleCache.set(key, resolveSchedule(hours))
      return scheduleCache.get(key)
    },
  }
}

function leaveOn(leaves, employeeId, dateKey, status) {
  return (
    leaves.find(
      (l) => l.employeeId === employeeId && l.status === status && dateKey >= l.startDate && dateKey <= l.endDate,
    ) ?? null
  )
}

/* --------------------------------------------------------------------------
 * Captured attendance
 * ------------------------------------------------------------------------ */

function emptyCapture() {
  return {
    source: null,
    clockIn: null,
    clockOut: null,
    clockInUnknown: false,
    clockOutUnknown: false,
    presentMarked: false,
    faceLockoutReason: null,
    checkInSite: null,
    checkOutSite: null,
    missingEntry: false,
    smsEvents: [],
    scanEvents: [],
    face: { status: 'none', label: 'No verification recorded' },
    gps: { status: 'none', label: 'No verification recorded' },
    distanceFromShop: null,
    gpsAccuracy: null,
    notes: [],
  }
}

/** Face check-in kiosk. Events are only recorded after a face match. */
function captureDigital(emp, dateKey, ctx) {
  const c = emptyCapture()
  const entry = ctx.eventIndex.get(recordKey(emp.employeeId, dateKey))
  if (!entry) return c
  if (entry.checkIn) {
    c.source = 'digital'
    c.clockIn = entry.checkIn.time
    c.clockOut = entry.checkOut?.time ?? null
    c.face = { status: 'passed', label: 'Matched at clock-in face scan' }
    const site = (event) => (event?.displayId ? ctx.displayNames?.get(event.displayId) ?? 'a workplace display' : null)
    c.checkInSite = site(entry.checkIn)
    c.checkOutSite = site(entry.checkOut)
    c.gps = c.checkInSite
      ? { status: 'passed', label: `At the workplace — scanned the QR code at ${c.checkInSite}` }
      : { status: 'not-captured', label: 'Not captured — no workplace QR code was scanned' }
    const outcome = (where) => (where ? `Face matched · QR code at ${where}` : 'Face matched')
    c.scanEvents.push({ at: entry.checkIn.time, label: 'Clock-in face scan', outcome: outcome(c.checkInSite) })
    if (entry.checkOut) c.scanEvents.push({ at: entry.checkOut.time, label: 'Clock-out face scan', outcome: outcome(c.checkOutSite) })
  }
  if (entry.lockout) {
    c.faceLockoutReason = entry.lockout.reason
    c.scanEvents.push({ at: entry.lockout.time, label: 'Face verification attempts', outcome: 'Failed — kiosk locked for the day' })
  }
  return c
}

/** Adds SMS verification results for field staff to what the kiosk captured. */
function addSmsVerification(c, day) {
  if (!day) return c
  if (!c.clockIn && day.checkInTime) {
    c.clockIn = day.checkInTime
    c.clockOut = day.checkOutTime ?? null
  }
  c.smsEvents = day.events ?? []
  if (!c.source && (c.clockIn || c.smsEvents.length)) c.source = 'sms-verification'
  if (!c.smsEvents.length) return c

  const responded = c.smsEvents.filter((e) => e.respondedAt)
  if (responded.length) {
    const failed = responded.filter((e) => e.faceVerificationStatus === 'failed').length
    c.face = failed
      ? { status: 'failed', label: `Failed on ${failed} of ${responded.length} responses` }
      : { status: 'passed', label: `Passed on ${responded.length} of ${responded.length} responses` }
  } else {
    c.face = { status: 'pending', label: 'No response received yet' }
  }

  const withGps = responded.filter((e) => e.gpsVerificationStatus !== 'pending')
  const latestGps = withGps[withGps.length - 1]
  if (latestGps) {
    const labels = {
      passed: 'Inside the assigned shop geofence',
      failed: 'Outside the assigned shop geofence',
      unavailable: 'Location unavailable from the device',
      'not-required': 'Location check not required',
    }
    c.gps = { status: latestGps.gpsVerificationStatus, label: labels[latestGps.gpsVerificationStatus] }
    c.distanceFromShop = latestGps.distanceFromShop
    c.gpsAccuracy = latestGps.gpsAccuracy
  } else {
    c.gps = { status: 'pending', label: 'No location received yet' }
  }
  return c
}

/**
 * Before digital go-live there is no system record. Without an HR manual entry
 * a working day is Unknown, never Absent.
 */
function captureBeforeGoLive(workday) {
  const c = emptyCapture()
  c.face = { ...NOT_AVAILABLE, label: 'Not available — before digital attendance' }
  c.gps = { ...NOT_AVAILABLE, label: 'Not available — before digital attendance' }
  if (workday) {
    c.missingEntry = true
    c.notes.push('No record has been entered for this date. It is Unknown and is not treated as an absence.')
  }
  return c
}

function smsVerification(events, hasAttendance, shiftEnded) {
  if (!hasAttendance) return events.length ? 'review' : 'none'
  if (events.some((e) => e.result === 'failed-face' || e.result === 'outside-shop')) return 'failed'
  if (events.some((e) => ['missed', 'sms-failed', 'gps-unavailable'].includes(e.result))) return 'review'
  if (events.length < VERIFICATIONS_PER_SHIFT) return shiftEnded ? 'review' : 'pending'
  return 'verified'
}

function breakOverlapMinutes(schedule, dateKey, inMs, outMs) {
  if (schedule.breakStart == null || schedule.breakEnd == null) return 0
  const midnight = accraMidnightMs(dateKey)
  const bStart = midnight + schedule.breakStart * 60000
  const bEnd = midnight + schedule.breakEnd * 60000
  return Math.max(0, Math.min(outMs, bEnd) - Math.max(inMs, bStart)) / 60000
}

/* --------------------------------------------------------------------------
 * Record builder
 * ------------------------------------------------------------------------ */

export function buildRecord(emp, dateKey, ctx) {
  const schedule = ctx.schedule(emp.companyId, dateKey)
  const shop = emp.shopId ? ctx.shopsById.get(emp.shopId) ?? null : null
  const holidayName = holidayNameFor(dateKey, ctx.customHolidays)
  const workday = isShiftDay(schedule.workingDays, dateKey) && !holidayName
  const leave = leaveOn(ctx.leaves, emp.employeeId, dateKey, 'approved')
  const pendingLeave = leave ? null : leaveOn(ctx.leaves, emp.employeeId, dateKey, 'pending')
  const isToday = dateKey === ctx.today
  const midnight = accraMidnightMs(dateKey)
  const startMs = midnight + schedule.startMin * 60000
  const endMs = midnight + schedule.endMin * 60000
  const shiftStarted = !isToday || ctx.nowMs >= startMs
  const shiftEnded = !isToday || ctx.nowMs >= endMs
  const clockOutClosed = !isToday || ctx.nowMs >= endMs + ctx.attendanceRulesFor(dateKey).clockOutWindowMinutes * 60000

  let captured
  if (dateKey < DIGITAL_GO_LIVE_DATE) captured = captureBeforeGoLive(workday)
  else {
    captured = captureDigital(emp, dateKey, ctx)
    if (emp.isFieldRole && ctx.smsDay) addSmsVerification(captured, ctx.smsDay(emp, dateKey))
  }

  const notes = captured.notes.slice()
  const correction = ctx.corrections[recordKey(emp.employeeId, dateKey)] ?? null

  let { clockIn, clockOut, clockInUnknown, clockOutUnknown } = captured
  let source = captured.source
  let manualType = null
  if (correction) {
    manualType = correction.manualType
    clockIn = correction.clockIn
    clockOut = correction.clockOut
    clockInUnknown = false
    clockOutUnknown = false
    source = 'hr-correction'
  }

  const hasAttendance = Boolean(clockIn) || (!correction && captured.presentMarked && clockInUnknown)

  // Arrival and lateness (against the start time plus the grace period).
  let arrivalDiffMinutes = null
  let isLate = false
  let lateMinutes = 0
  const lateUnknown = hasAttendance && !clockIn
  if (clockIn) {
    arrivalDiffMinutes = Math.round((Date.parse(clockIn) - startMs) / 60000)
    if (workday && arrivalDiffMinutes > schedule.graceMinutes) {
      isLate = true
      lateMinutes = arrivalDiffMinutes
    }
  }

  const restDayWork = hasAttendance && !workday
  const atWork = Boolean(clockIn) && !clockOut && !clockOutUnknown && isToday && !clockOutClosed

  let status
  if (hasAttendance) {
    if (clockIn && !clockOut && !clockOutUnknown && clockOutClosed) status = 'incomplete'
    else status = isLate ? 'late' : 'present'
    if (leave && workday) notes.push('Attendance was recorded on a day of approved leave.')
    if (restDayWork) {
      notes.push(holidayName ? `Worked on a public holiday (${holidayName}).` : 'Worked on a weekend or rest day.')
    }
  } else if (!workday) {
    // Holidays and weekends are not working days: never absences.
    status = holidayName ? 'holiday' : 'rest-day'
  } else if (leave) {
    status = 'on-leave'
  } else if (captured.missingEntry) {
    status = 'unknown'
  } else if (shiftEnded) {
    status = 'absent'
  } else {
    status = shiftStarted ? 'awaiting' : 'scheduled'
  }
  if (captured.faceLockoutReason) notes.push(captured.faceLockoutReason)
  if (pendingLeave) {
    notes.push(`A ${pendingLeave.leaveType.toLowerCase()} request for this date is still pending, so it is not counted as leave.`)
  }

  let verification
  if (manualType === 'created') verification = 'manual'
  else if (!hasAttendance && captured.smsEvents.length === 0) verification = 'none'
  else if (captured.smsEvents.length > 0) verification = smsVerification(captured.smsEvents, hasAttendance, shiftEnded)
  else if (captured.source === 'digital') verification = hasAttendance ? 'verified' : 'failed'
  else verification = 'none'

  if (captured.smsEvents.some((e) => e.result === 'missed')) {
    notes.push('A missed SMS verification is an exception for HR review. It does not make the employee absent.')
  }
  if (!hasAttendance && captured.smsEvents.length > 0) {
    notes.push('SMS verification activity exists without a clock-in. Review required.')
  }

  let face = captured.face
  let gps = captured.gps
  if (manualType === 'created') {
    face = { ...NOT_AVAILABLE, label: 'No verification — entered manually by HR' }
    gps = { ...NOT_AVAILABLE, label: 'No verification — entered manually by HR' }
  }

  let workingMinutes = null
  if (clockIn && clockOut) {
    const inMs = Date.parse(clockIn)
    const outMs = Date.parse(clockOut)
    const gross = (outMs - inMs) / 60000
    if (gross > 0) workingMinutes = Math.round(gross - breakOverlapMinutes(schedule, dateKey, inMs, outMs))
  }

  return {
    key: recordKey(emp.employeeId, dateKey),
    employeeId: emp.employeeId,
    fullName: emp.fullName,
    companyId: emp.companyId,
    companyName: emp.companyName,
    position: emp.position,
    phone: emp.phone,
    paymentMethod: emp.paymentMethod,
    photo: emp.photo,
    employmentStart: emp.employmentStart,
    employmentEnd: emp.employmentEnd ?? null,
    joinedOn: emp.joinedOn ?? null,
    isFieldRole: emp.isFieldRole,
    shopId: emp.shopId,
    shop,
    schedule,
    date: dateKey,
    isToday,
    workday,
    holidayName,
    expectedStart: new Date(startMs).toISOString(),
    expectedEnd: new Date(endMs).toISOString(),
    clockIn,
    clockOut,
    clockInUnknown,
    clockOutUnknown,
    hasAttendance,
    workingMinutes,
    arrivalDiffMinutes,
    isLate,
    lateMinutes,
    lateUnknown,
    atWork,
    restDayWork,
    status,
    verification,
    source,
    manualType,
    entryMethod: correction?.entryMethod ?? null,
    original: {
      source: captured.source,
      clockIn: captured.clockIn,
      clockOut: captured.clockOut,
      clockInUnknown: captured.clockInUnknown,
      clockOutUnknown: captured.clockOutUnknown,
      presentMarked: captured.presentMarked,
    },
    corrections: correction ? correction.history.slice().reverse() : [],
    smsEvents: captured.smsEvents,
    scanEvents: captured.scanEvents,
    face,
    gps,
    distanceFromShop: captured.distanceFromShop,
    gpsAccuracy: captured.gpsAccuracy,
    leave,
    pendingLeave,
    faceLockoutReason: captured.faceLockoutReason,
    checkInSite: captured.checkInSite ?? null,
    checkOutSite: captured.checkOutSite ?? null,
    historical: null,
    notes,
  }
}

/** Whether a date falls outside an employee's employment. */
export function outsideEmployment(emp, dateKey) {
  return Boolean((emp.employmentStart && dateKey < emp.employmentStart) || (emp.employmentEnd && dateKey > emp.employmentEnd))
}

/**
 * Records for a roster over a list of dates. Future dates are skipped, and days
 * before an employee started or after they left are not listed unless HR
 * entered a record.
 */
export function buildRecords(roster, dates, ctx) {
  const records = []
  dates.forEach((dateKey) => {
    if (dateKey > ctx.today) return
    roster.forEach((emp) => {
      if (outsideEmployment(emp, dateKey) && !ctx.corrections[recordKey(emp.employeeId, dateKey)]) return
      records.push(buildRecord(emp, dateKey, ctx))
    })
  })
  return records.sort((a, b) => b.date.localeCompare(a.date) || a.fullName.localeCompare(b.fullName))
}

/* --------------------------------------------------------------------------
 * Corrections and manual entries
 * ------------------------------------------------------------------------ */

export function correctionTimes(input, record) {
  const inMin = timeToMinutes(input.clockInTime)
  const clockIn = accraIso(input.date, inMin)
  let clockOut = null
  let outError = null
  if (input.clockOutTime) {
    let outMin = timeToMinutes(input.clockOutTime)
    if (outMin <= inMin) {
      if (record?.schedule.overnight) outMin += 1440
      else outError = 'Clock-out must be later than clock-in.'
    }
    clockOut = accraIso(input.date, outMin)
  }
  return { clockIn, clockOut, outError }
}

/**
 * Validate a correction against the current record.
 * @returns {object} field -> message (empty when valid).
 */
export function validateCorrection(input, record, { minRemarks, today = accraTodayKey(), nowMs = Date.now() }) {
  const errors = {}
  if (!input.employeeId) errors.employeeId = 'Choose an employee.'
  if (!input.date) errors.date = 'Choose the attendance date.'
  else if (input.date > today) errors.date = 'Attendance cannot be recorded for a future date.'
  if (input.employeeId && input.date && input.date <= today && !record) {
    errors.employeeId = 'This employee has no attendance record on the chosen date.'
  }
  if (record?.employmentStart && input.date < record.employmentStart && !record.historical) {
    errors.date = 'This date is before the employee was registered.'
  }
  if (record?.employmentEnd && input.date > record.employmentEnd) {
    errors.date = 'This date is after the employee left the company.'
  }
  if (record?.status === 'on-leave') {
    errors.date = 'The employee is on approved leave on this date. Change the leave record instead.'
  }
  if (!TIME_PATTERN.test(input.clockInTime ?? '')) errors.clockInTime = 'Enter the corrected clock-in time.'
  if (input.clockOutTime && !TIME_PATTERN.test(input.clockOutTime)) {
    errors.clockOutTime = 'Enter a valid clock-out time, or leave it empty.'
  }
  if (!input.reason || !CORRECTION_REASONS.includes(input.reason)) errors.reason = 'Choose a reason for the correction.'
  if ((input.remarks ?? '').trim().length < minRemarks) errors.remarks = `Add supporting remarks (at least ${minRemarks} characters).`

  if (!errors.clockInTime && !errors.clockOutTime && !errors.date && input.date) {
    const { clockIn, clockOut, outError } = correctionTimes(input, record)
    if (outError) errors.clockOutTime = outError
    if (Date.parse(clockIn) > nowMs) errors.clockInTime = 'Clock-in cannot be in the future.'
    if (clockOut && Date.parse(clockOut) > nowMs) errors.clockOutTime = 'Clock-out cannot be in the future.'
    if (record && !outError && clockIn === record.clockIn && (clockOut ?? null) === (record.clockOut ?? null)) {
      errors.form = 'These times match the current record, so there is nothing to change.'
    }
  }
  return errors
}

/**
 * How HR should read a record's origin.
 * @returns {{ kind: 'manual'|'system', label: string, detail: string } | null}
 */
export function recordOrigin(r) {
  if (!r || !r.source) return null
  if (r.source === 'hr-correction') {
    if (r.manualType === 'created') return { kind: 'manual', label: 'Manual Entry', detail: 'Entered by HR' }
    if (r.entryMethod === 'manual-entry') return { kind: 'manual', label: 'Manual Entry', detail: 'Replaced an earlier record after HR review' }
    return { kind: 'system', label: 'System Recorded', detail: 'Times corrected by HR' }
  }
  if (r.source === 'digital') return { kind: 'system', label: 'System Recorded', detail: 'Face check-in' }
  if (r.source === 'sms-verification') return { kind: 'system', label: 'System Recorded', detail: 'Clock-in with SMS verification' }
  return null
}

function entryState(record) {
  if (!record) return 'blocked'
  if (record.status === 'on-leave') return 'blocked'
  if (!record.hasAttendance) return 'new'
  return recordOrigin(record)?.kind === 'system' ? 'exists-system' : 'exists-manual'
}

/**
 * Check manual entries for one employee without saving anything. Each row
 * comes back with its current record, state and any errors.
 * @param {object|null} emp the roster entry, already checked for company access
 * @returns rows with state: 'new' | 'exists-system' | 'exists-manual' | 'blocked'
 */
export function previewManualEntries(emp, entries, ctx) {
  const seen = new Map()
  entries.forEach((e) => seen.set(e.date, (seen.get(e.date) ?? 0) + 1))
  return entries.map((e) => {
    const errors = {}
    if (!emp) errors.form = 'Choose an employee.'
    if (!e.date || !DATE_PATTERN.test(e.date)) errors.date = 'Choose a date.'
    else if (e.date > ctx.today) errors.date = 'Future dates cannot be entered.'
    else if (seen.get(e.date) > 1) errors.date = 'This date is listed more than once.'
    const record = emp && !errors.date ? buildRecord(emp, e.date, ctx) : null
    if (record?.status === 'on-leave') errors.date = 'The employee is on approved leave on this date.'
    if (!TIME_PATTERN.test(e.clockInTime ?? '')) errors.clockInTime = 'Enter the clock-in time.'
    if (e.clockOutTime && !TIME_PATTERN.test(e.clockOutTime)) errors.clockOutTime = 'Enter a valid clock-out time, or leave it empty.'
    if (!errors.date && !errors.clockInTime && !errors.clockOutTime && record) {
      const { clockIn, clockOut, outError } = correctionTimes(e, record)
      if (outError) errors.clockOutTime = outError
      if (Date.parse(clockIn) > ctx.nowMs) errors.clockInTime = 'Clock-in cannot be in the future.'
      if (clockOut && Date.parse(clockOut) > ctx.nowMs) errors.clockOutTime = 'Clock-out cannot be in the future.'
    }
    if ((e.remarks ?? '').length > 300) errors.remarks = 'Keep remarks under 300 characters.'
    return { ...e, record, state: errors.date ? 'blocked' : entryState(record), errors }
  })
}
