/**
 * Live test of outlet visits against the hosted project.
 *
 * Sessions are made with SQL, as the server makes them at check-in. Checks
 * that need a real face match run only when the live face provider is
 * face-api (GET /hr/me reports it); otherwise they are reported as skipped.
 * Everything the script creates is deleted at the end. Audit rows stay.
 *
 * Usage: node scripts/smoke-outlet-visits.mjs
 */

import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import jpeg from 'jpeg-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)
const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const API = `${URL_BASE}/functions/v1/api`
const REF = new URL(URL_BASE).hostname.split('.')[0]
const ACCESS = process.env.SUPABASE_ACCESS_TOKEN
const DOMAIN = 'workforce-test.example.com'
const BFL = 'box-for-less'
const DAA = 'double-a'
const SHOP_ID = 'smoke-visits-shop-1'
const SHOP = { latitude: 5.6037, longitude: -0.187 }
const METRES_PER_DEG_LNG = 111320 * Math.cos((SHOP.latitude * Math.PI) / 180)

let failures = 0
function check(name, passed, detail) {
  console.log(`${passed ? 'pass' : 'FAIL'}  ${name}${passed || detail === undefined ? '' : `  ->  ${JSON.stringify(detail).slice(0, 400)}`}`)
  if (!passed) failures += 1
}

async function sql(query) {
  if (ACCESS) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ACCESS}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(`SQL failed: ${JSON.stringify(body)}`)
    return body
  }
  const dir = mkdtempSync(join(tmpdir(), 'smoke-sql-'))
  try {
    writeFileSync(join(dir, 'q.sql'), query)
    const out = execFileSync('npx', ['supabase', 'db', 'query', `--remote=${REF}`, '--yes', '-f', join(dir, 'q.sql')], { encoding: 'utf8', shell: true })
    return JSON.parse(out.slice(out.indexOf('{'))).rows
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function call(method, path, body, token) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, json: await response.json().catch(() => null) }
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '')) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hash = createHmac('sha1', key).update(counter).digest()
  const offset = hash[19] & 15
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

/** Signs in and enrols an authenticator; returns the client and its MFA token. */
async function signInWithMfa(email, password) {
  const auth = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await auth.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  const enrolled = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'smoke' })
  if (enrolled.error) throw new Error(`enroll failed: ${enrolled.error.message}`)
  const verified = await auth.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) })
  if (verified.error) throw new Error(`mfa failed: ${verified.error.message}`)
  return { auth, token: (await auth.auth.getSession()).data.session.access_token }
}

async function makeHr(label, companyIds) {
  const email = `smoke-visit-${label}@${DOMAIN}`
  const password = randomBytes(18).toString('base64url')
  await sql(`
    with u as (
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
      returning id
    ), i as (
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', '${email}', 'email_verified', true), 'email', now(), now(), now() from u
    ), h as (
      insert into public.hr_users (id, name, email, company_ids) select u.id, 'Smoke Test Visits ${label}', '${email}', array[${companyIds.map((id) => `'${id}'`).join(',')}] from u
    )
    select id from u`)
  return await signInWithMfa(email, password)
}

const TEST_STAFF = `select staff_id from public.employees where full_name like 'Smoke Visits%'`

async function cleanUp() {
  await sql(`
    delete from public.outlet_visits where staff_id in (${TEST_STAFF});
    delete from public.visit_face_attempts where staff_id in (${TEST_STAFF});
    delete from public.face_attempts where employee_id in (${TEST_STAFF});
    delete from public.face_templates where employee_id in (${TEST_STAFF});
    delete from public.tracking_flags where staff_id in (${TEST_STAFF});
    delete from public.tracking_latest where staff_id in (${TEST_STAFF});
    delete from public.tracking_day_summaries where staff_id in (${TEST_STAFF});
    delete from public.location_points where staff_id in (${TEST_STAFF});
    delete from public.tracking_sessions where staff_id in (${TEST_STAFF});
    delete from public.attendance_events where employee_id in (${TEST_STAFF});
    delete from public.employee_shop_changes where staff_id in (${TEST_STAFF});
    delete from public.employee_shops where staff_id in (${TEST_STAFF});
    delete from public.shop_assignments where employee_id in (${TEST_STAFF});
    delete from public.employees where full_name like 'Smoke Visits%';
    delete from public.shops where shop_id like 'smoke-visits-%';
    delete from public.hr_users where name like 'Smoke Test Visits%';
    delete from auth.users where email like 'smoke-visit-%@${DOMAIN}';`)
}

