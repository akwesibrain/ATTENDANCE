/**
 * Live test of shop locations captured at the shop, against the hosted project.
 *
 * Sessions are made with SQL, as the server makes them at check-in.
 * Everything the script creates is deleted at the end. Audit rows stay.
 *
 * Usage: node scripts/smoke-shop-location.mjs
 */

import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

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
const SHOP_ID = 'smoke-shoploc-shop-1'
const OFF_LIST_ID = 'smoke-shoploc-shop-2'
const SHOP = { latitude: 5.6037, longitude: -0.187 }
const METRES_PER_DEG_LNG = 111320 * Math.cos((SHOP.latitude * Math.PI) / 180)
const MIN = 60000

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
  const email = `smoke-shoploc-${label}@${DOMAIN}`
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
      insert into public.hr_users (id, name, email, company_ids) select u.id, 'Smoke Test ShopLoc ${label}', '${email}', array[${companyIds.map((id) => `'${id}'`).join(',')}] from u
    )
    select id from u`)
  return await signInWithMfa(email, password)
}

const TEST_STAFF = `select staff_id from public.employees where full_name like 'Smoke ShopLoc%'`

async function cleanUp() {
  await sql(`
    delete from public.shop_location_proposals where shop_id like 'smoke-shoploc-%';
    delete from public.tracking_latest where staff_id in (${TEST_STAFF});
    delete from public.location_points where staff_id in (${TEST_STAFF});
    delete from public.tracking_sessions where staff_id in (${TEST_STAFF});
    delete from public.attendance_events where employee_id in (${TEST_STAFF});
    delete from public.employee_shop_changes where staff_id in (${TEST_STAFF});
    delete from public.employee_shops where staff_id in (${TEST_STAFF});
    delete from public.shop_assignments where employee_id in (${TEST_STAFF});
    delete from public.employees where full_name like 'Smoke ShopLoc%';
    delete from public.shops where shop_id like 'smoke-shoploc-%';
    delete from public.hr_users where name like 'Smoke Test ShopLoc%';
    delete from auth.users where email like 'smoke-shoploc-%@${DOMAIN}';`)
}

const accraDate = (ms) => new Date(ms).toISOString().slice(0, 10) // Accra is UTC
const hash = (token) => createHash('sha256').update(token, 'utf8').digest('hex')

let people = 0
/** A field employee added through HR, with the test shop as their only shop. */
async function addPerson(hrToken, position) {
  people += 1
  const created = await call('POST', '/hr/employees', {
    companyId: BFL, firstName: 'Smoke', lastName: `ShopLoc ${people}`, phone: '0241234567', email: '', address: 'Accra',
    emergencyContactName: '', emergencyContactPhone: '', paymentMethod: 'mobile-money',
    position, assignedShopIds: [SHOP_ID],
  }, hrToken)
  if (created.status !== 201) throw new Error(`could not add a test employee: ${JSON.stringify(created)}`)
  return created.json.staffId
}

/** A check-in event and an open session, as the server makes them. Returns the token. */
async function checkIn(staffId) {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const clockIn = new Date(now - 30 * MIN).toISOString()
  await sql(`
    insert into public.attendance_events (employee_id, company_id, company_name, full_name, type, status, date, occurred_at, source)
    select staff_id, company_id, company_name, full_name, 'check-in', 'on-time', '${accraDate(now)}', '${clockIn}', 'smoke'
      from public.employees where staff_id = '${staffId}';
    insert into public.tracking_sessions (staff_id, company_id, date, clock_in_at, closes_at, token_hash)
    select staff_id, company_id, '${accraDate(now)}', '${clockIn}', '${new Date(now + 6 * 60 * MIN).toISOString()}', '${hash(token)}'
      from public.employees where staff_id = '${staffId}';`)
  return token
}

async function checkOut(staffId) {
  await sql(`
    insert into public.attendance_events (employee_id, company_id, company_name, full_name, type, status, date, occurred_at, source)
    select staff_id, company_id, company_name, full_name, 'check-out', 'on-time', '${accraDate(Date.now())}', now(), 'smoke'
      from public.employees where staff_id = '${staffId}';`)
}

/** A reading `metresEast` of the test shop's real position. */
const reading = (metresEast, accuracy = 8) => ({ latitude: SHOP.latitude, longitude: SHOP.longitude + metresEast / METRES_PER_DEG_LNG, accuracy })
const propose = (token, body) => call('POST', '/tracking/shop-locations', body, token)
const proposals = () => sql(`select id, staff_id, status, latitude, longitude, accuracy_m, distance_from_current_m, decided_by from public.shop_location_proposals where shop_id = '${SHOP_ID}' order by proposed_at`)
const setLocation = (token, body) => call('PATCH', `/hr/shops/${SHOP_ID}/location`, body, token)

try {
  await cleanUp()
  await sql(`insert into public.shops (shop_id, company_id, shop_name, town, area, latitude, longitude, location_source)
             values ('${SHOP_ID}', '${BFL}', 'Smoke ShopLoc Shop', 'Accra', 'Smoke', null, null, null),
                    ('${OFF_LIST_ID}', '${BFL}', 'Smoke ShopLoc Other', 'Accra', 'Smoke', null, null, null)`)
  const hr = await makeHr('bfl', [BFL])
  const other = await makeHr('daa', [DAA])

  const rep = await addPerson(hr.token, 'Sales Representative')
  const repToken = await checkIn(rep)
  const merch = await addPerson(hr.token, 'Merchandiser')
  const merchToken = await checkIn(merch)

  /* The phone */
  const list = await call('GET', '/tracking/shop-locations', undefined, repToken)
  check('the phone gets its shops, with no location yet', list.status === 200 && list.json?.shops?.length === 1 && list.json.shops[0].hasLocation === false && list.json.shops[0].pending === false, list)
  check('an unknown token is refused', (await call('GET', '/tracking/shop-locations', undefined, 'not-a-token')).json?.code === 'invalid_token')
  const offList = await propose(repToken, { shopId: OFF_LIST_ID, location: reading(0) })
  check('a shop off the list is refused', offList.status === 400 && offList.json?.error === 'That shop is not on your list.', offList)
  const vague = await propose(repToken, { shopId: SHOP_ID, location: reading(0, 31) })
  check('a reading worse than 30 m is refused', vague.status === 400 && /not accurate enough/.test(vague.json?.error ?? ''), vague)
  const none = await propose(repToken, { shopId: SHOP_ID, location: null })
  check('a reading is required', none.status === 400 && /Location is not available/.test(none.json?.error ?? ''), none)

  const first = await propose(repToken, { shopId: SHOP_ID, location: reading(50, 20) })
  check('a good reading is saved as a suggestion', first.status === 201, first)
  const second = await propose(repToken, { shopId: SHOP_ID, location: reading(0, 8) })
  let rows = await proposals()
  check('a second reading replaces the first from the same person', second.status === 201 && rows.length === 1 && rows[0].accuracy_m === 8 && rows[0].status === 'pending', rows)
  const merchReading = await propose(merchToken, { shopId: SHOP_ID, location: reading(25, 15) })
  check('a Merchandiser can suggest a location too', merchReading.status === 201, merchReading)
  const shopBefore = await sql(`select latitude from public.shops where shop_id = '${SHOP_ID}'`)
  check('a suggestion does not change the shop', shopBefore[0].latitude === null, shopBefore)
  const waiting = await call('GET', '/tracking/shop-locations', undefined, repToken)
  check('the phone shows the suggestion as waiting', waiting.json?.shops?.[0]?.pending === true, waiting)

  /* HR */
  const mine = await hr.auth.from('shop_location_proposals').select('id').eq('shop_id', SHOP_ID)
  check('HR reads the suggestions for their company', mine.data?.length === 2, mine)
  const theirs = await other.auth.from('shop_location_proposals').select('id').eq('shop_id', SHOP_ID)
  check('HR of another company reads none', theirs.data?.length === 0, theirs)
  rows = await proposals()
  const repRow = rows.find((r) => r.staff_id === rep)
  const merchRow = rows.find((r) => r.staff_id === merch)
  const foreignAccept = await setLocation(other.token, { proposalId: repRow.id })
  check('HR of another company cannot accept', foreignAccept.status === 403 || foreignAccept.status === 404, foreignAccept)
  const forged = await setLocation(hr.token, { latitude: 1, longitude: 1, locationSource: 'captured' })
  check('the "captured" source cannot be set without a suggestion', forged.status === 400, forged)
  const accepted = await setLocation(hr.token, { proposalId: repRow.id, latitude: 1, longitude: 1 })
  const shop = (await sql(`select latitude, longitude, location_source, location_label from public.shops where shop_id = '${SHOP_ID}'`))[0]
  check('accepting sets the shop from the reading, not the request', accepted.status === 200 && shop.location_source === 'captured'
    && Math.abs(shop.latitude - SHOP.latitude) < 1e-9 && Math.abs(shop.longitude - SHOP.longitude) < 1e-9
    && (shop.location_label ?? '').startsWith('Captured at the shop by Smoke ShopLoc 1'), shop)
  rows = await proposals()
  check('the accepted reading is marked, and the other one dismissed',
    rows.find((r) => r.id === repRow.id)?.status === 'accepted' && rows.find((r) => r.id === merchRow.id)?.status === 'dismissed' && rows.every((r) => r.decided_by), rows)
  const again = await setLocation(hr.token, { proposalId: repRow.id })
  check('a decided suggestion cannot be accepted again', again.status === 400, again)

  const third = await propose(merchToken, { shopId: SHOP_ID, location: reading(60, 10) })
  rows = await proposals()
  const fresh = rows.find((r) => r.staff_id === merch)
  check('a new reading says how far it is from the current pin', third.status === 201 && fresh.status === 'pending' && Math.abs(fresh.distance_from_current_m - 60) <= 2 && fresh.decided_by === null, fresh)
  const dismissed = await call('POST', `/hr/shop-location-proposals/${fresh.id}/dismiss`, {}, hr.token)
  const after = (await sql(`select latitude, longitude from public.shops where shop_id = '${SHOP_ID}'`))[0]
  rows = await proposals()
  check('dismissing leaves the shop where it was', dismissed.status === 200 && rows.find((r) => r.id === fresh.id)?.status === 'dismissed' && Math.abs(after.longitude - SHOP.longitude) < 1e-9, { dismissed, after })

  /* After clock-out */
  await checkOut(rep)
  const closed = await propose(repToken, { shopId: SHOP_ID, location: reading(0) })
  check('after clock-out no location can be suggested', closed.status === 409 && closed.json?.code === 'session_closed', closed)
} finally {
  await cleanUp()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
