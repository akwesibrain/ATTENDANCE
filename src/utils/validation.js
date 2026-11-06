/**
 * Reusable field validators for the registration flow.
 * Each validator returns an error message string, or '' when valid.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_PATTERN = /^\+?[0-9\s().-]{7,20}$/

export function validateRequired(value, fieldLabel) {
  return value && value.trim() ? '' : `${fieldLabel} is required.`
}

export function validatePhone(value, fieldLabel = 'Phone number') {
  if (!value || !value.trim()) return `${fieldLabel} is required.`
  const digits = value.replace(/\D/g, '')
  if (!PHONE_PATTERN.test(value.trim()) || digits.length < 7 || digits.length > 15) {
    return `Enter a valid ${fieldLabel.toLowerCase()} (7–15 digits, may start with +).`
  }
  return ''
}

export function validateOptionalPhone(value, fieldLabel = 'Phone number') {
  if (!value || !value.trim()) return ''
  return validatePhone(value, fieldLabel)
}

export function validateOptionalEmail(value) {
  if (!value || !value.trim()) return ''
  return EMAIL_PATTERN.test(value.trim())
    ? ''
    : 'Enter a valid email address (e.g. name@example.com).'
}
