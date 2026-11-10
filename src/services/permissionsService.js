/**
 * HR sign-in and permission checks.
 *
 * The server enforces every rule on every request, so these checks only decide
 * what to show. There is one HR role today; `hr_users` can hold more later.
 */

import { COMPANIES } from '../constants/companies'
import { api, supabase } from './backend/client'
import { clearCache, hydrate } from './backend/cache'

export const LEVELS = ['view', 'create', 'edit', 'approve', 'export', 'manage']
export const LEVEL_LABELS = { view: 'View', create: 'Create', edit: 'Edit', approve: 'Approve', export: 'Export', manage: 'Manage' }

export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', levels: ['view'] },
  { id: 'employees', label: 'Employees', levels: ['view', 'create', 'edit', 'export'] },
  { id: 'attendance', label: 'Attendance', levels: ['view', 'export'] },
  { id: 'attendance-corrections', label: 'Attendance corrections', levels: ['view', 'create', 'edit'] },
  { id: 'sales-monitoring', label: 'Sales Rep Monitoring', levels: ['view', 'edit', 'export'] },
  { id: 'shops', label: 'Shop Directory', levels: ['view', 'create', 'edit'] },
  { id: 'reports', label: 'Reports & Analytics', levels: ['view', 'export'] },
  { id: 'notifications', label: 'Notifications & Exceptions', levels: ['view', 'edit', 'manage'] },
  { id: 'settings', label: 'Settings', levels: ['view', 'edit', 'manage'] },
  { id: 'audit-logs', label: 'Audit Logs', levels: ['view', 'export'] },
]

const FULL_ACCESS = Object.fromEntries(MODULES.map((m) => [m.id, m.levels.slice()]))
const ROLE_LABELS = { 'hr-manager': 'HR Manager' }

let currentUser = null
let smsProviderName = 'none'

function userFromRow(row) {
  const name = row.name
  return {
    id: row.id,
    name,
    initials: name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
    email: row.email,
    roleId: row.role_id,
    role: ROLE_LABELS[row.role_id] ?? row.role_id,
    companyIds: row.company_ids,
    grants: FULL_ACCESS,
    status: row.status,
  }
}

async function loadHrRow(userId) {
  const { data, error } = await supabase.from('hr_users').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Where this browser's session stands.
 * @returns {Promise<'signed-out'|'no-access'|'mfa-enroll'|'mfa-verify'|'ready'>}
 */
export async function sessionStatus() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return 'signed-out'

  const row = await loadHrRow(data.session.user.id)
  if (!row || row.status !== 'active') {
    await supabase.auth.signOut()
    return 'no-access'
  }

  const { data: level, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw new Error(error.message)
  if (level.currentLevel !== 'aal2') return level.nextLevel === 'aal2' ? 'mfa-verify' : 'mfa-enroll'

  await hydrate()
  const me = await api('/hr/me')
  smsProviderName = me.smsProvider
  currentUser = userFromRow(row)
  return 'ready'
}

const FRIENDLY_SIGN_IN_ERROR = 'That email and password do not match an HR account.'

/** @returns {Promise<string|null>} an error to show, or null */
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (!error) return null
  return error.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : FRIENDLY_SIGN_IN_ERROR
}

let enrollment = null

/** Start authenticator setup. Repeat calls while one is running share its result. */
export function startMfaEnrollment() {
  enrollment ??= enrollAuthenticator().finally(() => { enrollment = null })
  return enrollment
}

/** Discards any setup that was never finished, then begins a new one. */
async function enrollAuthenticator() {
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
  if (listError) throw new Error(listError.message)
  await Promise.all(
    factors.all
      .filter((factor) => factor.factor_type === 'totp' && factor.status !== 'verified')
      .map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })),
  )
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
  if (error) throw new Error(error.message)
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

async function verifyCode(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
  return error ? 'That code is not right. Check your authenticator app and try again.' : null
}

export function confirmMfaEnrollment(factorId, code) {
  return verifyCode(factorId, code)
}

/** @returns {Promise<string|null>} an error to show, or null */
export async function verifyMfa(code) {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  const factor = data.totp[0]
  if (!factor) return 'No authenticator is set up for this account.'
  return verifyCode(factor.id, code)
}

/** Record the sign-in. A failure here must not lock HR out. */
export function recordSignIn() {
  api('/hr/signed-in', { method: 'POST', body: {} }).catch((error) => console.error('Could not log sign-in', error.message))
}

export async function signOut() {
  currentUser = null
  await supabase.auth.signOut().catch(() => {})
  clearCache()
}

export function getSessionUser() {
  return currentUser
}

export function smsConfigured() {
  return smsProviderName !== 'none'
}

export function listHrUsers() {
  return currentUser ? [currentUser] : []
}

export function getHrUser(id) {
  return currentUser?.id === id ? currentUser : null
}

export function isActive(user) {
  return user?.status === 'active'
}

export function can(user, moduleId, level = 'view') {
  if (!isActive(user)) return false
  return (user.grants[moduleId] ?? []).includes(level)
}

export function canAccessCompany(user, companyId) {
  return isActive(user) && user.companyIds.includes(companyId)
}

export function authorisedCompanies(user) {
  return COMPANIES.filter((company) => canAccessCompany(user, company.id))
}

/** Reduce a requested company filter to what the user may see. Never widens access. */
export function scopeCompanyIds(user, requestedCompanyId) {
  const allowed = authorisedCompanies(user).map((company) => company.id)
  if (!requestedCompanyId) return allowed
  return allowed.includes(requestedCompanyId) ? [requestedCompanyId] : []
}
