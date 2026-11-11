/**
 * Sales representative monitoring, built from recorded facts only.
 *
 * Exactly three SMS checks per working day. A check appears here only once it
 * has been sent, so a future check time can never be shown. A missed SMS never
 * marks anyone absent; every alert is for HR to review.
 */

import { getCompanyById } from '../constants/companies'
import { accraDateKey as todayKey, accraIso as minutesToIso } from '../utils/accraTime'
import { buildRecord, formatWorkingDays, shiftWindowMinutes, VERIFICATIONS_PER_SHIFT } from '../../supabase/functions/_shared/rules/records.js'
import { submit } from './backend/client'
import { refresh, rows } from './backend/cache'
import { listAttendanceRoster, recordContext } from './attendanceRecordsService'
import { defaultHoursFor, monitoringSettings } from './settingsService'
import { getShop, GEOFENCE_RADIUS_M, listShops } from './shopsService'

export { GEOFENCE_RADIUS_M, VERIFICATIONS_PER_SHIFT }

/** Every worker follows the company's standard hours; there are no shifts. */
export function workHoursFor(rep, dateKey) {
  const h = defaultHoursFor(rep.companyId, dateKey)
  const { start, end } = shiftWindowMinutes(h)
  return {
    label: 'Standard hours',
    startTime: h.startTime,
    endTime: h.endTime,
    startMinutes: start,
    endMinutes: end,
    workingDays: formatWorkingDays(h.workingDays),
    workingDayList: h.workingDays,
  }
}

function fieldStaff(companyId) {
  const withChecks = new Set(rows('verification_events').map((row) => row.employee_id))
  return listAttendanceRoster(companyId)
    .filter((employee) => employee.isFieldRole)
    .map((employee) => ({
      employeeId: employee.employeeId,
      companyId: employee.companyId,
      fullName: employee.fullName,
      phoneNumber: employee.phone || '—',
      position: employee.position,
      employmentStatus: 'ACTIVE',
      assignedShopId: employee.shopId,
      profileImage: employee.photo,
      noSmsData: !withChecks.has(employee.employeeId),
    }))
}

/** Field staff who can be monitored, which needs an assigned shop. */
export function listSalesReps(companyId) {
  return fieldStaff(companyId).filter((rep) => rep.assignedShopId)
}

/** Everyone who works from a shop in a company, assigned or not. */
export function listFieldStaff(companyId) {
  return fieldStaff(companyId)
}

export function getSalesRep(employeeId) {
  return fieldStaff(null).find((rep) => rep.employeeId === employeeId && rep.assignedShopId) ?? null
}

function getDayState(rep, dateKey) {
  const employee = listAttendanceRoster(rep.companyId).find((e) => e.employeeId === rep.employeeId)
  const record = buildRecord(employee, dateKey, recordContext())
  const base = {
    rep,
    date: dateKey,
    checkedIn: false,
    checkInTime: null,
    checkOutTime: null,
    events: [],
    completedCount: 0,
    missedCount: 0,
    failedCount: 0,
    progress: `0/${VERIFICATIONS_PER_SHIFT}`,
    leave: null,
    lastVerification: null,
  }
  if (record.status === 'rest-day' || record.status === 'holiday') return { ...base, status: 'rest-day' }
  if (record.status === 'on-leave') return { ...base, status: 'on-leave', leave: record.leave }

  const events = record.smsEvents
  const completed = events.filter((e) => ['verified', 'failed-face', 'outside-shop', 'gps-unavailable'].includes(e.result))
  const missed = events.filter((e) => e.result === 'missed')
  const failed = events.filter((e) => ['failed-face', 'outside-shop'].includes(e.result))
  const latest = events[events.length - 1]

  let status = 'awaiting-verification'
  if (!record.clockIn) status = 'not-checked-in'
  else if (record.clockOut) status = 'checked-out'
  else if (latest?.result === 'verified') status = 'on-duty-verified'
  else if (latest?.result === 'missed') status = 'verification-missed'
  else if (latest?.result === 'failed-face') status = 'face-verification-failed'
  else if (latest?.result === 'outside-shop') status = 'location-exception'

  return {
    ...base,
    checkedIn: Boolean(record.clockIn),
    checkInTime: record.clockIn,
    checkOutTime: record.clockOut,
    events,
    completedCount: completed.length,
    missedCount: missed.length,
    failedCount: failed.length,
    progress: `${completed.length}/${VERIFICATIONS_PER_SHIFT}`,
    status,
    lastVerification: latest ?? null,
  }
}

