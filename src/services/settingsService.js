/**
 * ============================================================================
 * MOCK SETTINGS SERVICE — single source of configuration for the HR portal
 * ============================================================================
 * Frontend demonstration only. Saving here changes how this prototype
 * calculates and displays data; it does not configure any real SMS provider,
 * scheduler, email service, authentication or database.
 *
 * Integrity rules:
 *   - The attendance cycle (26th–25th) and Africa/Accra time zone are fixed
 *     company rules and read-only here (utils/payPeriod.js, utils/accraTime.js).
 *   - Attendance rules and default working hours are effective-dated: a
 *     change applies from its effective date (today or later), so attendance
 *     already calculated for earlier days is never silently rewritten.
 *   - Default working hours only apply to employees WITHOUT an assigned
 *     shift. Shift assignments (Shifts module) are never overwritten.
 *   - Three random SMS checks per shift is the current system rule (locked).
 *   - Every change is written to the append-only audit store with the
 *     previous and new values.
 * ============================================================================
 */

import { COMPANIES } from '../constants/companies'
import { PERIOD_START_DAY } from '../utils/payPeriod'
import { SETTINGS_KEY, readJson, writeJson } from './mockStore'
import { recordAuditEvent } from './auditStore'
import { can, canAccessCompany } from './permissionsService'

export const TIMEZONE = 'Africa/Accra'
export const CYCLE_START_DAY = PERIOD_START_DAY // 26
export const CYCLE_END_DAY = PERIOD_START_DAY - 1 // 25
export const CHECKS_PER_SHIFT = 3

const BASE_DATE = '2000-01-01'
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const LANDING_PAGES = {
  dashboard: 'Dashboard',
  attendance: 'Attendance',
  notifications: 'Notifications',
  employees: 'Employees',
}

/** Notification preference groups → the notification types they control. */
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

const ALL_ROLES = ['hr-manager']

/**
 * Company attendance times. Official clock-in/out apply to employees without a
 * shift; late-coming time marks lateness (clock-in AFTER it is late); overtime
 * starts at the overtime start time (for shift staff: the same gap after
 * their own shift end).
 */
const DEFAULT_HOURS = {
  workingDays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  lateAfter: '09:00',
  endTime: '17:00',
  overtimeStart: '17:01',
  breakStart: '12:30',
  breakMinutes: 0,
}

export const DEFAULT_OVERTIME_RATE = 60 // GH₵ per hour
export const DEFAULT_VAT_RATE = 5.5 // %

/* --------------------------------------------------------------------------
 * Defaults
 * ------------------------------------------------------------------------ */

function defaultSettings() {
  const companyDefaults = {
    'box-for-less': { displayName: 'Box For Less', code: 'BFL', phone: '+233 30 000 0001', email: 'hr@boxforless.example.com', address: 'Oxford Street, Osu, Accra', logo: null, status: 'active' },
    'double-a': { displayName: 'Double A', code: 'DAA', phone: '+233 30 000 0002', email: 'hr@doublea.example.com', address: 'High Street, Accra', logo: null, status: 'active' },
  }
  const hours = { ...DEFAULT_HOURS }
  return {
    general: {
      systemName: 'Workforce Pro',
      logo: null,
      description: 'Workforce management for Box For Less and Double A.',
      language: 'en-GB',
      dateFormat: 'd MMM yyyy',
      timeFormat: '12h',
      landingPage: 'dashboard',
    },
    companies: companyDefaults,
    attendanceVersions: [{
      effectiveFrom: BASE_DATE,
      values: {
        graceMinutes: 60,
        clockOutWindowMinutes: 120,
        missingClockIn: 'absent-after-shift-end',
        incompleteHandling: 'flag-and-notify',
        minCorrectionRemarks: 10,
        correctionApproval: 'not-required',
      },
      changedBy: 'System default',
    }],
    workingHoursVersions: Object.fromEntries(COMPANIES.map((c) => [c.id, [{ effectiveFrom: BASE_DATE, values: { ...hours }, changedBy: 'System default' }]])),
    payVersions: Object.fromEntries(COMPANIES.map((c) => [c.id, [{ effectiveFrom: BASE_DATE, values: { overtimeRate: DEFAULT_OVERTIME_RATE }, changedBy: 'System default' }]])),
    vat: Object.fromEntries(COMPANIES.map((c) => [c.id, { rate: DEFAULT_VAT_RATE, updatedBy: 'System default', updatedAt: null }])),
    monitoring: {
      defaultGeofenceRadius: 150,
      responseWindowMinutes: 15,
      faceRequired: true,
      gpsRequired: true,
      smsEnabled: true,
      repeatedExceptionThreshold: 2,
      // Shop location lookup: 'none' (off) or 'nominatim' (OpenStreetMap).
      locationProvider: 'none',
    },
    notifications: Object.fromEntries(Object.keys(NOTIFICATION_GROUPS).map((k) => [k, { enabled: true, severity: 'default', roles: ALL_ROLES.slice() }])),
    security: {
      sessionTimeoutMinutes: 60,
      loginAttemptLimit: 5,
      passwordMinLength: 12,
      passwordRequireMixed: true,
      mfaPolicy: 'required-in-production',
    },
    data: { lastConfigExportAt: null },
  }
}

