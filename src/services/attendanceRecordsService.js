/**
 * ============================================================================
 * MOCK ATTENDANCE RECORDS SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * Builds one attendance record per employee per day from the data the other
 * modules already use. It does not keep a second copy of employees, shops or
 * shifts:
 *
 *   - Employees: registered employees (registrationService) plus the demo's
 *     seeded field representatives (salesMonitoringService).
 *   - Shops: the active shop assignments.
 *   - Digital attendance: face check-in / check-out events (attendanceService).
 *   - Merchandiser attendance + the three SMS verification events per working day:
 *     salesMonitoringService (only events that have already happened).
 *   - Historical attendance (before DIGITAL_GO_LIVE_DATE): ONLY approved
 *     historical import entries (historicalImportStore). Nothing simulated;
 *     days without an entry are Unknown, never Absent. Never face- or
 *     GPS-verified; missing or unreadable values Unknown.
 *   - Approved leave: leaveService.
 *   - HR corrections: stored here, with the full history of previous values.
 *
 * All verification results are SIMULATED demo data, not real biometric or GPS
 * evidence. The attendance rules live in utils/attendanceRules.js.
 *
 * Replace with real API calls once the backend contract is defined. Do NOT
 * invent endpoints here.
 * ============================================================================
 */

import { COMPANIES, getCompanyById } from '../constants/companies'
import {
  ATTENDANCE_SOURCE,
  ATTENDANCE_STATUS,
  CORRECTION_REASONS,
  VERIFICATION_STATUS,
} from '../constants/attendanceLabels'
import { canCorrectAttendance, canViewCompany, getSessionUser } from '../constants/hrUser'
import { mockListEmployees } from './registrationService'
import { mockGetAllEvents } from './attendanceService'
import {
  VERIFICATIONS_PER_SHIFT,
  mockGetRepresentativeDetail,
  mockListSalesReps,
} from './salesMonitoringService'
import { mockGetActiveAssignment, requiresShop } from './shopAssignmentService'
import { mockGetShop } from './shopsService'
import { CATEGORIES, categoryForPosition } from '../constants/employeeCategories'

const CATEGORY_LABELS = Object.fromEntries(Object.values(CATEGORIES).map((c) => [c.id, c.single]))
import {
  formatWorkingDays,
  shiftWindowMinutes,
  timeToMinutes,
} from './shiftsService'
import { getApprovedLeave, getPendingLeave } from './leaveService'
import { approvedHistoricalIndex } from './historicalImportStore'
import { attendanceRulesFor, defaultHoursFor } from './settingsService'
import {
  DEFAULT_SCHEDULE,
  DIGITAL_GO_LIVE_DATE,
  holidayForKey,
  isScheduledWorkday,
} from '../utils/attendanceRules'
import {
  accraDateKey,
  accraIso,
  accraMidnightMs,
  accraTodayKey,
  formatAccraDateTime,
  formatAccraTime,
} from '../utils/accraTime'

/** localStorage key for HR corrections and manually created records. */
const CORRECTIONS_KEY = 'mock-attendance:corrections'

const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/

/* --------------------------------------------------------------------------
 * Persistence
 * ------------------------------------------------------------------------ */