function repView(rep, dateKey) {
  return {
    ...rep,
    companyName: getCompanyById(rep.companyId)?.name ?? '',
    shop: getShop(rep.assignedShopId),
    shift: workHoursFor(rep, dateKey),
    day: getDayState(rep, dateKey),
  }
}

export function getMonitoringOverview({ companyId, date }) {
  const dateKey = date ?? todayKey()
  const reps = listSalesReps(companyId).map((rep) => repView(rep, dateKey))
  const countResult = (result) => reps.reduce((sum, r) => sum + r.day.events.filter((e) => e.result === result).length, 0)
  const stats = {
    total: reps.length,
    verifiedOnDuty: reps.filter((r) => r.day.status === 'on-duty-verified').length,
    awaiting: reps.filter((r) => r.day.status === 'awaiting-verification').length,
    missedChecks: reps.reduce((sum, r) => sum + r.day.missedCount, 0),
    locationExceptions: countResult('outside-shop'),
    faceFailures: countResult('failed-face'),
  }
  return { reps, stats }
}

export function getRepresentativeDetail(employeeId, date) {
  const rep = getSalesRep(employeeId)
  return rep ? repView(rep, date ?? todayKey()) : null
}

function alertOverrides() {
  return Object.fromEntries(
    rows('monitoring_alert_reviews').map((row) => [row.exception_id, {
      status: row.status,
      resolutionNote: row.resolution_note,
      reviewedAt: row.reviewed_at,
    }]),
  )
}

const ALERT_META = {
  'missed-verification': { label: 'Missed SMS verification', severity: 'medium' },
  'failed-face': { label: 'Failed face verification', severity: 'high' },
  'outside-shop': { label: 'Outside assigned shop radius', severity: 'high' },
  'gps-unavailable': { label: 'GPS unavailable', severity: 'low' },
  'sms-failed': { label: 'SMS delivery failure', severity: 'medium' },
  'repeated-failures': { label: 'Repeated verification failures', severity: 'high' },
  'not-checked-in': { label: 'Employee not checked in', severity: 'medium' },
  'incomplete-verification': { label: 'Incomplete attendance verification', severity: 'low' },
}

/**
 * Alerts for a company on a date, newest first.
 * Alerts are derived from the day's records; HR review state persists.
 * NOTE: a missed SMS never marks anyone absent automatically. Every alert
 * requires management review.
 */