let cache = { raw: undefined, value: null }

export function getSettings() {
  // Cache keyed on the stored text, so a save is picked up immediately.
  let raw = null
  try { raw = window.localStorage.getItem(SETTINGS_KEY) } catch { raw = null }
  if (raw === cache.raw && cache.value) return structuredClone(cache.value)
  const value = computeSettings()
  cache = { raw, value }
  return structuredClone(value)
}

function computeSettings() {
  const stored = readJson(SETTINGS_KEY, null)
  const defaults = defaultSettings()
  if (!stored) return defaults
  // Merge so newly added settings get defaults.
  return {
    ...defaults,
    ...stored,
    general: { ...defaults.general, ...stored.general },
    companies: Object.fromEntries(COMPANIES.map((c) => [c.id, { ...defaults.companies[c.id], ...(stored.companies?.[c.id] ?? {}) }])),
    monitoring: { ...defaults.monitoring, ...stored.monitoring },
    // Only groups that still exist (Historical Import groups were removed).
    notifications: Object.fromEntries(Object.keys(NOTIFICATION_GROUPS).map((k) => [k, { ...defaults.notifications[k], ...(stored.notifications?.[k] ?? {}) }])),
    security: { ...defaults.security, ...stored.security },
    data: { ...defaults.data, ...stored.data },
    workingHoursVersions: { ...defaults.workingHoursVersions, ...stored.workingHoursVersions },
    payVersions: { ...defaults.payVersions, ...stored.payVersions },
    vat: { ...defaults.vat, ...stored.vat },
  }
}

function save(settings) {
  writeJson(SETTINGS_KEY, settings)
}

const todayKey = () => new Date().toISOString().slice(0, 10) // Accra = UTC+0

function versionFor(versions, dateKey) {
  const sorted = versions.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  let found = sorted[0]
  sorted.forEach((v) => { if (v.effectiveFrom <= dateKey) found = v })
  return found
}

/* --------------------------------------------------------------------------
 * Reads used by other modules
 * ------------------------------------------------------------------------ */

export function attendanceRulesFor(dateKey = todayKey()) {
  return versionFor(getSettings().attendanceVersions, dateKey).values
}

/** Default hours for employees without a shift, for a company on a date. */
export function defaultHoursFor(companyId, dateKey = todayKey()) {
  const versions = getSettings().workingHoursVersions[companyId] ?? defaultSettings().workingHoursVersions[companyId] ?? defaultSettings().workingHoursVersions['box-for-less']
  const v = versionFor(versions, dateKey)
  // Older saved versions may predate late-coming / overtime times.
  return { ...DEFAULT_HOURS, ...v.values, effectiveFrom: v.effectiveFrom }
}

/** Overtime rate (GH₵ per hour) for a company on a date. Effective-dated. */
export function overtimeRateFor(companyId, dateKey = todayKey()) {
  const versions = getSettings().payVersions[companyId] ?? [{ effectiveFrom: BASE_DATE, values: { overtimeRate: DEFAULT_OVERTIME_RATE } }]
  return Number(versionFor(versions, dateKey).values.overtimeRate)
}

