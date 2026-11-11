/**
 * Settings rules, shared by the browser and the server.
 *
 * Attendance rules, working hours and pay are effective-dated: a change applies
 * from its date, so days already calculated are never rewritten. The attendance
 * cycle and time zone are fixed company rules and are not settings.
 */

import { accraTodayKey } from './accraTime.js'

export const CHECKS_PER_SHIFT = 3

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export const LANDING_PAGES = {
  dashboard: 'Dashboard',
  attendance: 'Attendance',
  notifications: 'Notifications',
  employees: 'Employees',
}

/** Notification preference groups and the notification types they control. */
export const NOTIFICATION_GROUPS = {
  'late-arrivals': { label: 'Late arrivals', types: ['late-clock-in'] },
  'missing-attendance': { label: 'Missing attendance (no clock-in)', types: ['no-clock-in'] },
  'incomplete-records': { label: 'Incomplete records / missing clock-out', types: ['missing-clock-out', 'incomplete-record'] },
  'sms-delivery-failed': { label: 'Failed SMS delivery', types: ['sms-delivery-failed'] },
  'missed-verification': { label: 'Missed verification', types: ['sms-missed'] },
  'face-failed': { label: 'Failed face verification', types: ['face-failed'] },
  'gps-failed': { label: 'Failed GPS verification / outside geofence', types: ['gps-failed', 'outside-geofence'] },
  'missing-shop': { label: 'Missing shop assignments', types: ['rep-no-shop', 'no-shop-required'] },
  'manual-entries': { label: 'Manual entries and corrections', types: ['correction-submitted', 'historical-verification'] },
}

export const DEFAULT_HOURS = {
  workingDays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  lateAfter: '09:00',
  endTime: '17:00',
  overtimeStart: '17:01',
  breakStart: '12:30',
  breakMinutes: 0,
}

export const DEFAULT_OVERTIME_RATE = 60
export const DEFAULT_VAT_RATE = 5.5

const DEFAULT_NOTIFICATION_PREFERENCE = { enabled: true, severity: 'default', roles: ['hr-manager'] }

/* --------------------------------------------------------------------------
 * Assembling settings from database rows
 * ------------------------------------------------------------------------ */

function versionFromRow(row) {
  return {
    effectiveFrom: row.effective_from,
    values: row.values,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  }
}

/** The whole settings object from its three tables. */
export function composeSettings({ general, companies, versions }) {
  const section = (key) => general.find((row) => row.key === key)?.value ?? {}
  const forCompanies = (build) => Object.fromEntries(companies.map((row) => [row.company_id, build(row)]))
  const versionsOf = (kind, companyId = null) =>
    versions.filter((row) => row.kind === kind && row.company_id === companyId).map(versionFromRow)
  const saved = section('notifications')
  return {
    general: section('general'),
    companies: forCompanies((row) => row.profile),
    attendanceVersions: versionsOf('attendance'),
    workingHoursVersions: forCompanies((row) => versionsOf('working-hours', row.company_id)),
    payVersions: forCompanies((row) => versionsOf('pay', row.company_id)),
    vat: forCompanies((row) => ({
      rate: Number(row.vat_rate),
      updatedBy: row.vat_updated_by,
      updatedAt: row.vat_updated_at,
    })),
    // Whether office staff must scan a workplace QR display to check in or out.
    workplaceCodeRequired: forCompanies((row) => Boolean(row.require_workplace_code)),
    monitoring: section('monitoring'),
    notifications: Object.fromEntries(
      Object.keys(NOTIFICATION_GROUPS).map((key) => [key, { ...DEFAULT_NOTIFICATION_PREFERENCE, ...(saved[key] ?? {}) }]),
    ),
    security: section('security'),
    data: section('data'),
  }
}

/** The version in force on a date. */
export function versionFor(versions, dateKey) {
  const sorted = versions.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  let found = sorted[0]
  sorted.forEach((version) => {
    if (version.effectiveFrom <= dateKey) found = version
  })
  return found
}

/** Default hours for a company on a date, with the date they took effect. */
export function hoursInForce(settings, companyId, dateKey) {
  const version = versionFor(settings.workingHoursVersions[companyId] ?? [], dateKey)
  return { ...DEFAULT_HOURS, ...version?.values, effectiveFrom: version?.effectiveFrom ?? '2000-01-01' }
}