export function getAlerts({ companyId, date }) {
  const now = new Date()
  const dateKey = date ?? todayKey(now)
  const isToday = dateKey === todayKey(now)
  const overrides = alertOverrides()
  const alerts = []

  listSalesReps(companyId).forEach((rep) => {
    const day = getDayState(rep, dateKey, now)
    // Rest days, holidays and approved leave are not exceptions.
    if (day.status === 'rest-day' || day.status === 'on-leave') return
    const shop = getShop(rep.assignedShopId)
    const shift = workHoursFor(rep, dateKey)

    const push = (type, eventId, createdAt) => {
      const exceptionId = `${rep.employeeId}:${dateKey}:${type}:${eventId ?? 'day'}`
      const override = overrides[exceptionId] ?? {}
      alerts.push({
        exceptionId,
        employeeId: rep.employeeId,
        employeeName: rep.fullName,
        shopName: shop?.shopName ?? '',
        eventId: eventId ?? null,
        type,
        typeLabel: ALERT_META[type].label,
        severity: ALERT_META[type].severity,
        status: override.status ?? 'new',
        resolutionNote: override.resolutionNote ?? '',
        createdAt,
      })
    }

    // Not checked in (only once the shift has started).
    const shiftStartIso = minutesToIso(dateKey, shift.startMinutes)
    if (!day.checkedIn && (!isToday || now.getTime() >= new Date(shiftStartIso).getTime())) {
      push('not-checked-in', null, shiftStartIso)
    }

    day.events.forEach((event) => {
      if (event.result === 'missed') push('missed-verification', event.eventId, event.dispatchedAt)
      if (event.result === 'failed-face') push('failed-face', event.eventId, event.respondedAt ?? event.dispatchedAt)
      if (event.result === 'outside-shop') push('outside-shop', event.eventId, event.respondedAt ?? event.dispatchedAt)
      if (event.result === 'gps-unavailable') push('gps-unavailable', event.eventId, event.respondedAt ?? event.dispatchedAt)
      if (event.result === 'sms-failed') push('sms-failed', event.eventId, event.dispatchedAt)
    })

    // Repeated failures: 2 or more missed/failed checks in the day.
    if (day.missedCount + day.failedCount >= monitoringSettings().repeatedExceptionThreshold) {
      const last = day.events[day.events.length - 1]
      if (last) push('repeated-failures', null, last.respondedAt ?? last.dispatchedAt)
    }

    // Incomplete verification once the shift has ended.
    const shiftEndIso = minutesToIso(dateKey, shift.endMinutes)
    const shiftEnded = !isToday || now.getTime() >= new Date(shiftEndIso).getTime()
    if (day.checkedIn && shiftEnded && day.completedCount < VERIFICATIONS_PER_SHIFT) {
      push('incomplete-verification', null, shiftEndIso)
    }
  })

  return alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}


/** @returns {Promise<object>} the saved review, or { error } */
export async function updateAlert(exceptionId, { status, resolutionNote }) {
  const result = await submit(`/hr/monitoring/alerts/${encodeURIComponent(exceptionId)}`, {
    method: 'PATCH',
    body: { status, resolutionNote },
  })
  if (result.error) return result
  await refresh('monitoring_alert_reviews', 'audit_events')
  return result
}

/* --------------------------------------------------------------------------
 * Live field board — real recorded data only
 *
 * The system never tracks reps continuously. It knows a rep's position only
 * at the moments a verification check was answered, and stores the distance
 * from the assigned shop (not coordinates). The board therefore shows each
 * rep AT THEIR SHOP with the result of their latest recorded check. Between
 * checks the location is unknown, and future check times are never shown.
 * ------------------------------------------------------------------------ */

export const FIELD_STATE = {
  inside: { label: 'Inside geofence at last check', short: 'Inside geofence', tone: 'ok' },
  outside: { label: 'Outside geofence at last check', short: 'Outside geofence', tone: 'crit' },
  'face-failed': { label: 'Face check failed at last check', short: 'Face check failed', tone: 'crit' },
  'location-unknown': { label: 'Location unavailable at last check', short: 'Location unavailable', tone: 'warn' },
  'no-response': { label: 'No response to last check', short: 'No response', tone: 'warn' },
  'awaiting-check': { label: 'On duty — no check yet today', short: 'Awaiting first check', tone: 'pending' },
  'checked-out': { label: 'Checked out for the day', short: 'Checked out', tone: 'muted' },
  'not-checked-in': { label: 'Not checked in (shift has started)', short: 'Not checked in', tone: 'warn' },
  'before-shift': { label: 'Shift not started yet', short: 'Shift not started', tone: 'muted' },
  'off-schedule': { label: 'Not scheduled today (rest day or leave)', short: 'Not scheduled', tone: 'muted' },
  'no-data': { label: 'No verification data for this employee', short: 'No verification data', tone: 'muted' },
}