export function overtimeRateVersions(companyId) {
  return (getSettings().payVersions[companyId] ?? []).slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

/** VAT percentage configured for a company (a separate tax setting). */
export function vatRateFor(companyId) {
  return Number(getSettings().vat[companyId]?.rate ?? DEFAULT_VAT_RATE)
}

export function vatSetting(companyId) {
  return getSettings().vat[companyId] ?? { rate: DEFAULT_VAT_RATE }
}

export function monitoringSettings() {
  return getSettings().monitoring
}

export function generalSettings() {
  return getSettings().general
}

export function companySettings(companyId) {
  return getSettings().companies[companyId] ?? null
}

/** Display name for a company (records keep the name stored on them). */
export function companyDisplayName(companyId, fallback = '') {
  return companySettings(companyId)?.displayName || fallback
}

/** Preference for a notification type, or null when not configurable. */
export function notificationPreferenceFor(type) {
  const prefs = getSettings().notifications
  const key = Object.keys(NOTIFICATION_GROUPS).find((k) => NOTIFICATION_GROUPS[k].types.includes(type))
  return key ? { group: key, ...prefs[key] } : null
}

export function securitySettings() {
  return getSettings().security
}

/** Versions (history and scheduled) for display. */
export function attendanceRuleVersions() {
  return getSettings().attendanceVersions.slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

export function workingHoursVersions(companyId) {
  return (getSettings().workingHoursVersions[companyId] ?? []).slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
}

/* --------------------------------------------------------------------------
 * Permission model for settings
 *   - System-wide sections: settings → Manage.
 *   - Company sections (company profile, working hours): settings → Edit AND
 *     access to that company. Company status needs Manage.
 *   - Everyone with settings → View can read.
 * ------------------------------------------------------------------------ */

export function canEditSystemSettings(user) {
  return can(user, 'settings', 'manage')
}

export function canEditCompanySettings(user, companyId) {
  return (can(user, 'settings', 'edit') || can(user, 'settings', 'manage')) && canAccessCompany(user, companyId)
}

function deny(message = 'You are not authorised to change these settings.') {
  return { errors: { form: message } }
}

function diff(prev, next) {
  const changed = Object.keys(next).filter((k) => JSON.stringify(prev?.[k]) !== JSON.stringify(next[k]))
  return {
    changed,
    previous: Object.fromEntries(changed.map((k) => [k, prev?.[k] ?? null])),
    next: Object.fromEntries(changed.map((k) => [k, next[k]])),
  }
}

function audit(user, action, companyIds, affected, description, d) {
  return recordAuditEvent({
    action,
    category: 'System Settings',
    actor: { name: user.name, role: user.role },
    companyIds,
    affected,
    description,
    previous: d.previous,
    next: d.next,
  })
}

/* --------------------------------------------------------------------------
 * Validation + saves
 * ------------------------------------------------------------------------ */

export function validateGeneral(v) {
  const e = {}
  if ((v.systemName ?? '').trim().length < 2) e.systemName = 'Enter a system name.'
  if ((v.description ?? '').length > 240) e.description = 'Keep the description under 240 characters.'
  if (!['en-GB'].includes(v.language)) e.language = 'Only English is available in this prototype.'
  if (!['d MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'].includes(v.dateFormat)) e.dateFormat = 'Choose a date format.'
  if (!['12h', '24h'].includes(v.timeFormat)) e.timeFormat = 'Choose 12-hour or 24-hour.'
  if (!LANDING_PAGES[v.landingPage]) e.landingPage = 'Choose a landing page.'
  return e
}

export function saveGeneral(values, user) {
  if (!canEditSystemSettings(user)) return deny()
  const errors = validateGeneral(values)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const next = { ...s.general, ...values, systemName: values.systemName.trim(), description: values.description.trim() }
  const d = diff(s.general, next)
  if (!d.changed.length) return deny('Nothing has changed.')
  s.general = next
  save(s)
  audit(user, 'General settings changed', [], 'General settings', `Changed: ${d.changed.join(', ')}`, d)
  return { settings: s }
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

export function saveCompany(companyId, values, user) {
  if (!canEditCompanySettings(user, companyId)) return deny('You are not authorised to change this company’s settings.')
  const errors = validateCompany(values)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const prev = s.companies[companyId]
  if (values.status !== prev.status && !canEditSystemSettings(user)) return deny('Your account cannot change a company’s status.')
  const next = { ...prev, ...values, displayName: values.displayName.trim() }
  const d = diff(prev, next)
  if (!d.changed.length) return deny('Nothing has changed.')
  s.companies[companyId] = next
  save(s)
  audit(user, 'Company settings changed', [companyId], next.displayName, `Changed: ${d.changed.join(', ')}. Employee IDs and attendance records are unchanged.`, d)
  return { settings: s }
}

export function validateAttendanceRules(v, effectiveFrom) {
  const e = {}
  const grace = Number(v.graceMinutes)
  if (!Number.isInteger(grace) || grace < 0 || grace > 120) e.graceMinutes = 'Grace period must be 0–120 minutes.'
  const win = Number(v.clockOutWindowMinutes)
  if (!Number.isInteger(win) || win < 15 || win > 360) e.clockOutWindowMinutes = 'Clock-out window must be 15–360 minutes.'
  const rem = Number(v.minCorrectionRemarks)
  if (!Number.isInteger(rem) || rem < 10 || rem > 200) e.minCorrectionRemarks = 'Remarks must be at least 10 characters (10–200).'
  if (!['absent-after-shift-end', 'review-before-absent'].includes(v.missingClockIn)) e.missingClockIn = 'Choose how a missing clock-in is handled.'
  if (!['flag-and-notify', 'flag-only'].includes(v.incompleteHandling)) e.incompleteHandling = 'Choose how incomplete records are handled.'
  if (!['not-required', 'manager-approval'].includes(v.correctionApproval)) e.correctionApproval = 'Choose an approval requirement.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) e.effectiveFrom = 'Choose the date the change takes effect.'
  else if (effectiveFrom < todayKey()) e.effectiveFrom = 'Changes cannot be backdated; choose today or a later date.'
  return e
}

function upsertVersion(versions, effectiveFrom, values, user) {
  const idx = versions.findIndex((v) => v.effectiveFrom === effectiveFrom)
  const entry = { effectiveFrom, values, changedBy: user.name, changedAt: new Date().toISOString() }
  if (idx >= 0) versions[idx] = entry
  else versions.push(entry)
}

export function saveAttendanceRules(values, effectiveFrom, user) {
  if (!canEditSystemSettings(user)) return deny()
  const errors = validateAttendanceRules(values, effectiveFrom)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const prev = versionFor(s.attendanceVersions, effectiveFrom).values
  const next = {
    ...prev,
    graceMinutes: Number(values.graceMinutes),
    clockOutWindowMinutes: Number(values.clockOutWindowMinutes),
    minCorrectionRemarks: Number(values.minCorrectionRemarks),
    missingClockIn: values.missingClockIn,
    incompleteHandling: values.incompleteHandling,
    correctionApproval: values.correctionApproval,
  }
  const d = diff(prev, next)
  if (!d.changed.length) return deny('Nothing has changed.')
  upsertVersion(s.attendanceVersions, effectiveFrom, next, user)
  save(s)
  audit(user, 'Attendance rules changed', [], 'Attendance rules', `Effective from ${effectiveFrom}. Changed: ${d.changed.join(', ')}. Earlier attendance keeps the rules in force at the time.`, d)
  return { settings: s }
}

export function validateWorkingHours(v, effectiveFrom) {
  const e = {}
  if (!Array.isArray(v.workingDays) || !v.workingDays.length) e.workingDays = 'Choose at least one working day.'
  if (!TIME.test(v.startTime ?? '')) e.startTime = 'Enter the official clock-in time (HH:MM).'
  if (!TIME.test(v.endTime ?? '')) e.endTime = 'Enter the official clock-out time (HH:MM).'
  if (!e.startTime && !e.endTime && v.endTime <= v.startTime) e.endTime = 'Clock-out must be after clock-in (use a shift for overnight work).'
  if (!TIME.test(v.lateAfter ?? '')) e.lateAfter = 'Enter the late-coming time (HH:MM).'
  else if (!e.startTime && !e.endTime && (v.lateAfter < v.startTime || v.lateAfter >= v.endTime)) e.lateAfter = 'Late-coming time must be between clock-in and clock-out.'
  if (!TIME.test(v.overtimeStart ?? '')) e.overtimeStart = 'Enter the overtime start time (HH:MM).'
  else if (!e.endTime && v.overtimeStart < v.endTime) e.overtimeStart = 'Overtime must start at or after the official clock-out time.'
  const br = Number(v.breakMinutes)
  if (!Number.isInteger(br) || br < 0 || br > 120) e.breakMinutes = 'Break must be 0–120 minutes.'
  if (br > 0 && !TIME.test(v.breakStart ?? '')) e.breakStart = 'Enter when the break starts.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) e.effectiveFrom = 'Choose the date the change takes effect.'
  else if (effectiveFrom < todayKey()) e.effectiveFrom = 'Changes cannot be backdated; choose today or a later date.'
  return e
}

export function saveWorkingHours(companyId, values, effectiveFrom, user) {
  if (!canEditCompanySettings(user, companyId)) return deny('You are not authorised to change this company’s working hours.')
  const errors = validateWorkingHours(values, effectiveFrom)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const versions = s.workingHoursVersions[companyId]
  const prev = versionFor(versions, effectiveFrom).values
  const next = { workingDays: values.workingDays.slice().sort(), startTime: values.startTime, lateAfter: values.lateAfter, endTime: values.endTime, overtimeStart: values.overtimeStart, breakStart: values.breakStart, breakMinutes: Number(values.breakMinutes) }
  const d = diff(prev, next)
  if (!d.changed.length) return deny('Nothing has changed.')
  upsertVersion(versions, effectiveFrom, next, user)
  save(s)
  audit(user, 'Working hours changed', [companyId], `${s.companies[companyId].displayName} default hours`, `Effective from ${effectiveFrom}. Applies only to employees without an assigned shift; shift assignments are unchanged.`, d)
  return { settings: s }
}

export function validateOvertimeRate(rate, effectiveFrom) {
  const e = {}
  const r = Number(rate)
  if (rate === '' || !Number.isFinite(r) || r < 0 || r > 10000) e.overtimeRate = 'Enter a rate between GH₵0 and GH₵10,000 per hour.'
  else if (Math.round(r * 100) !== r * 100) e.overtimeRate = 'Use at most two decimal places (pesewas).'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) e.effectiveFrom = 'Choose the date the rate takes effect.'
  else if (effectiveFrom < todayKey()) e.effectiveFrom = 'Rates cannot be backdated; choose today or a later date.'
  return e
}

export function saveOvertimeRate(companyId, rate, effectiveFrom, user) {
  if (!canEditCompanySettings(user, companyId)) return deny('You are not authorised to change this company\u2019s overtime rate.')
  const errors = validateOvertimeRate(rate, effectiveFrom)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const versions = s.payVersions[companyId]
  const prev = versionFor(versions, effectiveFrom).values
  const next = { overtimeRate: Number(rate) }
  if (prev.overtimeRate === next.overtimeRate) return deny('Nothing has changed.')
  upsertVersion(versions, effectiveFrom, next, user)
  save(s)
  audit(user, 'Overtime rate changed', [companyId], `${s.companies[companyId].displayName} overtime rate`, `GH₵${prev.overtimeRate} → GH₵${next.overtimeRate} per hour, effective ${effectiveFrom}. Earlier days keep the rate in force at the time.`, { previous: { overtimeRate: prev.overtimeRate }, next })
  return { settings: s }
}

export function validateVat(rate) {
  const r = Number(rate)
  if (rate === '' || !Number.isFinite(r) || r < 0 || r > 100) return { vatRate: 'VAT must be between 0% and 100%.' }
  if (Math.round(r * 100) !== Math.round(r * 100 * 1e6) / 1e6) return { vatRate: 'Use at most two decimal places.' }
  return {}
}

export function saveVatRate(companyId, rate, user) {
  if (!canEditCompanySettings(user, companyId)) return deny('You are not authorised to change this company\u2019s VAT rate.')
  const errors = validateVat(rate)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const prev = s.vat[companyId]?.rate ?? DEFAULT_VAT_RATE
  const next = Number(rate)
  if (prev === next) return deny('Nothing has changed.')
  s.vat[companyId] = { rate: next, updatedBy: user.name, updatedAt: new Date().toISOString() }
  save(s)
  audit(user, 'VAT rate changed', [companyId], `${s.companies[companyId].displayName} VAT`, `${prev}% → ${next}%. VAT is a separate tax setting and is not deducted from overtime pay.`, { previous: { vatRate: prev }, next: { vatRate: next } })
  return { settings: s }
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

export function saveMonitoring(values, user) {
  if (!canEditSystemSettings(user)) return deny()
  const errors = validateMonitoring(values)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const next = {
    ...s.monitoring,
    defaultGeofenceRadius: Number(values.defaultGeofenceRadius),
    responseWindowMinutes: Number(values.responseWindowMinutes),
    repeatedExceptionThreshold: Number(values.repeatedExceptionThreshold),
    faceRequired: Boolean(values.faceRequired),
    gpsRequired: Boolean(values.gpsRequired),
    smsEnabled: Boolean(values.smsEnabled),
    locationProvider: values.locationProvider ?? s.monitoring.locationProvider ?? 'none',
  }
  const d = diff(s.monitoring, next)
  if (!d.changed.length) return deny('Nothing has changed.')
  s.monitoring = next
  save(s)
  audit(user, 'Monitoring settings changed', [], 'Sales Rep Monitoring settings', `Changed: ${d.changed.join(', ')}. No real SMS provider or scheduler is configured by this change.`, d)
  return { settings: s }
}

export function saveNotificationPrefs(prefs, user) {
  if (!canEditSystemSettings(user)) return deny()
  const errors = {}
  Object.entries(prefs).forEach(([k, p]) => {
    if (!NOTIFICATION_GROUPS[k]) errors[k] = 'Unknown notification.'
    else if (!['default', 'critical', 'high', 'medium', 'low'].includes(p.severity)) errors[k] = 'Choose a severity.'
    else if (p.enabled && !p.roles.length) errors[k] = 'Choose at least one role, or turn the notification off.'
  })
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const d = diff(s.notifications, prefs)
  if (!d.changed.length) return deny('Nothing has changed.')
  s.notifications = { ...s.notifications, ...prefs }
  save(s)
  audit(user, 'Notification settings changed', [], 'Notification preferences', `Changed: ${d.changed.map((k) => NOTIFICATION_GROUPS[k].label).join(', ')}. Applies to notifications raised from now on.`, d)
  return { settings: s }
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

export function saveSecurity(values, user) {
  if (!canEditSystemSettings(user)) return deny()
  const errors = validateSecurity(values)
  if (Object.keys(errors).length) return { errors }
  const s = getSettings()
  const next = {
    ...s.security,
    sessionTimeoutMinutes: Number(values.sessionTimeoutMinutes),
    loginAttemptLimit: Number(values.loginAttemptLimit),
    passwordMinLength: Number(values.passwordMinLength),
    passwordRequireMixed: Boolean(values.passwordRequireMixed),
  }
  const d = diff(s.security, next)
  if (!d.changed.length) return deny('Nothing has changed.')
  s.security = next
  save(s)
  audit(user, 'Security preferences changed', [], 'Security settings', `Changed: ${d.changed.join(', ')}. Demonstration preferences only; production security must be enforced by the backend.`, d)
  return { settings: s }
}

/** Record a configuration export (demo). Returns the JSON text. */
export function exportConfiguration(user) {
  if (!can(user, 'settings', 'view')) return { error: 'You are not authorised to export the configuration.' }
  const s = getSettings()
  const at = new Date().toISOString()
  const prev = s.data.lastConfigExportAt
  s.data = { ...s.data, lastConfigExportAt: at }
  save(s)
  recordAuditEvent({
    action: 'Configuration exported',
    category: 'System Settings',
    source: 'Data Management',
    actor: { name: user.name, role: user.role },
    companyIds: [],
    affected: 'System configuration',
    description: 'Configuration downloaded as JSON (demo export, not a backup).',
    previous: { lastConfigExportAt: prev },
    next: { lastConfigExportAt: at },
  })
  const { general, companies, attendanceVersions, workingHoursVersions, payVersions, vat, monitoring, notifications, security } = s
  return {
    json: JSON.stringify({ exportedAt: at, note: 'Mock configuration from the Workforce Pro prototype. Not a database backup.', general: { ...general, logo: general.logo ? '(image omitted)' : null }, companies, attendanceVersions, workingHoursVersions, payVersions, vat, monitoring, notifications, security, fixedRules: { cycle: `${CYCLE_START_DAY}th to ${CYCLE_END_DAY}th`, timezone: TIMEZONE, checksPerShift: CHECKS_PER_SHIFT } }, null, 2),
  }
}
