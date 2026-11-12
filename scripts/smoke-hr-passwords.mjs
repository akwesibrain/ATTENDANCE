/**
 * Live test of HR password changes and resets against the hosted project.
 *
 * It creates two temporary HR accounts with real MFA, exercises the routes,
 * then deletes the accounts. SQL runs through the Management API when
 * SUPABASE_ACCESS_TOKEN is set, otherwise through the logged-in Supabase CLI.
 *
 * Usage: node scripts/smoke-hr-passwords.mjs
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

/** Signs in; returns the client and its access token, or the error. */
async function signIn(email, password) {
  const auth = client()
  const { data, error } = await auth.auth.signInWithPassword({ email, password })
  return { auth, error, token: data?.session?.access_token ?? null }
}

/** Signs in and passes MFA, enrolling an authenticator if the account has none. */
async function signInWithMfa(email, password, secret = null) {
  const { auth, error } = await signIn(email, password)
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  let factorId
  if (secret) {
    factorId = (await auth.auth.mfa.listFactors()).data.totp[0].id
  } else {
    const enrolled = await auth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'smoke' })
    if (enrolled.error) throw new Error(`enroll failed: ${enrolled.error.message}`)
    factorId = enrolled.data.id
    secret = enrolled.data.totp.secret
  }
  const verified = await auth.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) })
  if (verified.error) throw new Error(`mfa failed: ${verified.error.message}`)
  return { auth, secret, token: (await auth.auth.getSession()).data.session.access_token }
}

