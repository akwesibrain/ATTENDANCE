/**
 * The server's one SMS interface. To use a real provider, add it here and set
 * the SMS_PROVIDER secret; nothing else depends on how messages are sent.
 *
 * With SMS_PROVIDER unset or 'none', no checks are scheduled, so nobody gets a
 * false "missed check" exception. 'log' prints messages for testing.
 */

export function smsProvider(): string {
  return Deno.env.get('SMS_PROVIDER')?.trim() || 'none'
}

export function smsConfigured(): boolean {
  return smsProvider() !== 'none'
}

/** @returns whether the message was handed over for delivery */
export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!to) return false
  switch (smsProvider()) {
    case 'log':
      console.log('sms (log provider)', to.slice(-4), message)
      return true
    default:
      console.error('unknown SMS provider', smsProvider())
      return false
  }
}