export function attendanceRulesInForce(settings, dateKey) {
  return versionFor(settings.attendanceVersions, dateKey).values
}

export function overtimeRateInForce(settings, companyId, dateKey) {
  const version = versionFor(settings.payVersions[companyId] ?? [], dateKey)
  return Number(version?.values.overtimeRate ?? DEFAULT_OVERTIME_RATE)
}

/** Preference for a notification type, or null when it is not configurable. */
export function notificationPreferenceFor(type, preferences) {
  const key = Object.keys(NOTIFICATION_GROUPS).find((group) => NOTIFICATION_GROUPS[group].types.includes(type))
  return key ? { group: key, ...preferences[key] } : null
}

/** The fields that differ, with their old and new values. */
export function diffValues(previous, next) {
  const changed = Object.keys(next).filter((key) => JSON.stringify(previous?.[key]) !== JSON.stringify(next[key]))
  return {
    changed,
    previous: Object.fromEntries(changed.map((key) => [key, previous?.[key] ?? null])),
    next: Object.fromEntries(changed.map((key) => [key, next[key]])),
  }
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

function checkEffectiveDate(errors, effectiveFrom, today, what, past) {
  if (!DATE.test(effectiveFrom ?? '')) errors.effectiveFrom = `Choose the date the ${what} takes effect.`
  else if (effectiveFrom < today) errors.effectiveFrom = `${past} cannot be backdated; choose today or a later date.`
}

export function validateGeneral(v) {
  const e = {}
  if ((v.systemName ?? '').trim().length < 2) e.systemName = 'Enter a system name.'
  if ((v.description ?? '').length > 240) e.description = 'Keep the description under 240 characters.'
  if (!['en-GB'].includes(v.language)) e.language = 'Only English is available.'
  if (!['d MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'].includes(v.dateFormat)) e.dateFormat = 'Choose a date format.'
  if (!['12h', '24h'].includes(v.timeFormat)) e.timeFormat = 'Choose 12-hour or 24-hour.'
  if (!LANDING_PAGES[v.landingPage]) e.landingPage = 'Choose a landing page.'
  return e
}

export function validateCompany(v) {
  const e = {}
  if ((v.displayName ?? '').trim().length < 2) e.displayName = 'Enter the display name.'
  if (!/^[A-Z]{2,5}$/.test(v.code ?? '')) e.code = 'Use 2–5 capital letters (e.g. BFL).'
  if (v.phone && !/^\+?[\d\s-]{9,}$/.test(v.phone)) e.phone = 'Enter a valid phone number.'
  if (v.email && !EMAIL.test(v.email)) e.email = 'Enter a valid email address.'
  if (!['active', 'inactive'].includes(v.status)) e.status = 'Choose a status.'
  return e
}

export function validateAttendanceRules(v, effectiveFrom, today = accraTodayKey()) {
  const e = {}
  const win = Number(v.clockOutWindowMinutes)
  if (!Number.isInteger(win) || win < 15 || win > 360) e.clockOutWindowMinutes = 'Clock-out window must be 15–360 minutes.'
  const rem = Number(v.minCorrectionRemarks)
  if (!Number.isInteger(rem) || rem < 10 || rem > 200) e.minCorrectionRemarks = 'Remarks must be at least 10 characters (10–200).'
  if (!['absent-after-shift-end', 'review-before-absent'].includes(v.missingClockIn)) e.missingClockIn = 'Choose how a missing clock-in is handled.'
  if (!['flag-and-notify', 'flag-only'].includes(v.incompleteHandling)) e.incompleteHandling = 'Choose how incomplete records are handled.'
  if (!['not-required', 'manager-approval'].includes(v.correctionApproval)) e.correctionApproval = 'Choose an approval requirement.'
  checkEffectiveDate(e, effectiveFrom, today, 'change', 'Changes')
  return e
}

export function validateWorkingHours(v, effectiveFrom, today = accraTodayKey()) {
  const e = {}
  if (!Array.isArray(v.workingDays) || !v.workingDays.length || !v.workingDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    e.workingDays = 'Choose at least one working day.'
  }
  if (!TIME.test(v.startTime ?? '')) e.startTime = 'Enter the official clock-in time (HH:MM).'
  if (!TIME.test(v.endTime ?? '')) e.endTime = 'Enter the official clock-out time (HH:MM).'
  if (!e.startTime && !e.endTime && v.endTime <= v.startTime) e.endTime = 'Clock-out must be after clock-in.'
  if (!TIME.test(v.lateAfter ?? '')) e.lateAfter = 'Enter the late-coming time (HH:MM).'
  else if (!e.startTime && !e.endTime && (v.lateAfter < v.startTime || v.lateAfter >= v.endTime)) e.lateAfter = 'Late-coming time must be between clock-in and clock-out.'
  if (!TIME.test(v.overtimeStart ?? '')) e.overtimeStart = 'Enter the overtime start time (HH:MM).'
  else if (!e.endTime && v.overtimeStart < v.endTime) e.overtimeStart = 'Overtime must start at or after the official clock-out time.'
  const br = Number(v.breakMinutes)
  if (!Number.isInteger(br) || br < 0 || br > 120) e.breakMinutes = 'Break must be 0–120 minutes.'
  if (br > 0 && !TIME.test(v.breakStart ?? '')) e.breakStart = 'Enter when the break starts.'
  checkEffectiveDate(e, effectiveFrom, today, 'change', 'Changes')
  return e
}

export function validateOvertimeRate(rate, effectiveFrom, today = accraTodayKey()) {
  const e = {}
  const r = Number(rate)
  if (rate === '' || rate == null || !Number.isFinite(r) || r < 0 || r > 10000) e.overtimeRate = 'Enter a rate between GH₵0 and GH₵10,000 per hour.'
  else if (Math.abs(Math.round(r * 100) - r * 100) > 1e-6) e.overtimeRate = 'Use at most two decimal places (pesewas).'
  checkEffectiveDate(e, effectiveFrom, today, 'rate', 'Rates')
  return e
}

export function validateVat(rate) {
  const r = Number(rate)
  if (rate === '' || rate == null || !Number.isFinite(r) || r < 0 || r > 100) return { vatRate: 'VAT must be between 0% and 100%.' }
  if (Math.abs(Math.round(r * 100) - r * 100) > 1e-6) return { vatRate: 'Use at most two decimal places.' }
  return {}
}

export function validateMonitoring(v) {
  const e = {}
  const r = Number(v.defaultGeofenceRadius)
  if (!Number.isInteger(r) || r < 50 || r > 1000) e.defaultGeofenceRadius = 'Radius must be 50–1000 metres.'
  const w = Number(v.responseWindowMinutes)
  if (!Number.isInteger(w) || w < 5 || w > 60) e.responseWindowMinutes = 'Response window must be 5–60 minutes.'
  const t = Number(v.repeatedExceptionThreshold)
  if (!Number.isInteger(t) || t < 2 || t > 3) e.repeatedExceptionThreshold = `Use 2 or 3 (there are ${CHECKS_PER_SHIFT} checks per shift).`
  if (v.locationProvider != null && !['none', 'nominatim'].includes(v.locationProvider)) e.locationProvider = 'Choose a location service.'
  return e
}

export function validateNotificationPrefs(prefs) {
  const e = {}
  Object.entries(prefs ?? {}).forEach(([key, pref]) => {
    if (!NOTIFICATION_GROUPS[key]) e[key] = 'Unknown notification.'
    else if (!['default', 'critical', 'high', 'medium', 'low'].includes(pref?.severity)) e[key] = 'Choose a severity.'
    else if (pref.enabled && !pref.roles?.length) e[key] = 'Choose at least one role, or turn the notification off.'
  })
  return e
}

export function validateSecurity(v) {
  const e = {}
  const t = Number(v.sessionTimeoutMinutes)
  if (!Number.isInteger(t) || t < 5 || t > 480) e.sessionTimeoutMinutes = 'Session timeout must be 5–480 minutes.'
  const l = Number(v.loginAttemptLimit)
  if (!Number.isInteger(l) || l < 3 || l > 10) e.loginAttemptLimit = 'Allow 3–10 attempts.'
  const p = Number(v.passwordMinLength)
  if (!Number.isInteger(p) || p < 12 || p > 64) e.passwordMinLength = 'Minimum length must be 12–64 characters.'
  return e
}