async function makeHr(label) {
  const email = `smoke-pw-${label}@${DOMAIN}`
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
      insert into public.hr_users (id, name, email, company_ids) select u.id, 'Smoke Test PW ${label}', '${email}', array(select id from public.companies) from u
    )
    select id from u`)
  const session = await signInWithMfa(email, password)
  return { id: rows[0].id, email, password, ...session }
}

async function cleanUp() {
  await sql(`delete from public.setup_links where hr_user_id in (select id from public.hr_users where name like 'Smoke Test PW%');
    delete from public.hr_users where name like 'Smoke Test PW%';
    delete from auth.users where email like 'smoke-pw-%@${DOMAIN}';
    delete from public.rate_limits where bucket like 'own-password:%' or bucket like 'password-reset:%';`)
}

/** How many companies a token can read straight from the database, past the API. */
async function directRows(token) {
  const response = await fetch(`${URL_BASE}/rest/v1/companies?select=id`, { headers: { apikey: KEY, authorization: `Bearer ${token}` } })
  const rows = await response.json().catch(() => null)
  return Array.isArray(rows) ? rows.length : -1
}

const factorCount = async (id) => (await sql(`select count(*)::int n from auth.mfa_factors where user_id = '${id}'`))[0].n

const startedAt = new Date().toISOString()

try {
  await cleanUp()
  const actor = await makeHr('actor')
  const target = await makeHr('target')
  const A = actor.token

  /* Who may be reset */
  const own = await call('POST', `/hr/users/${actor.id}/password-reset`, { mode: 'temporary' }, A)
  check('cannot reset your own password', own.status === 409 && /My password/.test(own.json?.error), own)
  const badMode = await call('POST', `/hr/users/${target.id}/password-reset`, { mode: 'email' }, A)
  check('an unknown reset mode is refused', badMode.status === 400, badMode)
  const noMfa = await signIn(target.email, target.password)
  check('a password-only session cannot reset anyone', (await call('POST', `/hr/users/${actor.id}/password-reset`, { mode: 'temporary' }, noMfa.token)).status === 403)

  /* Reset by link */
  check('before a reset, the target reads the database directly', (await directRows(target.token)) > 0)
  const linked = await call('POST', `/hr/users/${target.id}/password-reset`, { mode: 'link' }, A)
  check('a reset link is created', linked.status === 200 && linked.json?.token?.length > 16, linked)
  check('the target’s old session ends', (await call('GET', '/hr/me', undefined, target.token)).status === 401)
  check('the old session cannot read the database directly either', (await directRows(target.token)) === 0)
  check('the old password stops working', Boolean((await signIn(target.email, target.password)).error))
  const token = linked.json.token
  const page = await call('GET', `/public/password-reset/${token}`)
  check('the reset page shows who it is for', page.status === 200 && page.json.email === target.email, page)
  const short = await call('POST', `/public/password-reset/${token}`, { password: 'short', confirm: 'short' })
  check('a short password is refused', short.status === 400, short)
  const tooLong = 'x'.repeat(73)
  const long = await call('POST', `/public/password-reset/${token}`, { password: tooLong, confirm: tooLong })
  check('a password over 72 characters gets the right advice', long.status === 400 && /at most 72/.test(long.json?.errors?.password ?? ''), long)
  const newPassword = randomBytes(12).toString('base64url')
  const done = await call('POST', `/public/password-reset/${token}`, { password: newPassword, confirm: newPassword })
  check('the link sets the new password', done.status === 200 && done.json.email === target.email, done)
  const again = await call('POST', `/public/password-reset/${token}`, { password: newPassword, confirm: newPassword })
  check('the link cannot be used twice', again.status === 404, again)
  const relogged = await signInWithMfa(target.email, newPassword, target.secret)
  check('the new password signs in, with the same authenticator', Boolean(relogged.token))

  /* Temporary password */
  const second = (await call('POST', `/hr/users/${target.id}/password-reset`, { mode: 'link' }, A)).json.token
  const temp = await call('POST', `/hr/users/${target.id}/password-reset`, { mode: 'temporary' }, A)
  check('a temporary password is returned once', temp.status === 200 && /^[\w]{4}(-[\w]{4}){3}$/.test(temp.json?.password ?? ''), temp)
  check('the temporary password signs in', !(await signIn(target.email, temp.json.password)).error)
  check('an open reset link stops working after a temporary password', (await call('GET', `/public/password-reset/${second}`)).status === 404)
  check('the earlier session ends after a temporary password', (await call('GET', '/hr/me', undefined, relogged.token)).status === 401)
  check('and cannot read the database directly', (await directRows(relogged.token)) === 0)

  /* Authenticator reset */
  const beforeFactors = await factorCount(target.id)
  const mfaReset = await call('POST', `/hr/users/${target.id}/authenticator-reset`, {}, A)
  check('the authenticator is reset', mfaReset.status === 200 && beforeFactors === 1 && (await factorCount(target.id)) === 0, { mfaReset, beforeFactors })
  const fresh = await signIn(target.email, temp.json.password)
  const level = (await fresh.auth.auth.mfa.getAuthenticatorAssuranceLevel()).data
  check('their next sign-in asks for a new authenticator', level.currentLevel === 'aal1' && level.nextLevel === 'aal1', level)

  /* Removed users */
  await sql(`update public.hr_users set status = 'inactive' where id = '${target.id}'`)
  const removed = await call('POST', `/hr/users/${target.id}/authenticator-reset`, {}, A)
  check('a removed user cannot be reset', removed.status === 409, removed)
  await sql(`update public.hr_users set status = 'active' where id = '${target.id}'`)

  /* Changing your own password (the browser does it from its own session, as here) */
  const otherDevice = await signInWithMfa(actor.email, actor.password, actor.secret)
  const mine = randomBytes(12).toString('base64url')
  const { error: changeError } = await actor.auth.auth.updateUser({ password: mine })
  check('your own password changes from your session', !changeError, changeError)
  const recorded = await call('POST', '/hr/me/password-changed', {}, A)
  check('the change is recorded', recorded.status === 200, recorded)
  const stay = await call('GET', '/hr/me', undefined, A)
  check('you stay signed in after changing it', stay.status === 200, stay)
  check('your other devices are signed out', (await call('GET', '/hr/me', undefined, otherDevice.token)).status === 401)
  check('your other devices cannot read the database directly', (await directRows(otherDevice.token)) === 0)
  check('this device still reads the database', (await directRows(A)) > 0)
  check('the new password signs in', !(await signIn(actor.email, mine)).error)
  check('the old password stops working', Boolean((await signIn(actor.email, actor.password)).error))

  const audit = await sql(`select action from public.audit_events where affected like 'Smoke Test PW%' and at >= '${startedAt}' order by at`)
  const actions = audit.map((row) => row.action)
  check('every change is in the audit log', ['Password reset link created', 'Password reset completed', 'Temporary password set', 'Authenticator reset', 'Password changed'].every((a) => actions.includes(a)), actions)
  const leaked = await sql(`select count(*)::int n from public.audit_events where affected like 'Smoke Test PW%' and (description like '%${temp.json.password}%' or description like '%${newPassword}%')`)
  check('no password appears in the audit log', leaked[0].n === 0, leaked)
} finally {
  await cleanUp()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
