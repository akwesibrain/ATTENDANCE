/**
 * HR onboarding in the browser: adding employees, face setup links, and who
 * can use the HR portal. The server checks every rule again.
 *
 * Link results look like { token, expiresAt, sms: 'sent'|'skipped'|'failed', smsReason }.
 */

import { api, submit } from './backend/client'
import { refresh } from './backend/cache'

const LINK_PATHS = { face: '/enroll/', 'hr-invite': '/hr/setup/' }

export function setupLinkUrl(origin, kind, token) {
  return `${origin}${LINK_PATHS[kind]}${token}`
}

export const enrolUrl = (token) => setupLinkUrl(window.location.origin, 'face', token)
export const hrSetupUrl = (token) => setupLinkUrl(window.location.origin, 'hr-invite', token)

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
