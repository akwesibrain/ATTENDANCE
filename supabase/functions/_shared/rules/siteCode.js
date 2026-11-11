/**
 * Workplace QR codes, shared by the display screen and the server.
 *
 * A display shows `<displayId>.<step>.<signature>`, where the step changes every
 * 30 seconds and the signature is an HMAC with a secret only that display and
 * the server know. The server accepts a code that is at most about a minute
 * old and swaps it for a pass, so the employee has time to type their Staff ID
 * and scan their face. A photo of the code sent elsewhere soon stops working.
 */

export const CODE_STEP_SECONDS = 30
/** How many steps back a code is still accepted, on top of the current one. */
export const CODE_GRACE_STEPS = 2
export const PASS_MINUTES = 10

const DISPLAY_ID = /^dsp-[a-f0-9]{16}$/
const SIGNATURE = /^[A-Za-z0-9_-]{16}$/
const encoder = new TextEncoder()

function base64Url(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A new random secret for a display, or a one-time setup token. */
export function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function newDisplayId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `dsp-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  return base64Url(mac.slice(0, 12))
}

/** Compares without stopping at the first difference, so timing reveals nothing. */
function sameText(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function codeStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / CODE_STEP_SECONDS)
}

/** Milliseconds until the code on screen changes. */
export function msUntilNextStep(nowMs = Date.now()) {
  const stepMs = CODE_STEP_SECONDS * 1000
  return stepMs - (nowMs % stepMs)
}

export async function makeSiteCode(displayId, secret, nowMs = Date.now()) {
  const step = codeStep(nowMs)
  return `${displayId}.${step}.${await sign(secret, `code:${displayId}:${step}`)}`
}

/** @returns {{ displayId: string, step: number, signature: string } | null} */
export function parseSiteCode(text) {
  if (typeof text !== 'string') return null
  const [displayId, step, signature, extra] = text.split('.')
  if (extra !== undefined || !DISPLAY_ID.test(displayId ?? '') || !/^\d{1,12}$/.test(step ?? '') || !SIGNATURE.test(signature ?? '')) return null
  return { displayId, step: Number(step), signature }
}

/** @returns {Promise<'valid'|'expired'|'invalid'>} */
export async function checkSiteCode(text, secret, nowMs = Date.now()) {
  const code = parseSiteCode(text)
  if (!code) return 'invalid'
  const expected = await sign(secret, `code:${code.displayId}:${code.step}`)
  if (!sameText(expected, code.signature)) return 'invalid'
  const now = codeStep(nowMs)
  // One step ahead allows for a display clock that runs slightly fast.
  return code.step >= now - CODE_GRACE_STEPS && code.step <= now + 1 ? 'valid' : 'expired'
}

/** The pass the check-in page keeps after a successful scan. */
export async function makeSitePass(displayId, secret, nowMs = Date.now()) {
  const expires = Math.floor(nowMs / 1000) + PASS_MINUTES * 60
  return { pass: `${displayId}.${expires}.${await sign(secret, `pass:${displayId}:${expires}`)}`, expiresAt: new Date(expires * 1000).toISOString() }
}

/** The display a pass names, without checking it. */
export function passDisplayId(text) {
  return parseSiteCode(text)?.displayId ?? null
}

/** @returns {Promise<boolean>} */
export async function checkSitePass(text, secret, nowMs = Date.now()) {
  const pass = parseSiteCode(text)
  if (!pass) return false
  const expected = await sign(secret, `pass:${pass.displayId}:${pass.step}`)
  return sameText(expected, pass.signature) && pass.step * 1000 > nowMs
}

/** The address the QR code opens. */
export function siteCodeUrl(origin, code) {
  return `${origin}/attendance?site=${encodeURIComponent(code)}`
}
