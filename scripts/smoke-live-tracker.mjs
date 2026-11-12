/**
 * Live test of the Live Tracker against the hosted project.
 *
 * A real check-in needs a face match, which the live face provider may block,
 * so this script makes check-ins and tracking sessions with SQL exactly as the
 * server does (a check-in event, plus a session holding the token's hash). It
 * creates temporary shops, HR accounts with real MFA and employees, exercises
 * the routes, then deletes everything it made. Audit rows stay.
 * SQL runs through the Management API when SUPABASE_ACCESS_TOKEN is set,
 * otherwise through the logged-in Supabase CLI.
 *
 * Usage: node scripts/smoke-live-tracker.mjs
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
const SHOP_ID = 'smoke-tracker-shop-1'
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
  const email = `smoke-track-${label}@${DOMAIN}`
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
      insert into public.hr_users (id, name, email, company_ids) select u.id, 'Smoke Test Tracker ${label}', '${email}', array[${companyIds.map((id) => `'${id}'`).join(',')}] from u
    )
    select id from u`)
  return await signInWithMfa(email, password)
}

const TEST_STAFF = `select staff_id from public.employees where full_name like 'Smoke Tracker%'`

async function cleanUp() {
  await sql(`
    delete from public.tracking_flags where staff_id in (${TEST_STAFF});
    delete from public.tracking_latest where staff_id in (${TEST_STAFF});
    delete from public.tracking_day_summaries where staff_id in (${TEST_STAFF});
    delete from public.location_points where staff_id in (${TEST_STAFF});
    delete from public.tracking_sessions where staff_id in (${TEST_STAFF});
    delete from public.attendance_events where employee_id in (${TEST_STAFF});
    delete from public.employee_shop_changes where staff_id in (${TEST_STAFF});
    delete from public.employee_shops where staff_id in (${TEST_STAFF});
    delete from public.shop_assignments where employee_id in (${TEST_STAFF});
    delete from public.employees where full_name like 'Smoke Tracker%';
    delete from public.shops where shop_id like 'smoke-tracker-%';
    delete from public.hr_users where name like 'Smoke Test Tracker%';
    delete from auth.users where email like 'smoke-track-%@${DOMAIN}';`)
}

const accraDate = (ms) => new Date(ms).toISOString().slice(0, 10) // Accra is UTC
const hash = (token) => createHash('sha256').update(token, 'utf8').digest('hex')

let people = 0
/** A Sales Rep added through HR, with the test shop as their only shop. */
async function addRep(hrToken) {
  people += 1
  const created = await call('POST', '/hr/employees', {
    companyId: BFL, firstName: 'Smoke', lastName: `Tracker ${people}`, phone: '0241234567', email: '', address: 'Accra',
    emergencyContactName: '', emergencyContactPhone: '', paymentMethod: 'mobile-money',
    position: 'Sales Representative', assignedShopIds: [SHOP_ID],
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

try {
  await cleanUp()
  await sql(`insert into public.shops (shop_id, company_id, shop_name, town, area, latitude, longitude, location_source)
             values ('${SHOP_ID}', '${BFL}', 'Smoke Tracker Shop', 'Accra', 'Smoke', ${SHOP.latitude}, ${SHOP.longitude}, 'manual')`)
  const hr = await makeHr('bfl', [BFL])
  const now = Date.now()

  /* Points while the session is open */
  const rep = await addRep(hr.token)
  const token = await checkIn(rep, { clockInMs: now - 30 * MIN, closesAtMs: now + 6 * 60 * MIN })
  const sent = await call('POST', '/tracking/points', { points: [point(now - 10 * MIN, 0), point(now - 5 * MIN, 50), point(now - MIN, 100)] }, token)
  check('points are accepted while clocked in', sent.status === 200 && sent.json?.accepted === 3 && sent.json?.rejected === 0 && sent.json?.sessionOpen === true, sent)
  const early = await call('POST', '/tracking/points', { points: [point(now - 40 * MIN, 300)] }, token)
  check('a point from before clock-in is rejected', early.status === 200 && early.json?.rejected === 1, early)
  check('an unknown token is refused', (await call('POST', '/tracking/points', { points: [point(now)] }, 'not-a-token')).json?.code === 'invalid_token')
  const latest = await sql(`select recorded_at from public.tracking_latest where staff_id = '${rep}'`)
  check('the latest position is the newest point', latest.length === 1 && Date.parse(latest[0].recorded_at) === now - MIN, latest)
  await call('POST', '/tracking/points', { points: [point(now - 30 * 1000, 400, { isMock: true })] }, token)
  const flags = await sql(`select kind, points from public.tracking_flags where staff_id = '${rep}'`)
  check('a fake location is flagged for HR', flags.some((f) => f.kind === 'mock' && f.points === 1), flags)

  /* Clock-out ends the session */
  await checkOut(rep, Date.now())
  const session = await sql(`select status, closed_reason, clock_out_at from public.tracking_sessions where staff_id = '${rep}'`)
  check('clock-out closes the session', session[0]?.status === 'closed' && session[0]?.closed_reason === 'clock-out' && Boolean(session[0]?.clock_out_at), session)
  const after = await call('POST', '/tracking/points', { points: [point(Date.now(), 500)] }, token)
  check('after clock-out the phone is told the session closed', after.status === 409 && after.json?.code === 'session_closed', after)

  /* The clock-out boundary, even for a batch that raced the clock-out */
  const rep2 = await addRep(hr.token)
  const outAt = Date.now() - 2 * MIN
  await checkIn(rep2, { clockInMs: now - 60 * MIN, closesAtMs: now + 6 * 60 * MIN })
  await checkOut(rep2, outAt)
  const sessionId = (await sql(`select id from public.tracking_sessions where staff_id = '${rep2}'`))[0].id
  const raced = await sql(`select public.record_points('${sessionId}', '${JSON.stringify([
    { latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 10, recorded_at: new Date(outAt - 1000).toISOString(), is_mock: false, flagged: null },
    { latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 10, recorded_at: new Date(outAt + 1000).toISOString(), is_mock: false, flagged: null },
  ])}'::jsonb, '[]'::jsonb, null) as stored`)
  check('1 s before clock-out is stored and 1 s after is not', raced[0]?.stored === 1, raced)

  /* A session with no clock-out closes at the end of the clock-out window */
  const rep3 = await addRep(hr.token)
  const expired = await checkIn(rep3, { clockInMs: now - 60 * MIN, closesAtMs: now - MIN })
  const late = await call('POST', '/tracking/points', { points: [point(now - 2 * MIN)] }, expired)
  const ended = await sql(`select status, closed_reason from public.tracking_sessions where staff_id = '${rep3}'`)
  check('an expired session is refused and closed as day-end', late.status === 409 && ended[0]?.closed_reason === 'day-end', { late, ended })

  /* Yesterday: the report summarises the day, then the trail is deleted */
  const rep4 = await addRep(hr.token)
  await sql(`update public.employees set joined_on = '2026-01-01', registered_at = '2026-01-01T08:00:00Z' where staff_id = '${rep4}'`)
  const yesterday = accraDate(now - 24 * 60 * MIN)
  const y9 = Date.parse(`${yesterday}T09:00:00Z`)
  await checkIn(rep4, { clockInMs: y9, closesAtMs: y9 + 14 * 60 * MIN })
  const ySession = (await sql(`select id from public.tracking_sessions where staff_id = '${rep4}'`))[0].id
  const yPoints = Array.from({ length: 31 }, (_, m) => `('${ySession}', '${rep4}', '${BFL}', '${yesterday}', ${SHOP.latitude}, ${SHOP.longitude + 20 / METRES_PER_DEG_LNG}, 10, '${new Date(y9 + m * MIN).toISOString()}')`)
  await sql(`insert into public.location_points (session_id, staff_id, company_id, date, latitude, longitude, accuracy, recorded_at) values ${yPoints.join(', ')}`)
  await checkOut(rep4, y9 + 60 * MIN, yesterday)

  const report = await call('GET', `/hr/tracking/reports/daily?companyId=${BFL}&date=${yesterday}`, undefined, hr.token)
  const row = report.json?.rows?.find((r) => r.employeeId === rep4)
  check('yesterday’s report has the employee’s summary', report.status === 200 && row?.trackedMinutes === 60 && Math.abs((row?.coverage ?? 0) - 0.583) < 0.01 && row?.signalLost === 1 && row?.result === 'poor', { status: report.status, row })
  check('a 30-minute stay proves the listed shop', row?.shops?.proven === 1 && row?.shops?.listed === 1, row?.shops)
  check('the report carries no coordinates', !/latitude|longitude/.test(JSON.stringify(report.json)))
  const leftover = await sql(`select count(*)::int n from public.location_points where session_id = '${ySession}'`)
  check('yesterday’s trail is deleted', leftover[0].n === 0, leftover)
  const summary = await sql(`select shop_stays, shop_stays::text as raw from public.tracking_day_summaries where staff_id = '${rep4}' and date = '${yesterday}'`)
  check('the summary keeps the stay minutes', summary.length === 1 && summary[0].shop_stays?.[SHOP_ID]?.longestMinutes === 30, summary)
  check('the summary keeps no coordinates', summary.length === 1 && !/latitude|longitude/.test(summary[0].raw), summary)

  const today = await call('GET', `/hr/tracking/reports/daily?companyId=${BFL}&date=${accraDate(now)}`, undefined, hr.token)
  const todayRow = today.json?.rows?.find((r) => r.employeeId === rep)
  check('today’s report is worked out live', today.status === 200 && todayRow?.result !== 'not-clocked-in' && todayRow?.points >= 3, todayRow)
  const future = await call('GET', `/hr/tracking/reports/daily?companyId=${BFL}&date=2099-01-01`, undefined, hr.token)
  check('a future date is refused', future.status === 400, future)
  const daa = await makeHr('daa', [DAA])
  check('another company’s HR cannot read the report', (await call('GET', `/hr/tracking/reports/daily?companyId=${BFL}&date=${yesterday}`, undefined, daa.token)).status === 403)

  /* The live map: Realtime pushes each new position to HR */
  const rep5 = await addRep(hr.token)
  const liveToken = await checkIn(rep5, { clockInMs: Date.now() - 10 * MIN, closesAtMs: Date.now() + 6 * 60 * MIN })
  hr.auth.realtime.setAuth(hr.token)
  const statuses = []
  let posted = null
  const pushed = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 15000)
    hr.auth.channel('smoke-live-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracking_latest', filter: `staff_id=eq.${rep5}` }, (change) => {
        clearTimeout(timer)
        resolve(change)
      })
      // SUBSCRIBED arrives before the database-change listener is ready; Realtime
      // sends a system message once it is, and only then is a change delivered.
      .on('system', {}, async (message) => {
        statuses.push(`system: ${message?.extension ?? ''} ${message?.status ?? ''}`.trim())
        if (message?.extension === 'postgres_changes' && message?.status === 'ok' && !posted) {
          posted = await call('POST', '/tracking/points', { points: [point(Date.now() - 1000, 60)] }, liveToken)
        }
      })
      .subscribe((status, error) => {
        statuses.push(error ? `${status}: ${error.message}` : status)
      })
  })
  const change = await pushed
  check('HR’s live map receives the new position through Realtime', change?.new?.staff_id === rep5 && change?.new?.session_status === 'open', { change, statuses, posted })
  await hr.auth.removeAllChannels()

  /* Company separation, straight from the database */
  const tables = ['tracking_sessions', 'location_points', 'tracking_latest', 'tracking_day_summaries', 'tracking_flags']
  for (const table of tables) {
    const response = await fetch(`${URL_BASE}/rest/v1/${table}?select=staff_id&company_id=eq.${BFL}`, { headers: { apikey: KEY, authorization: `Bearer ${daa.token}` } })
    const rows = await response.json().catch(() => null)
    check(`Double A HR reads no Box For Less ${table}`, response.ok && Array.isArray(rows) && rows.length === 0, rows)
  }
  const own = await fetch(`${URL_BASE}/rest/v1/tracking_latest?select=staff_id&staff_id=eq.${rep5}`, { headers: { apikey: KEY, authorization: `Bearer ${hr.token}` } })
  check('Box For Less HR reads its own live positions', ((await own.json()) ?? []).length === 1)
  const hashRead = await fetch(`${URL_BASE}/rest/v1/tracking_sessions?select=token_hash`, { headers: { apikey: KEY, authorization: `Bearer ${hr.token}` } })
  check('nobody in HR can read a token hash', !hashRead.ok, hashRead.status)

  /* Final review, Important 3: a retried batch stores nothing twice */
  const retryBatch = { points: [point(Date.now() - 20 * 1000, 900, { isMock: true })] }
  const pointsOf = async (staffId) => (await sql(`select count(*)::int n from public.location_points where staff_id = '${staffId}'`))[0].n
  await call('POST', '/tracking/points', retryBatch, liveToken)
  const once = await pointsOf(rep5)
  await call('POST', '/tracking/points', retryBatch, liveToken)
  check('a retried batch is not stored twice', (await pointsOf(rep5)) === once, { once, twice: await pointsOf(rep5) })
  const mockFlags = await sql(`select points from public.tracking_flags where staff_id = '${rep5}' and kind = 'mock'`)
  check('a retried fake location is counted once', mockFlags[0]?.points === 1, mockFlags)

  /* Final review, Critical 1: end-of-day runs at the same moment never overwrite a summary */
  const rep6 = await addRep(hr.token)
  await sql(`update public.employees set joined_on = '2026-01-01', registered_at = '2026-01-01T08:00:00Z' where staff_id = '${rep6}'`)
  await checkIn(rep6, { clockInMs: y9, closesAtMs: y9 + 14 * 60 * MIN })
  const s6 = (await sql(`select id from public.tracking_sessions where staff_id = '${rep6}'`))[0].id
  await sql(`insert into public.location_points (session_id, staff_id, company_id, date, latitude, longitude, accuracy, recorded_at) values ${Array.from({ length: 31 }, (_, m) => `('${s6}', '${rep6}', '${BFL}', '${yesterday}', ${SHOP.latitude}, ${SHOP.longitude}, 10, '${new Date(y9 + m * MIN).toISOString()}')`).join(', ')}`)
  await checkOut(rep6, y9 + 60 * MIN, yesterday)
  await Promise.all([1, 2, 3, 4].map(() => call('GET', `/hr/tracking/reports/daily?companyId=${BFL}&date=${yesterday}`, undefined, hr.token)))
  const raced6 = await sql(`select points from public.tracking_day_summaries where staff_id = '${rep6}' and date = '${yesterday}'`)
  check('four reports at once keep the full summary', raced6[0]?.points === 31, raced6)
  const second = await sql(`select public.save_session_summary('${s6}', '{"points":0}'::jsonb, 0) as saved`)
  check('a second summary for the same session is refused', second[0]?.saved === false, second)

  /* Final review, Important 2: a trail the sweep removed is "unavailable", never "no signal" */
  const rep7 = await addRep(hr.token)
  await sql(`update public.employees set joined_on = '2026-01-01', registered_at = '2026-01-01T08:00:00Z' where staff_id = '${rep7}'`)
  await checkIn(rep7, { clockInMs: y9, closesAtMs: y9 + 14 * 60 * MIN })
  const s7 = (await sql(`select id from public.tracking_sessions where staff_id = '${rep7}'`))[0].id
  await sql(`insert into public.location_points (session_id, staff_id, company_id, date, latitude, longitude, accuracy, recorded_at, received_at) values ('${s7}', '${rep7}', '${BFL}', '${yesterday}', ${SHOP.latitude}, ${SHOP.longitude}, 10, '${new Date(y9 + MIN).toISOString()}', now() - interval '3 days')`)
  await checkOut(rep7, y9 + 60 * MIN, yesterday)
  await sql('select app_private.sweep_tracking()')
  const swept = await sql(`select trail_expired from public.tracking_sessions where id = '${s7}'`)
  check('the sweep marks the trail it removed', swept[0]?.trail_expired === true, swept)
  const afterSweep = await call('GET', `/hr/tracking/reports/daily?companyId=${BFL}&date=${yesterday}`, undefined, hr.token)
  const row7 = afterSweep.json?.rows?.find((r) => r.employeeId === rep7)
  check('a swept day reads "unavailable", not "no signal"', row7?.result === 'unavailable' && row7?.shops?.missed === 0, row7)
} finally {
  await cleanUp()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
