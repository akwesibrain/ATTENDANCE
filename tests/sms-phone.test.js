import { describe, expect, it } from 'vitest'
import { smsRecipient } from '../supabase/functions/_shared/rules/smsPhone.js'

describe('smsRecipient', () => {
  it('turns a local Ghana number into international digits', () => {
    expect(smsRecipient('024 123 4567')).toBe('233241234567')
    expect(smsRecipient('0241234567')).toBe('233241234567')
  })

  it('keeps an international number, dropping the plus and spacing', () => {
    expect(smsRecipient('+233 24 123 4567')).toBe('233241234567')
    expect(smsRecipient('233-24-123-4567')).toBe('233241234567')
    expect(smsRecipient('+44 7700 900123')).toBe('447700900123')
  })

  it('handles the 00 prefix and a stray 0 after the country code', () => {
    expect(smsRecipient('00233241234567')).toBe('233241234567')
    expect(smsRecipient('+233 024 123 4567')).toBe('233241234567')
  })

  it('adds the country code when the leading 0 was left off', () => {
    expect(smsRecipient('241234567')).toBe('233241234567')
  })

  it('refuses numbers that cannot be sent to', () => {
    expect(smsRecipient('')).toBe('')
    expect(smsRecipient('12345')).toBe('')
    expect(smsRecipient('024 123')).toBe('')
    expect(smsRecipient(null)).toBe('')
  })
})
