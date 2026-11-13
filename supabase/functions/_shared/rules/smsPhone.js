/**
 * Phone numbers for the SMS gateway. Staff type numbers many ways
 * ("024 123 4567", "+233 24 123 4567", "233241234567"); the gateway wants
 * digits only, in international form without the plus.
 */

const GHANA_CODE = '233'

/** International digits for a phone number, or '' when it cannot be sent to. */
export function smsRecipient(value) {
  if (typeof value !== 'string') return ''
  let digits = value.replace(/\D/g, '')
  if (value.trim().startsWith('00')) digits = digits.slice(2)

  // A local Ghana number: 0 followed by nine digits.
  if (digits.length === 10 && digits.startsWith('0')) return GHANA_CODE + digits.slice(1)
  // Nine digits with the leading 0 left off.
  if (digits.length === 9 && !digits.startsWith('0')) return GHANA_CODE + digits
  // Already international. Fix the common "+233 0..." slip.
  if (digits.startsWith(GHANA_CODE + '0') && digits.length === 13) return GHANA_CODE + digits.slice(4)
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0')) return digits
  return ''
}