function liveState(day, shift, dateKey, now) {
  if (day.status === 'rest-day' || day.status === 'on-leave') return 'off-schedule'
  const startMs = new Date(minutesToIso(dateKey, shift.startMinutes)).getTime()
  if (!day.checkedIn) return now.getTime() < startMs ? 'before-shift' : 'not-checked-in'
  if (day.checkOutTime) return 'checked-out'
  const last = day.events[day.events.length - 1]
  if (!last) return 'awaiting-check'
  return {
    verified: 'inside',
    'outside-shop': 'outside',
    'failed-face': 'face-failed',
    'gps-unavailable': 'location-unknown',
    missed: 'no-response',
    'sms-failed': 'no-response',
  }[last.result] ?? 'awaiting-check'
}

/**
 * The live field board for a company, as of now.
 * @returns {{ asOf: string, reps: object[], counts: object, shops: object[] }}
 */
export function getLiveFieldBoard(companyId) {
  const now = new Date()
  const dateKey = todayKey(now)
  const nowIso = now.toISOString()
  const monitored = listSalesReps(companyId).map((rep) => {
    const day = getDayState(rep, dateKey, now)
    const shift = workHoursFor(rep, dateKey)
    const shop = getShop(rep.assignedShopId)
    // Only events that have already happened (generateDayEvents guarantees it;
    // filtered again here so a future time can never reach the screen).
    const events = day.events.filter((e) => e.dispatchedAt <= nowIso)
    const last = events[events.length - 1] ?? null
    const lastGps = [...events].reverse().find((e) => e.distanceFromShop != null) ?? null
    const lastAt = last ? last.respondedAt ?? last.dispatchedAt : null
    return {
      employeeId: rep.employeeId,
      fullName: rep.fullName,
      phoneNumber: rep.phoneNumber,
      position: rep.position,
      shop,
      shift,
      state: liveState({ ...day, events }, shift, dateKey, now),
      checkInTime: day.checkInTime,
      checkOutTime: day.checkOutTime,
      checksDone: events.length,
      lastCheck: last,
      lastCheckAt: lastAt,
      minutesSinceLastCheck: lastAt ? Math.max(0, Math.round((now.getTime() - Date.parse(lastAt)) / 60000)) : null,
      lastDistance: lastGps?.distanceFromShop ?? null,
      lastAccuracy: lastGps?.gpsAccuracy ?? null,
      lastGpsAt: lastGps ? lastGps.respondedAt ?? lastGps.dispatchedAt : null,
      hasData: true,
    }
  })
  const ids = new Set(monitored.map((r) => r.employeeId))
  const registered = listFieldStaff(companyId)
    .filter((r) => r.noSmsData && !ids.has(r.employeeId))
    .map((r) => ({
      employeeId: r.employeeId,
      fullName: r.fullName,
      phoneNumber: r.phoneNumber,
      position: r.position,
      shop: r.assignedShopId ? getShop(r.assignedShopId) : null,
      shift: null,
      state: 'no-data',
      checksDone: 0,
      lastCheck: null,
      lastCheckAt: null,
      minutesSinceLastCheck: null,
      lastDistance: null,
      lastAccuracy: null,
      hasData: false,
    }))
  const reps = [...monitored, ...registered].sort((a, b) => a.fullName.localeCompare(b.fullName))
  const counts = Object.fromEntries(Object.keys(FIELD_STATE).map((k) => [k, reps.filter((r) => r.state === k).length]))
  counts.onDuty = reps.filter((r) => ['inside', 'outside', 'face-failed', 'location-unknown', 'no-response', 'awaiting-check'].includes(r.state)).length
  return { asOf: nowIso, dateKey, reps, counts, shops: listShops(companyId) }
}
