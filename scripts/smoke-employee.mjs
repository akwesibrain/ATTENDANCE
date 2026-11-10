/**
 * Live test of the employee routes against the hosted project.
 *
 * It uses real Staff ID numbers and leaves test rows behind, all named
 * "Smoke Test ...". Clear them before real employees register.
 *
 * Usage: node scripts/smoke-employee.mjs
 */

import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)
const API = `${env.VITE_SUPABASE_URL}/functions/v1/api`

let failures = 0
function check(name, passed, detail) {
  console.log(`${passed ? 'pass' : 'FAIL'}  ${name}${passed || detail === undefined ? '' : `  ->  ${JSON.stringify(detail)}`}`)
  if (!passed) failures += 1
}

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, json: await response.json().catch(() => null) }
}

/** A repeatable blocky test picture; each seed gives a different one. */
function picture(seed) {
  const width = 320
  const height = 240
  const data = Buffer.alloc(width * height * 4)
  let state = seed
  const blocks = Array.from({ length: 1024 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 24
  })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = blocks[Math.floor(y / 8) * 32 + Math.floor(x / 10)]
      data.set([value, value, value, 255], (y * width + x) * 4)
    }
  }
  return `data:image/jpeg;base64,${jpeg.encode({ data, width, height }, 80).data.toString('base64')}`
}

const face = picture(1)
const otherFace = picture(99)
const form = (suffix, extra = {}) => ({
  companyId: 'double-a',
  firstName: 'Smoke',
  lastName: `Test ${suffix}`,
  phone: '+233 24 000 0000',
  paymentMethod: 'bank',
  position: 'Warehouse Worker',
  biometricConsent: true,
  faceImage: face,
  ...extra,
})

const shops = await call('GET', '/public/shops?companyId=box-for-less')
check('public shop list works', shops.status === 200 && shops.json.shops.length >= 1, shops)
check('public shop list hides locations', !JSON.stringify(shops.json).match(/latitude|longitude/))

for (const [name, extra] of [
  ['no consent', { biometricConsent: false }],
  ['self-assigned HR role', { position: 'HR Manager' }],
  ['field role with no shop', { position: 'Merchandiser' }],
  ['missing photo', { faceImage: undefined }],
  ['PNG photo', { faceImage: 'data:image/png;base64,iVBORw0KGgo=' }],
]) {
  const refused = await call('POST', '/employees/register', form('Refused', extra))
  check(`registration refused: ${name}`, refused.status === 400, refused)
}

const unknownCompany = await call('POST', '/employees/register', form('Refused', { companyId: 'no-such-company' }))
check('registration refused: unknown company', unknownCompany.status === 409, unknownCompany)

const [first, second] = await Promise.all([
  call('POST', '/employees/register', form('A')),
  call('POST', '/employees/register', form('B')),
])
check('two registrations at once both succeed', first.status === 201 && second.status === 201, { first, second })
const numbers = [first.json.staffId, second.json.staffId].map((id) => Number(id.split('-')[1])).sort((a, b) => a - b)
check('they get different, sequential Staff IDs', numbers[1] === numbers[0] + 1, numbers)
check('Staff ID uses the company prefix', first.json.staffId.startsWith('DAA-'), first.json)

const staffId = first.json.staffId
const lookup = await call('GET', `/attendance/lookup/${staffId.toLowerCase()}`)
check('lookup finds the employee', lookup.status === 200 && lookup.json.staffId === staffId, lookup)
check(
  'lookup returns only what the kiosk needs',
  Object.keys(lookup.json).sort().join() === 'attemptsLeft,blockedReason,companyName,fullName,nextAction,staffId,windowStatus',
  Object.keys(lookup.json),
)

const unknown = await call('GET', '/attendance/lookup/DAA-9999')
check('unknown Staff ID is not found', unknown.status === 404, unknown)
const malformed = await call('GET', '/attendance/lookup/not-a-staff-id')
check('malformed Staff ID is not found', malformed.status === 404, malformed)

const mismatch = await call('POST', '/attendance/events', { staffId, faceImage: otherFace })
if (lookup.json.blockedReason) {
  console.log(`note  check-in is outside its window now: ${lookup.json.blockedReason}`)
  check('a blocked scan is refused before the face check', mismatch.status === 409, mismatch)
} else {
  check('a different face is refused', mismatch.status === 403 && mismatch.json.code === 'face-mismatch', mismatch)
  check('the failed attempt is counted', mismatch.json.attemptsLeft === 4, mismatch)

  const faked = '2020-01-01T08:00:00.000Z'
  const checkIn = await call('POST', '/attendance/events', { staffId, faceImage: face, time: faked, date: '2020-01-01', status: 'on-time' })
  check('the registered face checks in', checkIn.status === 200 && checkIn.json.type === 'check-in', checkIn)
  check('a time sent by the client is ignored', checkIn.json.time?.slice(0, 4) !== '2020' && checkIn.json.date !== '2020-01-01', checkIn)

  const again = await call('GET', `/attendance/lookup/${staffId}`)
  check('next action is now check-out', again.json.nextAction === 'check-out', again)

  const secondId = second.json.staffId
  const scans = await Promise.all(
    [1, 2, 3, 4, 5].map(() => call('POST', '/attendance/events', { staffId: secondId, faceImage: otherFace })),
  )
  check('5 wrong faces are all refused', scans.every((scan) => scan.status === 403), scans)
  check('the 5th marks the employee absent', scans.some((scan) => scan.json.markedAbsent === true), scans.map((s) => s.json))
  const blocked = await call('GET', `/attendance/lookup/${secondId}`)
  check('an absent employee is blocked', /ABSENT/.test(blocked.json.blockedReason ?? ''), blocked)
  const correctAfter = await call('POST', '/attendance/events', { staffId: secondId, faceImage: face })
  check('even the right face is refused after that', correctAfter.status === 409, correctAfter)
}

const blank = await call('POST', '/employees/register', form('Blank', {
  faceImage: (() => {
    const data = Buffer.alloc(100 * 100 * 4, 0)
    return `data:image/jpeg;base64,${jpeg.encode({ data, width: 100, height: 100 }, 80).data.toString('base64')}`
  })(),
}))
check('a blank photo is refused', blank.status === 422, blank)

const route404 = await call('GET', '/no-such-route')
check('unknown routes answer as JSON', route404.status === 404 && route404.json.error === 'Not found.', route404)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exitCode = failures ? 1 : 0
