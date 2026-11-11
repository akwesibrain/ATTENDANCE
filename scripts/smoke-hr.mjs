/**
 * Live test of the HR routes against the hosted project.
 *
 * It creates two temporary HR accounts (one with both companies, one with a
 * single company), signs in with real MFA, exercises the routes, then deletes
 * every row it created. Photos of generated patterns stay in private storage.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/smoke-hr.mjs
 */

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
if (!ACCESS) throw new Error('Set SUPABASE_ACCESS_TOKEN for this run.')

let failures = 0
function check(name, passed, detail) {
  console.log(`${passed ? 'pass' : 'FAIL'}  ${name}${passed || detail === undefined ? '' : `  ->  ${JSON.stringify(detail).slice(0, 400)}`}`)
  if (!passed) failures += 1
}

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ACCESS}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`SQL failed: ${JSON.stringify(body)}`)
  return body
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

/** A repeatable stand-in for the face descriptor the phone sends; each seed is a different person. */
function descriptor(seed) {
  let state = seed
  return Array.from({ length: 128 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state / 2 ** 32 - 0.5) * 0.4
  })
}

const face = picture(7)
const faceReading = descriptor(7)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const client = () => createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function makeHr(label, companies) {
  const email = `smoke-${label}@workforce-test.example.com`
  const password = randomBytes(18).toString('base64url')
  const rows = await sql(`
    with u as (
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
      returning id
    ), i as (
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', '${email}', 'email_verified', true), 'email', now(), now(), now() from u
    ), h as (
      insert into public.hr_users (id, name, email, company_ids) select u.id, 'Smoke Test HR ${label}', '${email}', array[${companies.map((c) => `'${c}'`).join(',')}] from u
    )
    select id from u`)
  const auth = client()
  const { error } = await auth.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed: ${error.message}`)
  const password1 = (await auth.auth.getSession()).data.session.access_token
  const enrolled = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: `smoke-${label}` })
  if (enrolled.error) throw new Error(`enroll failed: ${enrolled.error.message}`)
  const verified = await auth.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) })
  if (verified.error) throw new Error(`mfa failed: ${verified.error.message}`)
  const token = (await auth.auth.getSession()).data.session.access_token
  return { id: rows[0].id, auth, passwordOnly: password1, token }
}

async function cleanUp() {
  await sql(`begin;
    alter table public.audit_events disable trigger user;
    alter table public.attendance_correction_history disable trigger user;
    alter table public.notification_history disable trigger user;
    delete from public.audit_events where actor_name like 'Smoke Test%' or affected like '%Smoke Test%';
    delete from public.attendance_correction_history where changed_by like 'Smoke Test%';
    delete from public.notification_history where notification_id in (select id from public.notifications where employee_name like 'Smoke Test%');
    alter table public.audit_events enable trigger user;
    alter table public.attendance_correction_history enable trigger user;
    alter table public.notification_history enable trigger user;
    delete from public.notifications where employee_name like 'Smoke Test%';
    delete from public.monitoring_alert_reviews where reviewed_by like 'Smoke Test%';
    delete from public.verification_tokens where event_id like 'smoke-%';
    delete from public.verification_events where event_id like 'smoke-%';
    delete from public.attendance_corrections where employee_id in (select staff_id from public.employees where full_name like 'Smoke Test%');
    delete from public.attendance_events where full_name like 'Smoke Test%';
    delete from public.face_attempts where employee_id in (select staff_id from public.employees where full_name like 'Smoke Test%');
    delete from public.face_templates where employee_id in (select staff_id from public.employees where full_name like 'Smoke Test%');
    delete from public.shop_assignments where employee_id in (select staff_id from public.employees where full_name like 'Smoke Test%');
    delete from public.employees where full_name like 'Smoke Test%';
    delete from public.shops where created_by like 'Smoke Test%';
    delete from public.holidays where created_by like 'Smoke Test%';
    delete from public.settings_versions where changed_by like 'Smoke Test%';
    update public.settings_general set updated_by = 'System default' where updated_by like 'Smoke Test%';
    delete from public.hr_users where name like 'Smoke Test%';
    delete from auth.users where email like 'smoke-%@workforce-test.example.com';
    delete from public.rate_limits;
    update public.company_counters c set last_number = 0 where not exists (select 1 from public.employees e where e.company_id = c.company_id);
    commit;`)
}

const today = new Date().toISOString().slice(0, 10)
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const person = (suffix, extra) => ({
  companyId: 'double-a',
  firstName: 'Smoke',
  lastName: `Test ${suffix}`,
  phone: '+233 24 000 0000',
  paymentMethod: 'bank',
  position: 'Warehouse Worker',
  biometricConsent: true,
  faceImage: face,
  faceDescriptor: faceReading,
  ...extra,
})

try {
  await cleanUp()
  const all = await makeHr('all', ['box-for-less', 'double-a'])
  const one = await makeHr('one', ['double-a'])
  const T = all.token

  /* Access */
  check('no session is refused', (await call('GET', '/hr/me')).status === 401)
  const passwordOnly = await call('GET', '/hr/me', undefined, all.passwordOnly)
  check('password without MFA is refused', passwordOnly.status === 403 && passwordOnly.json.code === 'mfa-required', passwordOnly)
  const me = await call('GET', '/hr/me', undefined, T)
  check('a signed-in HR user is recognised', me.status === 200 && me.json.user.companyIds.length === 2, me)
  check('sign-in is recorded', (await call('POST', '/hr/signed-in', {}, T)).status === 200)
  check('job routes refuse a caller without the secret', [403, 503].includes((await call('POST', '/jobs/sync-notifications', {})).status))

  /* Employees for the tests */
  const office = (await call('POST', '/employees/register', person('Office'))).json
  const newShop = { shopName: 'Smoke Shop', town: 'Accra', area: 'Testing' }
  const field = (await call('POST', '/employees/register', person('Field', { companyId: 'box-for-less', position: 'Merchandiser', shopMode: 'new', newShop }))).json
  check('test employees registered', Boolean(office.staffId && field.assignedShopId), { office, field })

  /* Company separation */
  const crossCompany = await call('PATCH', `/hr/employees/${field.staffId}`, { joinedOn: today }, one.token)
  check('another company’s employee cannot be changed', crossCompany.status === 403, crossCompany)
  const { data: visible } = await one.auth.from('employees').select('staff_id')
  check('reads are limited to the HR user’s company', visible.length === 1 && visible[0].staff_id === office.staffId, visible)

  /* Direct access */
  const direct = await all.auth.from('employees').update({ full_name: 'Hacked' }).eq('staff_id', office.staffId).select()
  check('HR cannot write to tables directly', Boolean(direct.error) || direct.data.length === 0, direct)
  const schedule = await all.auth.from('verification_schedule').select('*')
  check('the SMS schedule cannot be read', Boolean(schedule.error) || schedule.data.length === 0, schedule)
  const templates = await all.auth.from('face_templates').select('*')
  check('face templates cannot be read', Boolean(templates.error) || templates.data.length === 0, templates)

  /* Corrections */
  const correction = { employeeId: office.staffId, date: today, clockInTime: '08:05', clockOutTime: '', reason: 'Other', remarks: 'Checked against the register.' }
  const shortRemarks = await call('POST', '/hr/attendance/corrections', { ...correction, remarks: 'short' }, T)
  check('a correction needs remarks', shortRemarks.status === 400 && Boolean(shortRemarks.json.errors.remarks), shortRemarks)
  const future = await call('POST', '/hr/attendance/corrections', { ...correction, date: tomorrow }, T)
  check('a future date is refused', future.status === 400, future)
  const saved = await call('POST', '/hr/attendance/corrections', correction, T)
  check('a correction saves', saved.status === 200, saved)
  const { data: fix } = await all.auth.from('attendance_corrections').select('*').eq('employee_id', office.staffId)
  check('the correction is readable, with Accra time', fix?.[0]?.clock_in?.startsWith(`${today}T08:05:00`), fix)
  const { data: fixHistory } = await all.auth.from('attendance_correction_history').select('*').eq('employee_id', office.staffId)
  check('the correction history is kept', fixHistory?.length === 1 && fixHistory[0].changed_by === 'Smoke Test HR all', fixHistory)
  const same = await call('POST', '/hr/attendance/corrections', correction, T)
  check('a correction that changes nothing is refused', same.status === 400 && Boolean(same.json.errors.form), same)

  /* Manual entries */
  const entry = { date: yesterday, clockInTime: '08:00', clockOutTime: '16:00', remarks: 'From the notebook.' }
  const created = await call('POST', '/hr/attendance/manual-entries', { employeeId: office.staffId, entries: [entry] }, T)
  check('a manual entry saves', created.status === 200 && created.json.created === 1, created)
  const noReview = await call('POST', '/hr/attendance/manual-entries', { employeeId: office.staffId, entries: [entry] }, T)
  check('an existing day needs review to replace', noReview.status === 400, noReview)
  const replaced = await call('POST', '/hr/attendance/manual-entries', { employeeId: office.staffId, replaceReason: 'Notebook page was misread.', entries: [{ ...entry, clockOutTime: '16:30', replace: true }] }, T)
  check('it can be replaced with a reason', replaced.status === 200 && replaced.json.replaced === 1, replaced)

  /* Employees and shops */
  const details = await call('PATCH', `/hr/employees/${office.staffId}`, { joinedOn: today, emergencyContactName: 'Ama Test', emergencyContactPhone: '0240000000' }, T)
  check('employee details save', details.status === 200, details)
  const badDate = await call('PATCH', `/hr/employees/${office.staffId}`, { joinedOn: tomorrow }, T)
  check('a future joining date is refused', badDate.status === 400, badDate)
  const location = await call('PATCH', `/hr/shops/${field.assignedShopId}/location`, { latitude: 5.6, longitude: -0.2, locationSource: 'manual' }, T)
  check('a shop location saves', location.status === 200, location)
  const assign = await call('POST', `/hr/employees/${field.staffId}/shop`, { shopId: 'shop-bfl-china-mall-ashaiman' }, T)
  check('an employee can move shop', assign.status === 200, assign)
  const { data: assignments } = await all.auth.from('shop_assignments').select('active, shop_id').eq('employee_id', field.staffId)
  check('history is kept with one active shop', assignments?.length === 2 && assignments.filter((a) => a.active).length === 1, assignments)
  const foreignShop = await call('POST', `/hr/employees/${office.staffId}/shop`, { shopId: 'shop-bfl-china-mall-ashaiman' }, T)
  check('a shop from another company is refused', foreignShop.status === 400, foreignShop)

  /* Holidays */
  const added = await call('POST', '/hr/holidays', { date: '2026-12-30', name: 'Smoke Day' }, T)
  check('a holiday saves', added.status === 201, added)
  check('the same date twice is refused', (await call('POST', '/hr/holidays', { date: '2026-12-30', name: 'Smoke Day' }, T)).status === 400)
  check('a public holiday is refused', (await call('POST', '/hr/holidays', { date: '2026-12-25', name: 'Smoke Day' }, T)).status === 400)
  check('a one-company HR user cannot set holidays', (await call('POST', '/hr/holidays', { date: '2026-12-29', name: 'Smoke Day' }, one.token)).status === 403)
  check('a holiday can be removed', (await call('DELETE', `/hr/holidays/${added.json.holiday.id}`, undefined, T)).status === 200)

  /* Settings */
  const rate = await call('PUT', '/hr/settings/overtime/double-a', { rate: 75.5, effectiveFrom: '2026-12-01' }, T)
  check('a future overtime rate saves', rate.status === 200, rate)
  check('a backdated rate is refused', (await call('PUT', '/hr/settings/overtime/double-a', { rate: 80, effectiveFrom: yesterday }, T)).status === 400)
  check('another company’s rate is refused', (await call('PUT', '/hr/settings/overtime/box-for-less', { rate: 80, effectiveFrom: '2026-12-01' }, one.token)).status === 403)
  const { data: versions } = await all.auth.from('settings_versions').select('effective_from, values').eq('kind', 'pay').eq('company_id', 'double-a').order('effective_from')
  check('earlier rates are left alone', versions?.length === 2 && versions[0].values.overtimeRate === 60, versions)
  const security = { sessionTimeoutMinutes: 61, loginAttemptLimit: 5, passwordMinLength: 12, passwordRequireMixed: true }
  check('a settings section saves', (await call('PUT', '/hr/settings/security', security, T)).status === 200)
  check('no change is reported as such', (await call('PUT', '/hr/settings/security', security, T)).status === 400)
  check('it can be set back', (await call('PUT', '/hr/settings/security', { ...security, sessionTimeoutMinutes: 60 }, T)).status === 200)
  check('invalid settings are refused', (await call('PUT', '/hr/settings/security', { ...security, passwordMinLength: 3 }, T)).status === 400)

  /* Geocode, exports */
  const geocode = await call('GET', '/hr/geocode?shopName=China%20Mall&town=Accra', undefined, T)
  check('location lookup respects the setting', geocode.json.status === 'not-configured', geocode)
  check('an export is logged', (await call('POST', '/hr/audit/exports', { action: 'Audit log exported', category: 'System Settings', source: 'Audit Logs', affected: 'Smoke Test' }, T)).status === 200)
  check('only exports can be logged that way', (await call('POST', '/hr/audit/exports', { action: 'Employee deleted', category: 'System Settings' }, T)).status === 400)

  /* SMS verification, seeded directly because no provider is configured */
  const mk = (n, res) => `('smoke-${n}', '${field.staffId}', 'box-for-less', 'shop-bfl-china-mall-ashaiman', '${today}', ${n}, now() - interval '1 minute', 'delivered'${res ? `, '${res}'` : ', null'})`
  await sql(`insert into public.verification_events (event_id, employee_id, company_id, shop_id, date, verification_number, dispatched_at, delivery_status, result) values ${mk(1)}, ${mk(2)}, ${mk(3, 'missed')}`)
  const tokens = { good: randomBytes(32).toString('base64url'), far: randomBytes(32).toString('base64url'), old: randomBytes(32).toString('base64url') }
  const hash = (t) => `encode(extensions.digest('${t}', 'sha256'), 'hex')`
  await sql(`insert into public.verification_tokens (token_hash, event_id, expires_at) values
    (${hash(tokens.good)}, 'smoke-1', now() + interval '10 minutes'),
    (${hash(tokens.far)}, 'smoke-2', now() + interval '10 minutes'),
    (${hash(tokens.old)}, 'smoke-3', now() - interval '1 minute')`)
  const info = await call('GET', `/verify/${tokens.good}`)
  check('the SMS link page opens', info.status === 200 && info.json.verificationNumber === 1 && !('expected' in info.json), info)
  check('an expired link is refused', (await call('GET', `/verify/${tokens.old}`)).status === 410)
  check('a made-up link is refused', (await call('GET', '/verify/not-a-real-token-at-all-really')).status === 410)
  const atShop = await call('POST', `/verify/${tokens.good}`, { faceImage: face, faceDescriptor: faceReading, latitude: 5.68486, longitude: -0.02419, accuracy: 12 })
  check('right face at the shop is verified', atShop.json.result === 'verified', atShop)
  check('a link works only once', (await call('POST', `/verify/${tokens.good}`, { faceImage: face, faceDescriptor: faceReading, latitude: 5.68486, longitude: -0.02419 })).status === 410)
  const away = await call('POST', `/verify/${tokens.far}`, { faceImage: face, faceDescriptor: faceReading, latitude: 5.7, longitude: -0.02419 })
  check('right face away from the shop is flagged', away.json.result === 'outside-shop', away)
  const { data: smsRows } = await all.auth.from('verification_events').select('event_id, result, distance_from_shop').like('event_id', 'smoke-%').order('event_id')
  check('results and distance are stored', smsRows?.[1]?.distance_from_shop > 1500, smsRows)

  /* Notifications, raised in the background after the changes above */
  await wait(5000)
  const { data: notes } = await all.auth.from('notifications').select('*').eq('employee_id', office.staffId)
  check('notifications are raised without duplicates', notes?.length >= 2 && new Set(notes.map((n) => n.source_key)).size === notes.length, notes?.map((n) => n.source_key))
  const { data: otherNotes } = await one.auth.from('notifications').select('company_id')
  check('notifications stay within the company', otherNotes?.every((n) => n.company_id === 'double-a'), otherNotes)
  const note = notes[0]
  check('a comment saves', (await call('POST', `/hr/notifications/${note.id}`, { action: 'comment', text: 'Looking into it.' }, T)).status === 200)
  const badResolve = await call('POST', `/hr/notifications/${note.id}`, { action: 'resolve', actionTaken: 'Made up', notes: 'Enough text' }, T)
  check('an unknown resolution is refused', badResolve.status === 400, badResolve)
  check('it can be resolved', (await call('POST', `/hr/notifications/${note.id}`, { action: 'resolve', actionTaken: 'Other', notes: 'Enough text' }, T)).status === 200)
  check('a closed notification cannot be resolved again', (await call('POST', `/hr/notifications/${note.id}`, { action: 'resolve', actionTaken: 'Other', notes: 'Enough text' }, T)).status === 400)
  check('it can be reopened', (await call('POST', `/hr/notifications/${note.id}`, { action: 'reopen', reason: 'New information' }, T)).status === 200)
  const markAll = await call('POST', '/hr/notifications/mark-read', { ids: notes.map((n) => n.id) }, T)
  check('mark all as read works', markAll.status === 200, markAll)
  const { data: history } = await all.auth.from('notification_history').select('action').eq('notification_id', note.id)
  check('notification history is kept', history?.some((h) => h.action === 'Comment') && history.some((h) => h.action === 'Resolved'), history)

  const alertId = `${field.staffId}:${today}:missed-verification:smoke-3`
  const alert = await call('PATCH', `/hr/monitoring/alerts/${encodeURIComponent(alertId)}`, { status: 'resolved', resolutionNote: 'Spoke to the rep.' }, T)
  check('a monitoring alert can be reviewed', alert.status === 200, alert)
  check('another company’s alert is refused', (await call('PATCH', `/hr/monitoring/alerts/${encodeURIComponent(alertId)}`, { status: 'new' }, one.token)).status === 403)

  /* Audit */
  const { data: audit } = await all.auth.from('audit_events').select('action').eq('actor_name', 'Smoke Test HR all')
  const actions = new Set(audit?.map((a) => a.action))
  const expected = ['Signed in', 'Attendance record created', 'Attendance record created (manual entry)', 'Attendance record replaced (manual entry)', 'Employee details updated', 'Shop location set', 'Employee shop assignment changed', 'Holiday added', 'Holiday removed', 'Overtime rate changed', 'Security preferences changed', 'Audit log exported', 'Notification: Resolved', 'Monitoring alert resolved']
  const missing = expected.filter((action) => !actions.has(action))
  check('every change is in the audit log', missing.length === 0, missing)
  const update = await all.auth.from('audit_events').delete().eq('actor_name', 'Smoke Test HR all').select()
  check('HR cannot delete audit entries', Boolean(update.error) || update.data.length === 0, update)
} catch (error) {
  failures += 1
  console.log(`FAIL  the run stopped: ${error.message}`)
} finally {
  await wait(4000)
  await cleanUp()
  const left = await sql(`select (select count(*) from public.employees) employees, (select count(*) from public.notifications) notifications, (select count(*) from public.audit_events) audit, (select count(*) from public.hr_users) hr, (select count(*) from auth.users) users, (select count(*) from public.settings_versions) versions, (select array_agg(last_number) from public.company_counters) counters, (select count(*) from public.shops) shops, (select bool_and(tgenabled = 'O') from pg_trigger where tgrelid in ('public.audit_events'::regclass, 'public.attendance_correction_history'::regclass, 'public.notification_history'::regclass) and not tgisinternal) triggers_on`)
  console.log('after cleanup:', JSON.stringify(left[0]))
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exitCode = failures ? 1 : 0
