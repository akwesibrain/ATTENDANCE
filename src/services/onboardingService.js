/**
 * HR onboarding in the browser: adding employees, face setup links, and who
 * can use the HR portal. The server checks every rule again.
 *
 * Link results look like { token, expiresAt, sms: 'sent'|'skipped'|'failed', smsReason }.
 */

import { api, checkPassword, submit, supabase } from './backend/client'
import { validatePasswordChange } from '../../supabase/functions/_shared/rules/onboarding.js'
import { refresh } from './backend/cache'

const LINK_PATHS = { face: '/enroll/', 'hr-invite': '/hr/setup/', 'password-reset': '/hr/reset/' }

export function setupLinkUrl(origin, kind, token) {
  return `${origin}${LINK_PATHS[kind]}${token}`
}

export const enrolUrl = (token) => setupLinkUrl(window.location.origin, 'face', token)
export const hrSetupUrl = (token) => setupLinkUrl(window.location.origin, 'hr-invite', token)
export const passwordResetUrl = (token) => setupLinkUrl(window.location.origin, 'password-reset', token)

/** The request body for HR adding an employee, with or without a face. */
export function hrEmployeeBody(registration, { sendFaceLink = false } = {}) {
  const withFace = Boolean(registration.faceImage)
  const body = {
    companyId: registration.companyId,
    firstName: registration.firstName,
    middleName: registration.middleName,
    lastName: registration.lastName,
    phone: registration.phone,
    email: registration.email,
    address: registration.address,
    emergencyContactName: registration.emergencyContactName,
    emergencyContactPhone: registration.emergencyContactPhone,
    paymentMethod: registration.paymentMethod,
    position: registration.position,
    shopMode: registration.shopMode,
    assignedShopId: registration.assignedShopId,
    newShop: registration.newShop,
    biometricConsent: registration.confirmed === true,
    sendFaceLink: !withFace && sendFaceLink,
  }
  if (withFace) {
    body.faceImage = registration.faceImage
    body.faceDescriptor = registration.faceDescriptor
  }
  return body
}

/* ------------------------------------------------------------------ Employees (HR) */

/** @returns {Promise<{ staffId, fullName, companyName, link? } | { error, errors }>} */
export async function createEmployeeByHr(registration, options) {
  const result = await submit('/hr/employees', { method: 'POST', body: hrEmployeeBody(registration, options) })
  if (!result.errors) await refresh('employees', 'shops', 'audit_events')
  return result
}

export async function sendFaceLink(staffId) {
  const result = await submit(`/hr/employees/${encodeURIComponent(staffId)}/face-link`, { method: 'POST', body: {} })
  if (!result.errors) await refresh('audit_events')
  return result
}

/* ------------------------------------------------------------------ Face setup (employee, no sign-in) */

export function getEnrolment(token) {
  return api(`/public/enroll/${encodeURIComponent(token)}`)
}

export function submitEnrolment(token, { faceImage, faceDescriptor, biometricConsent }) {
  return submit(`/public/enroll/${encodeURIComponent(token)}`, { method: 'POST', body: { faceImage, faceDescriptor, biometricConsent } })
}

/* ------------------------------------------------------------------ HR portal access (HR) */

/** @returns {Promise<{ users, invites }>} */
export function listHrAccess() {
  return api('/hr/users')
}

export function inviteHrUser({ name, email, phone }) {
  return submit('/hr/invites', { method: 'POST', body: { name, email, phone } })
}

export function resendInvite(inviteId) {
  return submit(`/hr/invites/${encodeURIComponent(inviteId)}/link`, { method: 'POST', body: {} })
}

export function cancelInvite(inviteId) {
  return submit(`/hr/invites/${encodeURIComponent(inviteId)}/cancel`, { method: 'POST', body: {} })
}

export function setHrUserStatus(userId, status) {
  return submit(`/hr/users/${encodeURIComponent(userId)}/status`, { method: 'POST', body: { status } })
}

/* ------------------------------------------------------------------ HR setup page (invited person, no sign-in) */

export function getHrSetup(token) {
  return api(`/public/hr-setup/${encodeURIComponent(token)}`)
}

export function completeHrSetup(token, { password, confirm } = {}) {
  return submit(`/public/hr-setup/${encodeURIComponent(token)}`, { method: 'POST', body: { password, confirm } })
}

/* ------------------------------------------------------------------ Passwords (HR) */

/**
 * Change the signed-in HR user's own password. It is changed from this
 * session, which keeps it signed in and signs the account out everywhere else.
 * @returns {Promise<{ ok: true } | { error, errors }>}
 */
export async function changeMyPassword(input) {
  const refused = (errors) => ({ error: Object.values(errors)[0], errors })
  const parsed = validatePasswordChange(input)
  if (parsed.errors) return refused(parsed.errors)
  const { data } = await supabase.auth.getUser()
  const email = data?.user?.email
  if (!email || !(await checkPassword(email, parsed.value.current))) {
    return refused({ current: 'That is not your current password.' })
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.value.password })
  if (error) return refused({ password: `That password was not accepted: ${error.message}` })
  await Promise.resolve(supabase.auth.signOut?.({ scope: 'others' })).catch(() => {})
  // The password has changed; a missed audit line must not say otherwise.
  await submit('/hr/me/password-changed', { method: 'POST', body: {} }).catch(() => {})
  return { ok: true }
}

/** @param {'link'|'temporary'} mode  @returns {Promise<{ token, expiresAt } | { password } | { error, errors }>} */
export async function resetHrPassword(userId, mode) {
  const result = await submit(`/hr/users/${encodeURIComponent(userId)}/password-reset`, { method: 'POST', body: { mode } })
  if (!result.errors) await refresh('audit_events')
  return result
}

export async function resetHrAuthenticator(userId) {
  const result = await submit(`/hr/users/${encodeURIComponent(userId)}/authenticator-reset`, { method: 'POST', body: {} })
  if (!result.errors) await refresh('audit_events')
  return result
}

/* ------------------------------------------------------------------ Password reset page (no sign-in) */

export function getPasswordReset(token) {
  return api(`/public/password-reset/${encodeURIComponent(token)}`)
}

export function completePasswordReset(token, { password, confirm }) {
  return submit(`/public/password-reset/${encodeURIComponent(token)}`, { method: 'POST', body: { password, confirm } })
}