const accraDate = (ms) => new Date(ms).toISOString().slice(0, 10) // Accra is UTC
const hash = (token) => createHash('sha256').update(token, 'utf8').digest('hex')

let people = 0
/** A Sales Rep added through HR, with the test shop as their only shop. */
async function addRep(hrToken, position = 'Sales Representative') {
  people += 1
  const created = await call('POST', '/hr/employees', {
    companyId: BFL, firstName: 'Smoke', lastName: `Visits ${people}`, phone: '0241234567', email: '', address: 'Accra',
    emergencyContactName: '', emergencyContactPhone: '', paymentMethod: 'mobile-money',
    position, assignedShopIds: [SHOP_ID],
  }, hrToken)
  if (created.status !== 201) throw new Error(`could not add a test employee: ${JSON.stringify(created)}`)
  return created.json.staffId
}

/** A check-in event and an open session, as the server makes them. Returns the token. */
async function checkIn(staffId, { clockInMs, closesAtMs, date = accraDate(clockInMs) }) {
  const token = randomBytes(32).toString('base64url')
  await sql(`
    insert into public.attendance_events (employee_id, company_id, company_name, full_name, type, status, date, occurred_at, source)
    select staff_id, company_id, company_name, full_name, 'check-in', 'on-time', '${date}', '${new Date(clockInMs).toISOString()}', 'smoke'
      from public.employees where staff_id = '${staffId}';
    insert into public.tracking_sessions (staff_id, company_id, date, clock_in_at, closes_at, token_hash)
    select staff_id, company_id, '${date}', '${new Date(clockInMs).toISOString()}', '${new Date(closesAtMs).toISOString()}', '${hash(token)}'
      from public.employees where staff_id = '${staffId}';`)
  return token
}

async function checkOut(staffId, atMs, date = accraDate(atMs)) {
  await sql(`
    insert into public.attendance_events (employee_id, company_id, company_name, full_name, type, status, date, occurred_at, source)
    select staff_id, company_id, company_name, full_name, 'check-out', 'on-time', '${date}', '${new Date(atMs).toISOString()}', 'smoke'
      from public.employees where staff_id = '${staffId}';`)
}

/** A point `metresEast` of the test shop, at `ms`. */
const point = (ms, metresEast = 0, extra = {}) => ({
  latitude: SHOP.latitude, longitude: SHOP.longitude + metresEast / METRES_PER_DEG_LNG, accuracy: 12, recordedAt: new Date(ms).toISOString(), isMock: false, ...extra,
})

const MIN = 60000

/** A repeatable stand-in for a phone's face reading; each seed is a different person. */
function descriptor(seed) {
  let state = seed
  return Array.from({ length: 128 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state / 2 ** 32 - 0.5) * 0.4
  })
}

/** A small grey JPEG; the face-api check compares readings, not pixels. */
function picture(seed) {
  const width = 320
  const height = 240
  const data = Buffer.alloc(width * height * 4, seed % 255)
  return `data:image/jpeg;base64,${jpeg.encode({ data, width, height }, 80).data.toString('base64')}`
}

function skip(name) {
  console.log(`skip  ${name}  (needs FACE_PROVIDER=faceapi)`)
}

const visit = (token, body) => call('POST', '/tracking/visits', body, token)

