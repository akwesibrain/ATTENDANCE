import { describe, expect, it, vi } from 'vitest'
import {
  PASSWORD_RESET_HOURS,
  linkExpiry,
  passwordResetRefusal,
  temporaryPassword,
  validateNewPassword,
  validatePasswordChange,
} from '../supabase/functions/_shared/rules/onboarding.js'

const { updateUser, checkPassword, submit } = vi.hoisted(() => ({ updateUser: vi.fn(), checkPassword: vi.fn(), submit: vi.fn() }))
vi.mock('../src/services/backend/client', () => ({
  api: vi.fn(),
  submit,
  checkPassword,
  supabase: { auth: { updateUser, getUser: async () => ({ data: { user: { email: 'me@test' } } }) } },
}))
vi.mock('../src/services/backend/cache', () => ({ refresh: vi.fn() }))

const { changeMyPassword, setupLinkUrl } = await import('../src/services/onboardingService.js')

const NOW = Date.parse('2026-11-12T10:00:00Z')

describe('password reset links', () => {
  it('last 24 hours', () => {
    expect(PASSWORD_RESET_HOURS).toBe(24)
    expect(linkExpiry('password-reset', NOW)).toBe('2026-11-13T10:00:00.000Z')
  })

  it('open the reset page', () => {
    expect(setupLinkUrl('https://app.test', 'password-reset', 'abc')).toBe('https://app.test/hr/reset/abc')
  })
})

describe('passwordResetRefusal', () => {
  const target = { id: 'u2', status: 'active' }

  it('allows resetting another active HR user', () => {
    expect(passwordResetRefusal({ actorId: 'u1', target })).toBe('')
  })

  it('refuses your own account', () => {
    expect(passwordResetRefusal({ actorId: 'u2', target })).toBe('Use My password in Settings to change your own password.')
  })

  it('refuses someone whose access was removed', () => {
    expect(passwordResetRefusal({ actorId: 'u1', target: { ...target, status: 'inactive' } }))
      .toBe('This person no longer has HR access. Restore their access first.')
  })

  it('refuses an unknown user', () => {
    expect(passwordResetRefusal({ actorId: 'u1', target: null })).toBe('HR user not found.')
  })
})

describe('temporaryPassword', () => {
  it('is four groups of four easy-to-read characters', () => {
    const password = temporaryPassword()
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/)
    expect(password).not.toMatch(/[01lIoO]/)
  })

  it('meets the password rules', () => {
    const password = temporaryPassword()
    expect(validateNewPassword(password, password)).toBe('')
  })

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => temporaryPassword()))
    expect(seen.size).toBe(50)
  })
})

describe('validatePasswordChange', () => {
  const good = { current: 'old-password-1', password: 'new-password-12', confirm: 'new-password-12' }

  it('accepts a valid change', () => {
    expect(validatePasswordChange(good)).toEqual({ value: { current: 'old-password-1', password: 'new-password-12' } })
  })

  it('needs the current password', () => {
    expect(validatePasswordChange({ ...good, current: '' }).errors.current).toBe('Enter your current password.')
  })

  it('applies the new password rules', () => {
    expect(validatePasswordChange({ ...good, password: 'short', confirm: 'short' }).errors.password).toBe('Use at least 12 characters.')
    expect(validatePasswordChange({ ...good, confirm: 'something-else' }).errors.password).toBe('The two passwords do not match.')
  })

  it('needs a password different from the current one', () => {
    expect(validatePasswordChange({ current: 'same-password-1', password: 'same-password-1', confirm: 'same-password-1' }).errors.password)
      .toBe('Choose a password different from your current one.')
  })
})

describe('changeMyPassword', () => {
  const input = { current: 'old-password-1', password: 'new-password-12', confirm: 'new-password-12' }

  it('stops at invalid input without touching the account', async () => {
    updateUser.mockReset(); checkPassword.mockReset()
    const result = await changeMyPassword({ ...input, confirm: 'nope' })
    expect(result.errors.password).toBe('The two passwords do not match.')
    expect(checkPassword).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('refuses a wrong current password', async () => {
    updateUser.mockReset(); checkPassword.mockReset().mockResolvedValue(false)
    const result = await changeMyPassword(input)
    expect(checkPassword).toHaveBeenCalledWith('me@test', 'old-password-1')
    expect(result.errors.current).toBe('That is not your current password.')
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('changes the password from this session and records it', async () => {
    updateUser.mockReset().mockResolvedValue({ error: null })
    checkPassword.mockReset().mockResolvedValue(true)
    submit.mockReset().mockResolvedValue({ ok: true })
    expect(await changeMyPassword(input)).toEqual({ ok: true })
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-password-12' })
    expect(submit).toHaveBeenCalledWith('/hr/me/password-changed', { method: 'POST', body: {} })
  })

  it('explains when the new password is not accepted', async () => {
    updateUser.mockReset().mockResolvedValue({ error: { message: 'Password is known to be weak' } })
    checkPassword.mockReset().mockResolvedValue(true)
    submit.mockReset()
    const result = await changeMyPassword(input)
    expect(result.errors.password).toBe('That password was not accepted: Password is known to be weak')
    expect(submit).not.toHaveBeenCalled()
  })
})
