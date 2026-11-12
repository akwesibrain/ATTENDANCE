/**
 * Rules for HR onboarding: one-time setup links, HR invites and who may change
 * whose HR access. Shared by the browser and the server; the server's check is
 * the one that counts.
 */

import { smsRecipient } from './smsPhone.js'
import { validateOptionalEmail, validateOptionalPhone, validateRequired } from './validation.js'

export const FACE_LINK_HOURS = 168
export const HR_INVITE_HOURS = 24
export const MIN_PASSWORD_LENGTH = 12

export const LINK_UNUSABLE = 'This link has expired or was already used. Ask HR for a new one.'

const LINK_HOURS = { face: FACE_LINK_HOURS, 'hr-invite': HR_INVITE_HOURS }

/** When a link made now stops working, as an ISO time. */
export function linkExpiry(kind, nowMs = Date.now()) {
  const hours = LINK_HOURS[kind]
  if (!hours) throw new Error(`Unknown link kind: ${kind}`)
  return new Date(nowMs + hours * 3_600_000).toISOString()
}

/** @returns {'open'|'used'|'cancelled'|'expired'|'missing'} */
export function linkState(row, nowMs = Date.now()) {
  if (!row) return 'missing'
  if (row.used_at) return 'used'
  if (row.cancelled_at) return 'cancelled'
  if (Date.parse(row.expires_at) <= nowMs) return 'expired'
  return 'open'
}

/** The details HR enters to invite someone to the HR portal. */
export function validateInvite(input) {
  const value = {
    name: clean(input?.name),
    email: clean(input?.email).toLowerCase(),
    phone: clean(input?.phone),
  }
  const errors = {}
  if (value.name.length < 3) errors.name = 'Enter the person’s full name.'
  const emailError = validateRequired(value.email, 'Email') || validateOptionalEmail(value.email)
  if (emailError) errors.email = emailError
  const phoneError = validateOptionalPhone(value.phone)
  if (phoneError) errors.phone = phoneError
  return Object.keys(errors).length ? { errors } : { value }
}

/** Why an HR user may not make this access change, or '' when they may. */
export function hrStatusChangeError({ actorId, targetId, newStatus, activeCount, targetStatus }) {
  if (newStatus !== 'inactive' || targetStatus !== 'active') return ''
  if (actorId === targetId) return 'You cannot remove your own access.'
  if (activeCount <= 1) return 'At least one person must keep HR access.'
  return ''
}

export function validateNewPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirm) return 'The two passwords do not match.'
  return ''
}

/** Whether a setup link can go out by SMS, and why not when it cannot. */
export function smsPlan({ phone, smsOn, appUrl }) {
  if (!smsOn) return { send: false, reason: 'SMS is switched off.' }
  if (!appUrl) return { send: false, reason: 'The app address (APP_URL) is not set.' }
  if (!smsRecipient(phone ?? '')) return { send: false, reason: 'No usable phone number.' }
  return { send: true, reason: '' }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Why a face setup link cannot go to this employee, or '' when it can. */
export function faceLinkRefusal(employee) {
  return employee?.status === 'ACTIVE' ? '' : 'This employee is not active. Reactivate them first.'
}

/**
 * An invite only adds HR access to an existing sign-in when the person
 * accepting it is signed in as that account, so knowing an address and its
 * invite link is not enough to claim someone else's account.
 */
export function existingAccountRefusal({ accountId, callerId }) {
  return callerId && callerId === accountId ? '' : 'Sign in with your existing password to accept this invite.'
}