try {
  await cleanUp()
  await sql(`insert into public.shops (shop_id, company_id, shop_name, town, area, latitude, longitude, location_source)
             values ('${SHOP_ID}', '${BFL}', 'Smoke Visits Shop', 'Accra', 'Smoke', ${SHOP.latitude}, ${SHOP.longitude}, 'manual'),
                    ('smoke-visits-shop-daa', '${DAA}', 'Smoke Visits DAA', 'Accra', 'Smoke', null, null, null)`)
  const hr = await makeHr('bfl', [BFL])
  const now = Date.now()
  const faceApi = (await call('GET', '/hr/me', undefined, hr.token)).json?.faceProvider === 'faceapi'

  const rep = await addRep(hr.token)
  const repToken = await checkIn(rep, { clockInMs: now - 30 * MIN, closesAtMs: now + 6 * 60 * MIN })
  const merch = await addRep(hr.token, 'Merchandiser')
  const merchToken = await checkIn(merch, { clockInMs: now - 30 * MIN, closesAtMs: now + 6 * 60 * MIN })

  /* Checks that need no face match */
  const today = await call('GET', '/tracking/visits', undefined, repToken)
  check('the phone gets its shop list', today.status === 200 && today.json?.shops?.length === 1 && today.json.shops[0].shopId === SHOP_ID && today.json.attemptsLeft === 5, today)
  const merchVisit = await visit(merchToken, { shopId: SHOP_ID })
  check('a Merchandiser cannot record visits', merchVisit.status === 409 && /Only Sales Representatives and Supervisors/.test(merchVisit.json?.error ?? ''), merchVisit)
  const foreign = await visit(repToken, { shopId: 'smoke-visits-shop-daa', faceImage: picture(1), faceDescriptor: descriptor(1) })
  check('another company’s shop is refused like an unknown one', foreign.status === 400 && foreign.json?.error === 'That outlet is not in the shop directory.', foreign)
  const noOutlet = await visit(repToken, { faceImage: picture(1), faceDescriptor: descriptor(1) })
  check('a visit must name the outlet', noOutlet.status === 400 && noOutlet.json?.error === 'Choose the outlet you are visiting.', noOutlet)
  check('an unknown token is refused', (await call('GET', '/tracking/visits', undefined, 'not-a-token')).json?.code === 'invalid_token')

  /* Checks that need a face match */
  if (faceApi) {
    await sql(`insert into public.face_templates (employee_id, algorithm, template) values ('${rep}', 'faceapi-128-v1', '${JSON.stringify(descriptor(1).map((v) => Math.round(v * 1e6) / 1e6))}')`)
    const ok = await visit(repToken, { shopId: SHOP_ID, location: { latitude: SHOP.latitude, longitude: SHOP.longitude + 40 / METRES_PER_DEG_LNG, accuracy: 9 }, faceImage: picture(1), faceDescriptor: descriptor(1) })
    check('a matching face records the visit', ok.status === 201 && ok.json?.visit?.onList === true, ok)
    const stored = await sql(`select distance_m, to_jsonb(v) ? 'latitude' as has_lat from public.outlet_visits v where staff_id = '${rep}'`)
    check('the visit keeps the distance, not the coordinates', stored.length === 1 && Math.abs(stored[0].distance_m - 40) <= 2 && stored[0].has_lat === false, stored)
    let last
    for (let i = 0; i < 5; i += 1) last = await visit(repToken, { shopId: SHOP_ID, location: null, faceImage: picture(2), faceDescriptor: descriptor(99) })
    check('the fifth failed scan locks visits', last.status === 403 && last.json?.lockedOut === true, last)
    const locked = await visit(repToken, { shopId: SHOP_ID, location: null, faceImage: picture(1), faceDescriptor: descriptor(1) })
    check('a locked person cannot record visits today', locked.status === 423, locked)
    const kiosk = await sql(`select coalesce(sum(failed), 0)::int n from public.face_attempts where employee_id = '${rep}'`)
    check('failed visit scans never touch the kiosk counter', kiosk[0].n === 0, kiosk)
  } else {
    ['a matching face records the visit', 'the visit keeps the distance, not the coordinates', 'the fifth failed scan locks visits', 'a locked person cannot record visits today', 'failed visit scans never touch the kiosk counter'].forEach(skip)
  }

  /* After clock-out */
  await checkOut(rep, Date.now())
  const closed = await visit(repToken, { shopId: SHOP_ID, faceImage: picture(1), faceDescriptor: descriptor(1) })
  check('after clock-out no visit can be recorded', closed.status === 409 && closed.json?.code === 'session_closed', closed)
} finally {
  await cleanUp()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
