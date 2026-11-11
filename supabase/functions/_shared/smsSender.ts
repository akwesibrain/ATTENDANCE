/**
 * The server's one SMS interface. To use a real provider, add it here and set
 * the SMS_PROVIDER secret; nothing else depends on how messages are sent.
 *
 * With SMS_PROVIDER unset or 'none', no checks are scheduled, so nobody gets a
 * false "missed check" exception. 'log' prints messages for testing.
 *
 * 'txtconnect' sends through TxtConnect (Ghana). It needs two more secrets:
 * TXTCONNECT_API_KEY and TXTCONNECT_SENDER_ID (the sender name registered with
 * TxtConnect, at most 11 characters).
 */

import { smsRecipient } from './rules/smsPhone.js'

const TXTCONNECT_SEND_URL = 'https://api.txtconnect.net/dev/api/sms/send'
const SEND_TIMEOUT_MS = 15_000

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
    case 'txtconnect':
      return await sendWithTxtConnect(to, message)
    default:
      console.error('unknown SMS provider', smsProvider())
      return false
  }
}

async function sendWithTxtConnect(to: string, message: string): Promise<boolean> {
  const apiKey = Deno.env.get('TXTCONNECT_API_KEY')?.trim()
  const sender = Deno.env.get('TXTCONNECT_SENDER_ID')?.trim()
  if (!apiKey || !sender) {
    console.error('txtconnect is missing TXTCONNECT_API_KEY or TXTCONNECT_SENDER_ID')
    return false
  }
  const recipient = smsRecipient(to)
  if (!recipient) {
    console.error('sms not sent: phone number cannot be used', to.slice(-4))
    return false
  }

  const response = await fetch(TXTCONNECT_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      to: recipient,
      from: sender,
      // The gateway takes true or false here. Plain text is cheaper per message.
      unicode: /[\u0080-￿]/.test(message),
      sms: message,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
  const body = await response.json().catch(() => null)
  const result = body?.data
  if (!response.ok || !result || result.in_error || result.status_code !== '000') {
    console.error('txtconnect refused sms', response.status, result?.status_code, result?.message, JSON.stringify(result?.errors ?? {}))
    return false
  }
  console.log('sms sent via txtconnect', recipient.slice(-4), body.messageId)
  return true
}
