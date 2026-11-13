import { describe, expect, it } from 'vitest'
import {
  existingAccountRefusal,
  faceLinkRefusal,
  FACE_LINK_HOURS,
  HR_INVITE_HOURS,
  LINK_UNUSABLE,
  MIN_PASSWORD_LENGTH,
  hrStatusChangeError,
  linkExpiry,
  linkState,
  smsPlan,
  validateInvite,
  validateNewPassword,
} from '../supabase/functions/_shared/rules/onboarding.js'
import { parseRegistration } from '../supabase/functions/_shared/rules/registration.js'

const NOW = Date.parse('2026-11-12T10:00:00Z')

describe('setup links', () => {
  it('lasts 7 days for faces and 24 hours for HR invites', () => {
    expect(FACE_LINK_HOURS).toBe(168)
    expect(HR_INVITE_HOURS).toBe(24)
    expect(linkExpiry('face', NOW)).toBe('2026-11-19T10:00:00.000Z')
    expect(linkExpiry('hr-invite', NOW)).toBe('2026-11-13T10:00:00.000Z')
  })

  it('reports the state of a link', () => {
    const open = { expires_at: '2026-11-13T00:00:00Z', used_at: null, cancelled_at: null }
    expect(linkState(open, NOW)).toBe('open')
    expect(linkState({ ...open, used_at: '2026-11-12T09:00:00Z' }, NOW)).toBe('used')
    expect(linkState({ ...open, cancelled_at: '2026-11-12T09:00:00Z' }, NOW)).toBe('cancelled')
    expect(linkState({ ...open, expires_at: '2026-11-12T09:59:59Z' }, NOW)).toBe('expired')
    expect(linkState(null, NOW)).toBe('missing')
  })

  it('has one message for every unusable link', () => {
    expect(LINK_UNUSABLE).toBe('This link has expired or was already used. Ask HR for a new one.')
  })
})

describe('validateInvite', () => {
  it('trims every field and lowercases the email', () => {
    expect(validateInvite({ name: ' Ama Owusu ', email: ' Amponsah@Gmail.com ', phone: '' }).value)
      .toEqual({ name: 'Ama Owusu', email: 'amponsah@gmail.com', phone: '' })
  })

  it('rejects a short name, a bad email and a bad phone', () => {
    const { errors } = validateInvite({ name: 'Al', email: 'nope', phone: '12' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'phone'])
  })

  it('requires an email', () => {
    expect(validateInvite({ name: 'Ama Owusu', email: ' ', phone: '' }).errors.email).toBeTruthy()
  })
})

describe('hrStatusChangeError', () => {
  const base = { actorId: 'a', targetId: 'b', newStatus: 'inactive', activeCount: 2, targetStatus: 'active' }

  it('allows removing someone else while another HR user stays active', () => {
    expect(hrStatusChangeError(base)).toBe('')
  })

  it('refuses removing yourself', () => {
    expect(hrStatusChangeError({ ...base, targetId: 'a' })).toBe('You cannot remove your own access.')
  })

  it('refuses removing the last active HR user', () => {
    expect(hrStatusChangeError({ ...base, activeCount: 1 })).toBe('At least one person must keep HR access.')
  })

  it('allows restoring access', () => {
    expect(hrStatusChangeError({ ...base, newStatus: 'active', targetStatus: 'inactive', activeCount: 1 })).toBe('')
  })
})

describe('validateNewPassword', () => {
  it('needs 12 characters and a matching confirmation', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
    expect(validateNewPassword('short', 'short')).toBe('Use at least 12 characters.')
    expect(validateNewPassword('long-enough-1', 'long-enough-2')).toBe('The two passwords do not match.')
    expect(validateNewPassword('long-enough-1', 'long-enough-1')).toBe('')
  })
})

describe('smsPlan', () => {
  const ok = { phone: '024 123 4567', smsOn: true, appUrl: 'https://app.example' }

  it('sends when everything is in place', () => {
    expect(smsPlan(ok)).toEqual({ send: true, reason: '' })
  })

  it('explains why it will not send', () => {
    expect(smsPlan({ ...ok, smsOn: false })).toEqual({ send: false, reason: 'SMS is switched off.' })
    expect(smsPlan({ ...ok, appUrl: '' })).toEqual({ send: false, reason: 'The app address (APP_URL) is not set.' })
    expect(smsPlan({ ...ok, phone: '12' })).toEqual({ send: false, reason: 'No usable phone number.' })
    expect(smsPlan({ ...ok, phone: '' })).toEqual({ send: false, reason: 'No usable phone number.' })
  })
})

describe('parseRegistration without a face', () => {
  const body = {
    companyId: 'box-for-less',
    firstName: 'Ama',
    lastName: 'Owusu',
    phone: '0241234567',
    email: '',
    address: 'Accra',
    emergencyContactName: 'Kofi Owusu',
    emergencyContactPhone: '0201234567',
    paymentMethod: 'mobile-money',
    position: 'Cashier',
  }

  it('still requires consent by default', () => {
    expect(parseRegistration(body).errors.biometricConsent).toBeTruthy()
  })

  it('skips consent when HR adds the employee without a face', () => {
    const result = parseRegistration(body, { faceRequired: false })
    expect(result.errors?.biometricConsent).toBeUndefined()
  })
})

describe('faceLinkRefusal (final review: Critical 1)', () => {
  it('allows a face link for an active employee, whose status is stored as ACTIVE', () => {
    expect(faceLinkRefusal({ status: 'ACTIVE' })).toBe('')
  })
  it('refuses an inactive employee', () => {
    expect(faceLinkRefusal({ status: 'INACTIVE' })).toBe('This employee is not active. Reactivate them first.')
  })
})

describe('existingAccountRefusal (final review: Important 3)', () => {
  it('accepts only when the caller is signed in as that account', () => {
    expect(existingAccountRefusal({ accountId: 'u1', callerId: 'u1' })).toBe('')
  })
  it('refuses when nobody is signed in, or someone else is', () => {
    const message = 'Sign in with your existing password to accept this invite.'
    expect(existingAccountRefusal({ accountId: 'u1', callerId: null })).toBe(message)
    expect(existingAccountRefusal({ accountId: 'u1', callerId: 'u2' })).toBe(message)
  })
})
