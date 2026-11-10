/**
 * HR portal settings: reads come from the loaded facts, saves go to the server,
 * which validates them again and writes the audit entry.
 */

import { PERIOD_START_DAY } from '../utils/payPeriod'
import { accraTodayKey } from '../utils/accraTime'
import {
  attendanceRulesInForce,
  composeSettings,
  DEFAULT_VAT_RATE,
  hoursInForce,
  notificationPreferenceFor as preferenceFor,
  overtimeRateInForce,
} from '../../supabase/functions/_shared/rules/settings.js'
import { api, submit } from './backend/client'
import { refresh, rows } from './backend/cache'
import { can, canAccessCompany } from './permissionsService'

export {
  CHECKS_PER_SHIFT,
  DEFAULT_OVERTIME_RATE,
  DEFAULT_VAT_RATE,
  LANDING_PAGES,
  NOTIFICATION_GROUPS,
  validateAttendanceRules,
  validateCompany,
  validateGeneral,
  validateMonitoring,
  validateOvertimeRate,
  validateSecurity,
  validateVat,
  validateWorkingHours,
} from '../../supabase/functions/_shared/rules/settings.js'

export const TIMEZONE = 'Africa/Accra'
export const CYCLE_START_DAY = PERIOD_START_DAY
export const CYCLE_END_DAY = PERIOD_START_DAY - 1

let memo = { general: null, companies: null, versions: null, value: null }

export function getSettings() {
  const general = rows('settings_general')
  const companies = rows('settings_company')
  const versions = rows('settings_versions')
  if (memo.general !== general || memo.companies !== companies || memo.versions !== versions) {
    memo = { general, companies, versions, value: composeSettings({ general, companies, versions }) }
  }
  return structuredClone(memo.value)
}

function current() {
  getSettings()
  return memo.value
}

const newestFirst = (versions) => versions.slice().sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))

export function attendanceRulesFor(dateKey = accraTodayKey()) {
  return attendanceRulesInForce(current(), dateKey)
}

export function defaultHoursFor(companyId, dateKey = accraTodayKey()) {
  return hoursInForce(current(), companyId, dateKey)
}

export function overtimeRateFor(companyId, dateKey = accraTodayKey()) {
  return overtimeRateInForce(current(), companyId, dateKey)
}

export function overtimeRateVersions(companyId) {
  return newestFirst(current().payVersions[companyId] ?? [])
}

export function vatRateFor(companyId) {
  return Number(current().vat[companyId]?.rate ?? DEFAULT_VAT_RATE)
}

export function vatSetting(companyId) {
  return current().vat[companyId] ?? { rate: DEFAULT_VAT_RATE }
}

export function monitoringSettings() {
  return current().monitoring
}

export function generalSettings() {
  return current().general
}

export function companySettings(companyId) {
  return current().companies[companyId] ?? null
}

export function companyDisplayName(companyId, fallback = '') {
  return companySettings(companyId)?.displayName || fallback
}

export function notificationPreferenceFor(type) {
  return preferenceFor(type, current().notifications)
}

export function securitySettings() {
  return current().security
}

export function attendanceRuleVersions() {
  return newestFirst(current().attendanceVersions)
}

export function workingHoursVersions(companyId) {
  return newestFirst(current().workingHoursVersions[companyId] ?? [])
}

export function canEditSystemSettings(user) {
  return can(user, 'settings', 'manage')
}

export function canEditCompanySettings(user, companyId) {
  return (can(user, 'settings', 'edit') || can(user, 'settings', 'manage')) && canAccessCompany(user, companyId)
}

/** Save, then reload what changed so the screen shows the stored values. */
async function save(path, body, tables) {
  const result = await submit(path, { method: 'PUT', body })
  if (result.errors) return result
  await refresh(...tables, 'audit_events')
  return { settings: getSettings() }
}

const GENERAL = ['settings_general']
const COMPANY = ['settings_company']
const VERSIONS = ['settings_versions']

export const saveGeneral = (values) => save('/hr/settings/general', values, GENERAL)
export const saveCompany = (companyId, values) => save(`/hr/settings/company/${companyId}`, values, COMPANY)
export const saveAttendanceRules = (values, effectiveFrom) => save('/hr/settings/attendance', { values, effectiveFrom }, VERSIONS)
export const saveWorkingHours = (companyId, values, effectiveFrom) => save(`/hr/settings/working-hours/${companyId}`, { values, effectiveFrom }, VERSIONS)
export const saveOvertimeRate = (companyId, rate, effectiveFrom) => save(`/hr/settings/overtime/${companyId}`, { rate, effectiveFrom }, VERSIONS)
export const saveVatRate = (companyId, rate) => save(`/hr/settings/vat/${companyId}`, { rate }, COMPANY)
export const saveMonitoring = (values) => save('/hr/settings/monitoring', values, GENERAL)
export const saveNotificationPrefs = (prefs) => save('/hr/settings/notifications', prefs, GENERAL)
export const saveSecurity = (values) => save('/hr/settings/security', values, GENERAL)

/** Log the export on the server, then build the file from what HR can read. */
export async function exportConfiguration(user) {
  if (!can(user, 'settings', 'view')) return { error: 'You are not authorised to export the configuration.' }
  const { at } = await api('/hr/settings/export', { method: 'POST', body: {} })
  await refresh('settings_general', 'audit_events')
  const { general, companies, attendanceVersions, workingHoursVersions: hours, payVersions, vat, monitoring, notifications, security } = getSettings()
  return {
    json: JSON.stringify({
      exportedAt: at,
      note: 'Workforce Pro configuration. Not a database backup.',
      general: { ...general, logo: general.logo ? '(image omitted)' : null },
      companies,
      attendanceVersions,
      workingHoursVersions: hours,
      payVersions,
      vat,
      monitoring,
      notifications,
      security,
      fixedRules: { cycle: `${CYCLE_START_DAY}th to ${CYCLE_END_DAY}th`, timezone: TIMEZONE },
    }, null, 2),
  }
}
