/**
 * Live test of employee shop lists (1 to 7 shops) against the hosted project.
 *
 * It creates temporary shops, temporary HR accounts with real MFA and
 * temporary employees (added by HR without a face), exercises the routes, then
 * deletes everything it made. Audit rows stay: that table is append-only.
 * SQL runs through the Management API when SUPABASE_ACCESS_TOKEN is set,
 * otherwise through the logged-in Supabase CLI.
 *
 * Usage: node scripts/smoke-shop-lists.mjs
 */

import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
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
const SHOP_PREFIX = 'smoke-shoplist-'

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

const client = () => createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

/** Signs in and enrols an authenticator, returning a session that passed MFA. */
async function signInWithMfa(email, password) {
  const auth = client()
  const { error } = await auth.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  const enrolled = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'smoke' })
  if (enrolled.error) throw new Error(`enroll failed: ${enrolled.error.message}`)
  const verified = await auth.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) })
  if (verified.error) throw new Error(`mfa failed: ${verified.error.message}`)
  return (await auth.auth.getSession()).data.session.access_token
}

/** A temporary HR user for the given companies; returns its MFA session token. */
async function makeHr(label, companyIds) {
  const email = `smoke-shops-${label}@${DOMAIN}`
  const password = randomBytes(18).toString('base64url')
  const companies = companyIds.map((id) => `'${id}'`).join(',')
  await sql(`
    with u as (
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
      returning id
    ), i as (
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', '${email}', 'email_verified', true), 'email', now(), now(), now() from u
    ), h as (
      insert into public.hr_users (id, name, email, company_ids) select u.id, 'Smoke Test Shops ${label}', '${email}', array[${companies}] from u
    )
    select id from u`)
  return await signInWithMfa(email, password)
}

const TEST_EMPLOYEES = `select staff_id from public.employees where full_name like 'Smoke Shoplist%'`

async function cleanUp() {
  await sql(`
    delete from public.employee_shop_changes where staff_id in (${TEST_EMPLOYEES});
    delete from public.employee_shops where staff_id in (${TEST_EMPLOYEES});
    delete from public.shop_assignments where employee_id in (${TEST_EMPLOYEES});
    delete from public.employees where full_name like 'Smoke Shoplist%';
    delete from public.shops where shop_id like '${SHOP_PREFIX}%' or shop_name like 'Smoke Shoplist%';
    delete from public.hr_users where name like 'Smoke Test Shops%';
    delete from auth.users where email like 'smoke-shops-%@${DOMAIN}';`)
}

/** Temporary active shops: eight for Box For Less, one for Double A. */
async function makeShops() {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => [`${SHOP_PREFIX}bfl-${i + 1}`, BFL, `Smoke Shoplist BFL ${i + 1}`]),
    [`${SHOP_PREFIX}daa-1`, DAA, 'Smoke Shoplist DAA 1'],
  ]
  await sql(`insert into public.shops (shop_id, company_id, shop_name, town, area) values ${rows.map(([id, company, name]) => `('${id}', '${company}', '${name}', 'Accra', 'Smoke')`).join(', ')}`)
  return { bfl: rows.slice(0, 8).map(([id]) => id), daa: rows[8][0] }
}

let people = 0
function employee(fields) {
  people += 1
  return {
    companyId: BFL,
    firstName: 'Smoke',
    lastName: `Shoplist ${people}`,
    phone: '0241234567',
    email: '',
    address: 'Accra',
    emergencyContactName: '',
    emergencyContactPhone: '',
    paymentMethod: 'mobile-money',
    position: 'Sales Representative',
    ...fields,
  }
}
// Full names start "Smoke Shoplist", which clean-up matches.
const assignedShopSql = (staffId) => `select assigned_shop_id from public.employees where staff_id = '${staffId}'`

try {
  await cleanUp()
  const shops = await makeShops()
  const [s1, s2, s3] = shops.bfl
  const both = await makeHr('both', [BFL, DAA])

  /* Registration through HR (no face) */
  const none = await call('POST', '/hr/employees', employee({}), both)
  check('a Sales Rep with no shops is refused', none.status === 400 && Boolean(none.json?.errors?.shop), none)
  const eight = await call('POST', '/hr/employees', employee({ assignedShopIds: shops.bfl }), both)
  check('8 shops are refused', eight.status === 400 && eight.json?.errors?.shop === 'Choose at most 7 shops.', eight)
  const foreign = await call('POST', '/hr/employees', employee({ assignedShopIds: [shops.daa] }), both)
  check('another company’s shop is refused', foreign.status === 400 && foreign.json?.errors?.shop === 'Choose shops from your company’s shop list.', foreign)

  const three = await call('POST', '/hr/employees', employee({
    assignedShopIds: [s1, s2],
    newShops: [{ shopName: `Smoke Shoplist New ${randomBytes(3).toString('hex')}`, town: 'Accra', area: 'Osu' }],
  }), both)
  check('2 picked shops and 1 new shop register', three.status === 201 && three.json?.assignedShopIds?.length === 3, three)
  check('the picked shops come first', three.json?.assignedShopIds?.[0] === s1 && three.json?.assignedShopIds?.[1] === s2, three.json)
  const repId = three.json?.staffId
  if (repId) {
    check('the first shop is the employee’s assigned shop', (await sql(assignedShopSql(repId)))[0]?.assigned_shop_id === s1)
    const snaps = await sql(`select previous, next from public.employee_shop_changes where staff_id = '${repId}'`)
    check('registration writes one snapshot', snaps.length === 1 && snaps[0].next.length === 3, snaps)
  }

  const legacy = await call('POST', '/hr/employees', employee({ shopMode: 'existing', assignedShopId: s3 }), both)
  check('an old-style single-shop request still registers', legacy.status === 201 && legacy.json?.assignedShopIds?.[0] === s3, legacy)
  const supervisor = await call('POST', '/hr/employees', employee({ position: 'Supervisor', assignedShopIds: [s1] }), both)
  check('HR can add a Supervisor with a shop', supervisor.status === 201 && supervisor.json?.assignedShopIds?.length === 1, supervisor)
  const manager = await call('POST', '/hr/employees', employee({ position: 'Supervisor Manager', assignedShopIds: [s1] }), both)
  check('HR still cannot add other elevated titles', manager.status === 400 && Boolean(manager.json?.errors?.position), manager)
} finally {
  await cleanUp()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