function readCorrections() {
  try {
    return JSON.parse(window.localStorage.getItem(CORRECTIONS_KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeCorrections(value) {
  try {
    window.localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(value))
  } catch {
    // Ignore — mock persistence only.
  }
}

export function recordKey(employeeId, dateKey) {
  return `${employeeId}:${dateKey}`
}

/* --------------------------------------------------------------------------
 * Roster — the same people the Employees and Monitoring modules show
 * ------------------------------------------------------------------------ */

/**
 * Everyone whose attendance is tracked for a company (or all companies):
 * registered employees plus the seeded field representatives, deduplicated by
 * employee ID, with their active shop assignment applied.
 */
export function listAttendanceRoster(companyId = null) {
  const companyIds = companyId ? [companyId] : COMPANIES.map((c) => c.id)
  const byId = new Map()

  mockListEmployees()
    .filter((e) => companyIds.includes(e.companyId))
    .forEach((e) => {
      const isFieldRole = requiresShop(e.position)
      byId.set(e.staffId, {
        employeeId: e.staffId,
        fullName: e.fullName,
        companyId: e.companyId,
        companyName: e.companyName,
        position: e.position,
        phone: e.phone || null,
        paymentMethod: e.paymentMethod ?? '',
        isFieldRole,
        category: categoryForPosition(e.position),
        // Only a shop that exists in the Shop Directory counts; an old branch
        // record means the employee still needs an allocated shop.
        shopId: isFieldRole
          ? [mockGetActiveAssignment(e.staffId)?.shopId, e.assignedShopId].find((id) => id && mockGetShop(id)) ?? null
          : null,
        photo: e.faceImage ?? null,
        // Attendance is counted from the later of the HR joining date and the
        // registration date, so no day before either can become an absence.
        employmentStart: [e.joinedOn, e.registeredAt ? accraDateKey(new Date(e.registeredAt)) : null].filter(Boolean).sort().pop() ?? null,
        joinedOn: e.joinedOn ?? (e.registeredAt ? accraDateKey(new Date(e.registeredAt)) : null),
        kind: 'registered',
      })
    })

  companyIds.forEach((cid) => {
    mockListSalesReps(cid).forEach((r) => {
      if (byId.has(r.employeeId)) return
      byId.set(r.employeeId, {
        employeeId: r.employeeId,
        fullName: r.fullName,
        companyId: r.companyId,
        companyName: getCompanyById(r.companyId)?.name ?? '',
        position: r.position,
        phone: r.phoneNumber,
        paymentMethod: '',
        isFieldRole: true,
        category: categoryForPosition(r.position),
        shopId: r.assignedShopId,
        photo: r.profileImage,
        employmentStart: null,
        kind: 'seeded-rep',
      })
    })
  })

  return Array.from(byId.values()).sort((a, b) => a.fullName.localeCompare(b.fullName))
}

/* --------------------------------------------------------------------------
 * Schedule: the company's standard working hours (there are no shifts)
 * ------------------------------------------------------------------------ */

/**
 * Standard hours (Settings → Working Hours) for every employee, for
 * their company on a date. Effective-dated, so a later change never alters
 * earlier days. The grace period comes from the attendance rules on that date.
 */
function defaultScheduleFor(companyId, dateKey) {
  const h = defaultHoursFor(companyId, dateKey)
  const breakEnd = h.breakMinutes > 0
    ? (() => { const m = timeToMinutes(h.breakStart) + h.breakMinutes; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })()
    : null
  return {
    ...DEFAULT_SCHEDULE,
    startTime: h.startTime,
    endTime: h.endTime,
    workingDays: h.workingDays,
    breakStart: h.breakMinutes > 0 ? h.breakStart : null,
    breakEnd,
    // Clocking in AFTER the late-coming time is late.
    graceMinutes: Math.max(0, timeToMinutes(h.lateAfter) - timeToMinutes(h.startTime)),
  }
}

// Every worker follows the company's standard working hours (no shifts).
function resolveSchedule(companyId, dateKey) {
  const base = defaultScheduleFor(companyId, dateKey)
  const { start, end } = shiftWindowMinutes(base)
  let breakStart = base.breakStart ? timeToMinutes(base.breakStart) : null
  let breakEnd = base.breakEnd ? timeToMinutes(base.breakEnd) : null
  // Overnight shift: a break before the start time happens after midnight.
  if (breakStart != null && breakStart < start) {
    breakStart += 1440
    breakEnd += 1440
  }
  return {
    assigned: false,
    name: DEFAULT_SCHEDULE.name,
    startTime: base.startTime,
    endTime: base.endTime,
    startMin: start,
    endMin: end,
    overnight: end > 1440,
    graceMinutes: Number(base.graceMinutes) || 0,
    breakStart,
    breakEnd,
    workingDays: base.workingDays,
    workingDaysLabel: formatWorkingDays(base.workingDays),
  }
}

/* --------------------------------------------------------------------------
 * Captured attendance by source
 * ------------------------------------------------------------------------ */

const NOT_AVAILABLE = { status: 'not-available', label: 'Not available' }

function emptyCapture() {
  return {
    source: null,
    clockIn: null,
    clockOut: null,
    clockInUnknown: false,
    clockOutUnknown: false,
    presentMarked: false,
    explicitAbsentReason: null,
    missingEntry: false,
    smsEvents: [],
    scanEvents: [],
    breaks: [],
    visits: [],
    face: { status: 'none', label: 'No verification recorded' },
    gps: { status: 'none', label: 'No verification recorded' },
    distanceFromShop: null,
    gpsAccuracy: null,
    notes: [],
  }
}

function buildEventIndex() {
  const index = new Map()
  mockGetAllEvents().forEach((e) => {
    const key = recordKey(e.staffId, e.date)
    const entry = index.get(key) ?? {}
    if (e.type === 'check-in' && !entry.checkIn) entry.checkIn = e
    if (e.type === 'check-out' && !entry.checkOut) entry.checkOut = e
    if (e.type === 'absent' && !entry.absent) entry.absent = e
    if (e.type === 'break-start' || e.type === 'break-end') (entry.breakEvents ??= []).push(e)
    if (e.type === 'visit') (entry.visits ??= []).push(e)
    index.set(key, entry)
  })
  return index
}

/** Face check-in kiosk. Events are only recorded after a face match. */
function captureDigital(emp, dateKey, eventIndex) {
  const c = emptyCapture()
  const entry = eventIndex.get(recordKey(emp.employeeId, dateKey))
  if (!entry) return c
  if (entry.checkIn) {
    c.source = 'digital'
    c.clockIn = entry.checkIn.time
    c.clockOut = entry.checkOut?.time ?? null
    c.face = { status: 'passed', label: 'Matched at clock-in face scan (simulated)' }
    c.gps = {
      status: 'not-captured',
      label: 'Not captured — the check-in kiosk does not record location',
    }
    c.scanEvents.push({ at: entry.checkIn.time, label: 'Clock-in face scan', outcome: 'Face matched' })
    if (entry.checkOut) {
      c.scanEvents.push({ at: entry.checkOut.time, label: 'Clock-out face scan', outcome: 'Face matched' })
    }
    // Warehouse breaks: each "going on break" scan opens a break; the next
    // "back from break" scan closes it. A missing return stays open (null).
    ;(entry.breakEvents ?? []).slice().sort((a, b) => a.time.localeCompare(b.time)).forEach((e) => {
      if (e.type === 'break-start') c.breaks.push({ start: e.time, end: null })
      else {
        const open = c.breaks.find((b) => !b.end)
        if (open) open.end = e.time
      }
      c.scanEvents.push({ at: e.time, label: e.type === 'break-start' ? 'Break departure scan' : 'Break return scan', outcome: 'Face matched' })
    })
    c.visits = (entry.visits ?? []).slice().sort((a, b) => a.time.localeCompare(b.time))
    c.visits.forEach((v) => c.scanEvents.push({ at: v.time, label: 'Outlet visit scan', outcome: 'Face matched' }))
  }
  if (entry.absent) {
    c.source = c.source ?? 'digital'
    c.explicitAbsentReason = entry.absent.reason
    c.scanEvents.push({ at: entry.absent.time, label: 'Face verification attempts', outcome: 'Failed — attempt limit reached' })
  }
  return c
}

/** Seeded field representatives: clock times + SMS verification events. */
function captureSms(emp, dateKey) {
  const c = emptyCapture()
  const detail = mockGetRepresentativeDetail(emp.employeeId, dateKey)
  const day = detail?.day
  if (!day) return c
  c.clockIn = day.checkInTime
  c.clockOut = day.checkOutTime
  c.smsEvents = day.events
  if (c.clockIn || c.smsEvents.length) c.source = 'sms-verification'

  const responded = day.events.filter((e) => e.respondedAt)
  if (responded.length) {
    const failed = responded.filter((e) => e.faceVerificationStatus === 'failed').length
    c.face = failed
      ? { status: 'failed', label: `Failed on ${failed} of ${responded.length} responses (simulated)` }
      : { status: 'passed', label: `Passed on ${responded.length} of ${responded.length} responses (simulated)` }
  } else if (day.events.length) {
    c.face = { status: 'pending', label: 'No response received yet' }
  }

  const withGps = responded.filter((e) => e.gpsVerificationStatus !== 'pending')
  const latestGps = withGps[withGps.length - 1]
  if (latestGps) {
    const map = {
      passed: 'Inside the assigned shop geofence (simulated)',
      failed: 'Outside the assigned shop geofence (simulated)',
      unavailable: 'Location unavailable from the device',
    }
    c.gps = { status: latestGps.gpsVerificationStatus, label: map[latestGps.gpsVerificationStatus] }
    c.distanceFromShop = latestGps.distanceFromShop
    c.gpsAccuracy = latestGps.gpsAccuracy
  } else if (day.events.length) {
    c.gps = { status: 'pending', label: 'No location received yet' }
  }
  return c
}

/**
 * Attendance before digital go-live comes ONLY from approved historical
 * imports (notebook entries transcribed by HR and approved by a reviewer).
 * Nothing is simulated or guessed:
 *   - no approved entry → Unknown ("no historical record"), never Absent;
 *   - missing or unreadable times → Unknown;
 *   - never face-, GPS-, QR-verified or digitally clocked.
 */
function captureHistorical(emp, dateKey, schedule, workday, historicalIndex) {
  const c = emptyCapture()
  c.face = { ...NOT_AVAILABLE, label: 'Not available — historical manually recorded entry' }
  c.gps = { ...NOT_AVAILABLE, label: 'Not available — historical manually recorded entry' }
  const hit = historicalIndex.get(recordKey(emp.employeeId, dateKey))
  if (!hit) {
    if (workday) {
      c.missingEntry = true
      c.notes.push('No historical record has been imported for this date. It is Unknown and is not treated as an absence.')
    }
    return c
  }
  const { record: e, batch } = hit
  c.source = 'historical'
  c.historical = {
    batchId: batch.batchId,
    batchName: batch.name,
    recordId: e.recordId,
    sourceDescription: batch.sourceDescription,
    notebookReference: batch.notebookReference,
    pageReference: e.pageReference || null,
    attachmentName: batch.attachment?.name ?? null,
    rawName: e.rawName,
    rawEmployeeId: e.rawEmployeeId || null,
    rawPhone: e.rawPhone || null,
    recordedStatus: e.recordedStatus,
    arrival: { time: e.arrivalTime || null, unreadable: Boolean(e.arrivalUnreadable), asWritten: e.arrivalAsWritten || null },
    departure: { time: e.departureTime || null, unreadable: Boolean(e.departureUnreadable), asWritten: e.departureAsWritten || null },
    remarks: e.remarks || null,
    match: e.match,
    createdBy: batch.createdBy?.name ?? null,
    importedBy: batch.submittedBy?.name ?? batch.createdBy?.name ?? null,
    importedAt: batch.submittedAt ?? batch.createdAt,
    approvedBy: e.review?.by ?? null,
    approvedAt: e.review?.at ?? null,
  }
  if (e.recordedStatus === 'absent') {
    c.explicitAbsentReason = 'Recorded absent in the original notebook.'
    return c
  }
  if (e.recordedStatus === 'leave') {
    c.recordedLeave = true
    c.notes.push('Leave is recorded in the original notebook.')
    return c
  }
  if (e.recordedStatus === 'unclear') {
    c.missingEntry = true
    c.notes.push('The notebook entry for this date is unclear, so the status is Unknown.')
    return c
  }
  c.presentMarked = true
  if (e.arrivalTime) c.clockIn = accraIso(dateKey, timeToMinutes(e.arrivalTime))
  else {
    c.clockInUnknown = true
    c.notes.push(e.arrivalUnreadable ? 'The arrival time in the notebook is unreadable.' : 'No arrival time is written in the notebook.')
  }
  if (e.departureTime) c.clockOut = accraIso(dateKey, timeToMinutes(e.departureTime))
  else {
    c.clockOutUnknown = true
    c.notes.push(e.departureUnreadable ? 'The departure time in the notebook is unreadable.' : 'No departure time is written in the notebook.')
  }
  return c
}

/* --------------------------------------------------------------------------
 * Record builder
 * ------------------------------------------------------------------------ */

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

function createContext() {
  const scheduleCache = new Map()
  const now = new Date()
  return {
    today: accraDateKey(now),
    nowMs: now.getTime(),
    eventIndex: buildEventIndex(),
    corrections: readCorrections(),
    historicalIndex: approvedHistoricalIndex(),
    schedule(companyId, dateKey) {
      // Standard hours depend on company + the settings version in force that day.
      const key = `${companyId}:${defaultHoursFor(companyId, dateKey).effectiveFrom}`
      if (!scheduleCache.has(key)) scheduleCache.set(key, resolveSchedule(companyId, dateKey))
      return scheduleCache.get(key)
    },
  }
}

function buildRecord(emp, dateKey, ctx) {
  const schedule = ctx.schedule(emp.companyId, dateKey)
  const shop = emp.shopId ? mockGetShop(emp.shopId) : null
  const holidayName = holidayForKey(dateKey)
  const workday = isScheduledWorkday(schedule.workingDays, dateKey)
  const leave = getApprovedLeave(emp.employeeId, dateKey)
  const pendingLeave = leave ? null : getPendingLeave(emp.employeeId, dateKey)
  const isToday = dateKey === ctx.today
  const midnight = accraMidnightMs(dateKey)
  const startMs = midnight + schedule.startMin * 60000
  const endMs = midnight + schedule.endMin * 60000
  const shiftStarted = !isToday || ctx.nowMs >= startMs
  const shiftEnded = !isToday || ctx.nowMs >= endMs
  const clockOutClosed = !isToday || ctx.nowMs >= endMs + attendanceRulesFor(dateKey).clockOutWindowMinutes * 60000

  let captured
  if (dateKey < DIGITAL_GO_LIVE_DATE) captured = captureHistorical(emp, dateKey, schedule, workday, ctx.historicalIndex)
  else if (emp.kind === 'seeded-rep') captured = captureSms(emp, dateKey)
  else captured = captureDigital(emp, dateKey, ctx.eventIndex)

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
    if (Array.isArray(correction.breaks)) captured.breaks = correction.breaks.map((b) => ({ ...b }))
    source = 'hr-correction'
  }

  const hasAttendance =
    Boolean(clockIn) || (!correction && captured.presentMarked && clockInUnknown)

  // Arrival and lateness (against the shift start plus its grace period).
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
  const atWork =
    Boolean(clockIn) && !clockOut && !clockOutUnknown && isToday && !clockOutClosed

  let status
  if (hasAttendance) {
    if (clockIn && !clockOut && !clockOutUnknown && clockOutClosed) status = 'incomplete'
    else status = isLate ? 'late' : 'present'
    if (leave && workday) notes.push('Attendance was recorded on a day of approved leave.')
    if (restDayWork) {
      notes.push(
        holidayName
          ? `Worked on a public holiday (${holidayName}).`
          : 'Worked on a weekend or rest day.',
      )
    }
  } else if (!workday) {
    // Public holidays and rest days are not working days: never absences.
    status = holidayName ? 'holiday' : 'rest-day'
  } else if (leave || captured.recordedLeave) {
    status = 'on-leave'
  } else if (captured.explicitAbsentReason) {
    status = 'absent'
  } else if (captured.missingEntry) {
    status = 'unknown'
  } else if (shiftEnded) {
    status = 'absent'
  } else {
    status = shiftStarted ? 'awaiting' : 'scheduled'
  }
  if (captured.explicitAbsentReason && hasAttendance) {
    notes.push(captured.explicitAbsentReason)
  }
  if (pendingLeave) {
    notes.push(`A ${pendingLeave.leaveType.toLowerCase()} request for this date is still pending, so it is not counted as leave.`)
  }

  // Verification status.
  let verification
  if (manualType === 'created') verification = 'manual'
  else if (!hasAttendance && captured.smsEvents.length === 0) verification = 'none'
  else if (captured.source === 'historical') verification = 'not-verified'
  else if (captured.source === 'digital') verification = hasAttendance ? 'verified' : 'failed'
  else if (captured.source === 'sms-verification') {
    verification = smsVerification(captured.smsEvents, hasAttendance, shiftEnded)
  } else verification = 'none'

  if (captured.smsEvents.some((e) => e.result === 'missed')) {
    notes.push('A missed SMS verification is an exception for HR review. It does not make the employee absent.')
  }
  if (!hasAttendance && captured.smsEvents.length > 0 && captured.source === 'sms-verification') {
    notes.push('SMS verification activity exists without a clock-in. Review required.')
  }

  let face = captured.face
  let gps = captured.gps
  if (manualType === 'created') {
    face = { ...NOT_AVAILABLE, label: 'No verification — entered manually by HR' }
    gps = { ...NOT_AVAILABLE, label: 'No verification — entered manually by HR' }
  }

  // Breaks by category:
  //   Warehouse Workers       the breaks they actually scanned (or HR entered);
  //   Sales Reps, Supervisors no break at all;
  //   everyone else           the company's default break, if the work spans it.
  const category = emp.category ?? categoryForPosition(emp.position)
  const breaks = category === 'warehouse' ? captured.breaks : []
  const breakMinutes = Math.round(breaks.filter((b) => b.start && b.end).reduce((sum, b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0))
  const openBreak = breaks.find((b) => b.start && !b.end) ?? null
  const onBreak = Boolean(openBreak) && isToday && !clockOut && !clockOutClosed
  const breakIssue = openBreak && !onBreak ? 'A break return was not scanned' : null
  if (breakIssue) notes.push('A break return was not scanned. Working hours need HR review; no time is filled in automatically.')

  let workingMinutes = null
  if (clockIn && clockOut) {
    const inMs = Date.parse(clockIn)
    const outMs = Date.parse(clockOut)
    const gross = (outMs - inMs) / 60000
    if (gross > 0) {
      if (category === 'warehouse') workingMinutes = breakIssue ? null : Math.round(gross - breakMinutes)
      else if (category === 'sales-rep' || category === 'supervisor') workingMinutes = Math.round(gross)
      else workingMinutes = Math.round(gross - breakOverlapMinutes(schedule, dateKey, inMs, outMs))
    }
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
    joinedOn: emp.joinedOn ?? null,
    category,
    breaks,
    breakMinutes,
    breakIssue,
    onBreak,
    visits: captured.visits ?? [],
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
    explicitAbsentReason: captured.explicitAbsentReason,
    historical: captured.historical ?? null,
    notes,
  }
}

/* --------------------------------------------------------------------------
 * Public API — reads
 * ------------------------------------------------------------------------ */

/**
 * Attendance records for a company (or all companies when companyId is null)
 * over a list of date keys. Future dates are skipped, and days before an
 * employee's registration are not listed.
 */
export function listAttendanceRecords({ companyId = null, dates }) {
  const ctx = createContext()
  const roster = listAttendanceRoster(companyId)
  const records = []
  dates.forEach((dateKey) => {
    if (dateKey > ctx.today) return
    roster.forEach((emp) => {
      if (
        emp.employmentStart &&
        dateKey < emp.employmentStart &&
        !ctx.historicalIndex.has(recordKey(emp.employeeId, dateKey)) &&
        !ctx.corrections[recordKey(emp.employeeId, dateKey)]
      ) {
        return
      }
      records.push(buildRecord(emp, dateKey, ctx))
    })
  })
  return records.sort(
    (a, b) => b.date.localeCompare(a.date) || a.fullName.localeCompare(b.fullName),
  )
}

/** One employee's attendance record for a date, or null. */
export function mockGetAttendanceRecord(employeeId, dateKey) {
  if (!employeeId || !dateKey) return null
  const ctx = createContext()
  if (dateKey > ctx.today) return null
  const emp = listAttendanceRoster(null).find((e) => e.employeeId === employeeId)
  if (!emp) return null
  return buildRecord(emp, dateKey, ctx)
}

/**
 * Summary counts for a set of records.
 * present counts everyone who attended (on time, late or incomplete).
 */
export function summariseAttendance(records) {
  const s = {
    records: records.length,
    present: 0,
    absent: 0,
    late: 0,
    atWork: 0,
    onLeave: 0,
    incomplete: 0,
    unknown: 0,
    workingMinutes: 0,
  }
  records.forEach((r) => {
    if (r.hasAttendance) s.present += 1
    if (r.status === 'absent') s.absent += 1
    if (r.isLate) s.late += 1
    if (r.atWork) s.atWork += 1
    if (r.status === 'on-leave') s.onLeave += 1
    if (r.status === 'incomplete') s.incomplete += 1
    if (r.status === 'unknown') s.unknown += 1
    if (r.workingMinutes) s.workingMinutes += r.workingMinutes
  })
  s.totalHours = Math.round((s.workingMinutes / 60) * 10) / 10
  return s
}

/* --------------------------------------------------------------------------
 * Public API — HR corrections
 * ------------------------------------------------------------------------ */

/** Break times in a correction (HH:MM pairs) → ISO, with any problem. */
function correctionBreaks(input, clockIn, clockOut) {
  if (!Array.isArray(input.breaks)) return { breaks: undefined, error: null }
  const out = []
  for (const [i, b] of input.breaks.entries()) {
    const n = input.breaks.length > 1 ? ` ${i + 1}` : ''
    if (!TIME_PATTERN.test(b.startTime ?? '')) return { error: `Enter the break${n} departure time.` }
    if (b.endTime && !TIME_PATTERN.test(b.endTime)) return { error: `Enter a valid break${n} return time, or leave it empty.` }
    const start = accraIso(input.date, timeToMinutes(b.startTime))
    const end = b.endTime ? accraIso(input.date, timeToMinutes(b.endTime)) : null
    if (start < clockIn) return { error: `Break${n} cannot start before clock-in.` }
    if (end && end <= start) return { error: `Break${n} return must be after its departure.` }
    if (clockOut && (end ?? start) > clockOut) return { error: `Break${n} must end before clock-out.` }
    if (out.length && start < (out[out.length - 1].end ?? out[out.length - 1].start)) return { error: 'Breaks must not overlap and must be in time order.' }
    out.push({ start, end })
  }
  if (out.length > 3) return { error: 'Record at most 3 breaks.' }
  return { breaks: out, error: null }
}

function correctionTimes(input, record) {
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
 * Validate a correction or manual entry against the current record.
 * @returns {object} field -> message (empty when valid).
 */
export function validateCorrection(input, record) {
  const errors = {}
  const today = accraTodayKey()
  if (!input.employeeId) errors.employeeId = 'Choose an employee.'
  if (!input.date) errors.date = 'Choose the attendance date.'
  else if (input.date > today) errors.date = 'Attendance cannot be recorded for a future date.'
  if (input.employeeId && input.date && input.date <= today && !record) {
    errors.employeeId = 'This employee has no attendance record on the chosen date.'
  }
  if (record?.employmentStart && input.date < record.employmentStart && !record.historical) {
    errors.date = 'This date is before the employee was registered.'
  }
  if (record?.status === 'on-leave') {
    errors.date = 'The employee is on approved leave on this date. Change the leave record instead.'
  }
  if (!TIME_PATTERN.test(input.clockInTime ?? '')) {
    errors.clockInTime = 'Enter the corrected clock-in time.'
  }
  if (input.clockOutTime && !TIME_PATTERN.test(input.clockOutTime)) {
    errors.clockOutTime = 'Enter a valid clock-out time, or leave it empty.'
  }
  if (!input.reason || !CORRECTION_REASONS.includes(input.reason)) {
    errors.reason = 'Choose a reason for the correction.'
  }
  // A process rule: the rules in force today (when the correction is made) apply.
  const minRemarks = attendanceRulesFor().minCorrectionRemarks
  if ((input.remarks ?? '').trim().length < minRemarks) {
    errors.remarks = `Add supporting remarks (at least ${minRemarks} characters).`
  }

  if (!errors.clockInTime && !errors.clockOutTime && !errors.date && input.date) {
    const { clockIn, clockOut, outError } = correctionTimes(input, record)
    if (outError) errors.clockOutTime = outError
    const br = correctionBreaks(input, clockIn, clockOut)
    if (br.error) errors.breaks = br.error
    const toMinute = (list) => JSON.stringify(list.map((x) => [x.start?.slice(0, 16), x.end?.slice(0, 16) ?? null]))
    const breaksChanged = br.breaks !== undefined && toMinute(br.breaks) !== toMinute(record?.breaks ?? [])
    const nowMs = Date.now()
    if (Date.parse(clockIn) > nowMs) errors.clockInTime = 'Clock-in cannot be in the future.'
    if (clockOut && Date.parse(clockOut) > nowMs) {
      errors.clockOutTime = 'Clock-out cannot be in the future.'
    }
    if (
      record &&
      !outError &&
      clockIn === record.clockIn &&
      (clockOut ?? null) === (record.clockOut ?? null) &&
      !breaksChanged
    ) {
      errors.form = 'These times match the current record, so there is nothing to change.'
    }
  }
  return errors
}

/** The ISO timestamps a valid correction input would save. */
export function previewCorrectionTimes(input, record) {
  const { clockIn, clockOut } = correctionTimes(input, record)
  return { clockIn, clockOut }
}

/**
 * Save an HR correction (or a manually created record). Previous values are
 * never overwritten silently: each save appends an entry to the record's
 * correction history with the previous value, new value, reason, remarks,
 * the user who made it and when.
 * @returns {{ record } | { errors }}
 */
export function mockSaveAttendanceCorrection(input, user = getSessionUser()) {
  if (!canCorrectAttendance(user)) {
    return { errors: { form: 'You are not authorised to change attendance records.' } }
  }
  const record = mockGetAttendanceRecord(input.employeeId, input.date)
  // Company scope is checked here too, not only by what the page shows.
  if (record && !canViewCompany(user, record.companyId)) {
    return { errors: { form: "You are not authorised for this employee's company." } }
  }
  const errors = validateCorrection(input, record)
  if (Object.keys(errors).length > 0) return { errors }

  const { clockIn, clockOut } = correctionTimes(input, record)
  const { breaks } = correctionBreaks(input, clockIn, clockOut)
  const all = readCorrections()
  const key = recordKey(input.employeeId, input.date)
  const existing = all[key] ?? null
  const hadOriginal = Boolean(record.original.clockIn) || record.original.presentMarked
  const manualType = existing?.manualType ?? (hadOriginal ? 'corrected' : 'created')

  const entry = {
    id: newEntryId(),
    action: existing ? 'Correction' : manualType === 'created' ? 'Manual record created' : 'Correction',
    changedAt: new Date().toISOString(),
    changedBy: user.name,
    changedByRole: user.role,
    reason: input.reason,
    remarks: input.remarks.trim(),
    previous: {
      clockIn: record.clockIn,
      clockOut: record.clockOut,
      clockInUnknown: record.clockInUnknown,
      clockOutUnknown: record.clockOutUnknown,
      source: record.source,
      status: record.status,
      ...(breaks !== undefined ? { breaks: record.breaks } : {}),
    },
    next: { clockIn, clockOut, ...(breaks !== undefined ? { breaks } : {}) },
  }

  all[key] = {
    employeeId: input.employeeId,
    date: input.date,
    manualType,
    entryMethod: existing?.entryMethod ?? 'correction',
    clockIn,
    clockOut,
    ...(breaks !== undefined ? { breaks } : existing?.breaks ? { breaks: existing.breaks } : {}),
    history: [...(existing?.history ?? []), entry],
  }
  writeCorrections(all)
  return { record: mockGetAttendanceRecord(input.employeeId, input.date) }
}

/**
 * Every saved correction entry (all employees), oldest first. Used by the
 * Notifications module to raise "Attendance correction submitted".
 */
export function mockListAllCorrections() {
  const all = readCorrections()
  const entries = []
  Object.values(all).forEach((rec) => {
    rec.history.forEach((entry) => {
      entries.push({ ...entry, employeeId: rec.employeeId, date: rec.date, manualType: rec.manualType })
    })
  })
  return entries.sort((a, b) => a.changedAt.localeCompare(b.changedAt))
}

/* --------------------------------------------------------------------------
 * Manual Attendance Entry (HR enters days from the attendance notebook)
 * ------------------------------------------------------------------------ */

let corSeq = 0
/** Unique correction/entry id (bulk saves happen within one millisecond). */
function newEntryId(prefix = 'COR') {
  corSeq = (corSeq + 1) % 100000
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${corSeq.toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

/**
 * How HR should read a record's origin: "Manual Entry" (entered by HR, or an
 * imported notebook record) or "System Recorded" (face check-in kiosk or SMS
 * verification), with a short detail.
 * @returns {{ kind: 'manual'|'system', label: string, detail: string } | null}
 */
export function recordOrigin(r) {
  if (!r || !r.source) return null
  if (r.source === 'historical') return { kind: 'manual', label: 'Manual Entry', detail: 'Imported notebook record' }
  if (r.source === 'hr-correction') {
    if (r.manualType === 'created') return { kind: 'manual', label: 'Manual Entry', detail: 'Entered by HR' }
    if (r.entryMethod === 'manual-entry') return { kind: 'manual', label: 'Manual Entry', detail: 'Replaced an earlier record after HR review' }
    if (r.original?.source === 'historical') return { kind: 'manual', label: 'Manual Entry', detail: 'Corrected by HR' }
    return { kind: 'system', label: 'System Recorded', detail: 'Times corrected by HR' }
  }
  if (r.source === 'digital') return { kind: 'system', label: 'System Recorded', detail: 'Face check-in' }
  if (r.source === 'sms-verification') return { kind: 'system', label: 'System Recorded', detail: 'Clock-in with SMS verification' }
  return null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Current state of an employee/date before a manual entry. */
function entryState(record) {
  if (!record) return 'blocked'
  if (record.status === 'on-leave') return 'blocked'
  if (!record.hasAttendance) return 'new'
  const origin = recordOrigin(record)
  return origin?.kind === 'system' ? 'exists-system' : 'exists-manual'
}

/**
 * Check a list of manual entries for one employee without saving anything.
 * Each row comes back with its current record, state and any errors.
 * state: 'new' | 'exists-system' | 'exists-manual' | 'blocked'
 */
export function previewManualEntries(employeeId, entries, user = getSessionUser()) {
  const today = accraTodayKey()
  const emp = listAttendanceRoster(null).find((e) => e.employeeId === employeeId) ?? null
  const seen = new Map()
  entries.forEach((e) => seen.set(e.date, (seen.get(e.date) ?? 0) + 1))
  const ctx = createContext() // built once for all rows
  return entries.map((e) => {
    const errors = {}
    if (!emp) errors.form = 'Choose an employee.'
    else if (!canViewCompany(user, emp.companyId)) errors.form = "You are not authorised for this employee's company."
    if (!e.date || !DATE_RE.test(e.date)) errors.date = 'Choose a date.'
    else if (e.date > today) errors.date = 'Future dates cannot be entered.'
    else if (seen.get(e.date) > 1) errors.date = 'This date is listed more than once.'
    const record = emp && !errors.date ? buildRecord(emp, e.date, ctx) : null
    if (record?.status === 'on-leave') errors.date = 'The employee is on approved leave on this date.'
    if (!TIME_PATTERN.test(e.clockInTime ?? '')) errors.clockInTime = 'Enter the clock-in time.'
    if (e.clockOutTime && !TIME_PATTERN.test(e.clockOutTime)) errors.clockOutTime = 'Enter a valid clock-out time, or leave it empty.'
    if (!errors.date && !errors.clockInTime && !errors.clockOutTime && record) {
      const { clockIn, clockOut, outError } = correctionTimes(e, record)
      if (outError) errors.clockOutTime = outError
      if (Date.parse(clockIn) > Date.now()) errors.clockInTime = 'Clock-in cannot be in the future.'
      if (clockOut && Date.parse(clockOut) > Date.now()) errors.clockOutTime = 'Clock-out cannot be in the future.'
    }
    if ((e.remarks ?? '').length > 300) errors.remarks = 'Keep remarks under 300 characters.'
    return { ...e, record, state: errors.date ? 'blocked' : entryState(record), errors }
  })
}

/**
 * Save manual attendance for one employee — one or many dates at once.
 * New dates are created as "Manual Entry". A date that already has a record
 * is only replaced when that row has replace: true AND a replace reason is
 * given (explicit HR review). Nothing is saved unless every row is valid.
 * Unticked dates are never touched and never marked absent by this action.
 * @returns {{ created, replaced, batchId, records } | { errors, rows }}
 */
export function mockSaveManualEntries({ employeeId, entries, replaceReason = '' }, user = getSessionUser()) {
  if (!canCorrectAttendance(user)) return { errors: { form: 'You are not authorised to enter attendance.' } }
  if (!entries?.length) return { errors: { form: 'Add at least one attendance date.' } }
  const rows = previewManualEntries(employeeId, entries, user)
  const invalid = rows.filter((r) => Object.keys(r.errors).length)
  if (invalid.length) return { errors: { form: invalid[0].errors.form ?? `Fix ${invalid.length} row${invalid.length === 1 ? '' : 's'} before saving.` }, rows }
  const needsReview = rows.filter((r) => r.state.startsWith('exists') && !r.replace)
  if (needsReview.length) {
    return { errors: { form: `${needsReview.length} date${needsReview.length === 1 ? ' already has' : 's already have'} an attendance record. Review each one and tick “Replace” to overwrite it, or remove the date.` }, rows }
  }
  const replacing = rows.filter((r) => r.state.startsWith('exists'))
  if (replacing.length && replaceReason.trim().length < 10) {
    return { errors: { replaceReason: 'Give a reason for replacing existing records (at least 10 characters).' }, rows }
  }

  const batchId = newEntryId('MAN')
  const all = readCorrections()
  const now = new Date().toISOString()
  let created = 0
  let replaced = 0
  rows.forEach((r) => {
    const { clockIn, clockOut } = correctionTimes(r, r.record)
    const key = recordKey(employeeId, r.date)
    const existing = all[key] ?? null
    const isReplace = r.state.startsWith('exists')
    const hadOriginal = Boolean(r.record.original.clockIn) || r.record.original.presentMarked
    const entry = {
      id: newEntryId(),
      action: isReplace ? 'Manual entry replaced existing record' : 'Manual entry created',
      changedAt: now,
      changedBy: user.name,
      changedByRole: user.role,
      reason: isReplace ? replaceReason.trim() : 'Manual attendance entry',
      remarks: (r.remarks ?? '').trim(),
      entryMethod: 'manual-entry',
      entryBatchId: batchId,
      previous: {
        clockIn: r.record.clockIn,
        clockOut: r.record.clockOut,
        clockInUnknown: r.record.clockInUnknown,
        clockOutUnknown: r.record.clockOutUnknown,
        source: r.record.source,
        status: r.record.status,
      },
      next: { clockIn, clockOut },
    }
    all[key] = {
      employeeId,
      date: r.date,
      manualType: existing?.manualType ?? (hadOriginal ? 'corrected' : 'created'),
      entryMethod: 'manual-entry',
      clockIn,
      clockOut,
      history: [...(existing?.history ?? []), entry],
    }
    if (isReplace) replaced += 1
    else created += 1
  })
  writeCorrections(all)
  return {
    created,
    replaced,
    batchId,
    records: rows.map((r) => mockGetAttendanceRecord(employeeId, r.date)),
  }
}

/** Count of dates entered through Manual Attendance Entry (visible companies). */
export function countManualEntries(companyIds) {
  const roster = new Map(listAttendanceRoster(null).map((e) => [e.employeeId, e.companyId]))
  return Object.values(readCorrections()).filter((c) => c.entryMethod === 'manual-entry' && companyIds.includes(roster.get(c.employeeId))).length
}

/* --------------------------------------------------------------------------
 * CSV export
 * ------------------------------------------------------------------------ */

function hoursText(minutes) {
  if (minutes == null) return ''
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2)
}

function clockText(iso, unknown) {
  if (unknown) return 'Unknown'
  return iso ? formatAccraTime(iso) : ''
}

/** CSV text for a list of attendance records (Africa/Accra times). */
export function attendanceRecordsToCsv(records) {
  const header = [
    'Date',
    'Employee Name',
    'Employee ID',
    'Company',
    'Job Position',
    'Category',
    'Assigned Shop',
    'Working Hours Schedule',
    'Expected Start',
    'Expected End',
    'Clock-In',
    'Clock-Out',
    'Break Departure(s)',
    'Break Return(s)',
    'Break (minutes)',
    'Working Hours',
    'Attendance Status',
    'Late (minutes)',
    'Verification Status',
    'Attendance Source',
    'Record Source',
    'Manual Change',
    'Last Changed By',
    'Last Changed At',
    'Notes',
  ]
  const rows = records.map((r) => {
    const last = r.corrections[0]
    return [
      r.date,
      r.fullName,
      r.employeeId,
      r.companyName,
      r.position,
      CATEGORY_LABELS[r.category] ?? '',
      r.shop?.shopName ?? (r.isFieldRole ? 'Not assigned' : 'Not applicable'),
      r.schedule.name,
      formatAccraTime(r.expectedStart),
      formatAccraTime(r.expectedEnd),
      clockText(r.clockIn, r.clockInUnknown),
      clockText(r.clockOut, r.clockOutUnknown),
      r.breaks.map((b) => formatAccraTime(b.start)).join(' / '),
      r.breaks.map((b) => (b.end ? formatAccraTime(b.end) : 'Not scanned')).join(' / '),
      r.category === 'warehouse' ? r.breakMinutes : '',
      r.breakIssue ? 'Needs review' : hoursText(r.workingMinutes),
      ATTENDANCE_STATUS[r.status]?.label ?? r.status,
      r.isLate ? r.lateMinutes : r.lateUnknown ? 'Unknown' : '',
      VERIFICATION_STATUS[r.verification]?.label ?? r.verification,
      ATTENDANCE_SOURCE[r.source]?.label ?? '',
      recordOrigin(r) ? `${recordOrigin(r).label} (${recordOrigin(r).detail})` : '',
      r.manualType === 'created' ? 'Manually created' : r.manualType === 'corrected' ? 'Corrected' : '',
      last ? last.changedBy : '',
      last ? formatAccraDateTime(last.changedAt) : '',
      r.notes.join(' '),
    ]
  })
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
