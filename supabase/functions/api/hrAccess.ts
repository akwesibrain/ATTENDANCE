/**
 * Who can use the HR portal: HR invites people by one-time link, and can
 * remove or restore access. The invited person chooses their own password.
 */

import { Hono } from 'npm:hono@4.6.14'
import type { Context } from 'npm:hono@4.6.14'
import { existingAccountRefusal, LINK_UNUSABLE, validateInvite, validateNewPassword } from '../_shared/rules/onboarding.js'
import { assertAllCompanies, type HrEnv, type HrUser } from './auth.ts'
import { ApiError, applyChange, clientIp, db, found, invalid, must, rateLimit, readJson, rpc } from './lib.ts'
import { cancelLinksOps, createLink, deliverLink, type LinkResult, openLink } from './setupLinks.ts'

const SETUP_LIMIT = [20, 600] as const

export const hrAccessRoutes = new Hono<HrEnv>()
export const publicHrSetupRoutes = new Hono()

type Invite = { id: string; name: string; email: string; phone: string; invited_by: string; status: string }

const accessAudit = (hr: HrUser | null, action: string, affected: string, description: string, companyIds: string[] = []) => ({
  source: 'HR access',
  action,
  category: 'HR Users & Permissions',
  actorName: hr?.name ?? affected,
  actorRole: hr?.role ?? 'Invited HR user',
  companyIds,
  affected,
  description,
})

const inviteSms = (inviter: string) => (url: string) =>
  `Workforce HR portal: ${inviter} gave you access. Set your password here: ${url} (valid 24 hours).`

async function sendInviteLink(hr: HrUser, invite: Invite, audit: unknown): Promise<LinkResult> {
  const link = await createLink('hr-invite', { inviteId: invite.id }, hr.name, audit)
  const delivery = await deliverLink({ phone: invite.phone, message: inviteSms(invite.invited_by), path: `/hr/setup/${link.token}` })
  return { ...link, ...delivery }
}

async function pendingInvite(id: string): Promise<Invite> {
  const invite = await must(db.from('hr_invites').select('*').eq('id', id).maybeSingle()) as Invite | null
  if (!invite || invite.status !== 'pending') throw new ApiError(404, 'This invite is no longer pending.')
  return invite
}

/**
 * The sign-in account for an email, counted only once its email is confirmed.
 * Public sign-up can create unconfirmed accounts for any address, and those
 * must never receive HR access.
 */
async function confirmedAccount(email: string): Promise<{ id: string | null; unconfirmedId: string | null }> {
  const id = await rpc<string | null>('auth_user_id_for_email', { p_email: email })
  if (!id) return { id: null, unconfirmedId: null }
  const { data, error } = await db.auth.admin.getUserById(id)
  if (error || !data.user) throw new ApiError(500, 'Could not check the account. Please try again.')
  return data.user.email_confirmed_at ? { id, unconfirmedId: null } : { id: null, unconfirmedId: id }
}

hrAccessRoutes.get('/users', async (c) => {
  await assertAllCompanies(c)
  const users = await found(db.from('hr_users').select('id, name, email, status, last_login_at, created_at').order('created_at'))
  const invites = await found(
    db.from('hr_invites').select('id, name, email, phone, invited_by, created_at').eq('status', 'pending').order('created_at'),
  )
  const links = invites.length
    ? await found(
      db.from('setup_links').select('invite_id, expires_at').eq('kind', 'hr-invite').is('used_at', null).is('cancelled_at', null)
        .in('invite_id', invites.map((invite) => invite.id)),
    )
    : []
  const expiry = new Map<string, string>()
  for (const link of links) {
    if (!expiry.has(link.invite_id) || link.expires_at > expiry.get(link.invite_id)!) expiry.set(link.invite_id, link.expires_at)
  }
  return c.json({
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, lastLoginAt: u.last_login_at })),
    invites: invites.map((i) => ({
      id: i.id,
      name: i.name,
      email: i.email,
      phone: i.phone,
      invitedBy: i.invited_by,
      createdAt: i.created_at,
      expiresAt: expiry.get(i.id) ?? null,
    })),
  })
})

hrAccessRoutes.post('/invites', async (c) => {
  await assertAllCompanies(c)
  const hr = c.get('hr')
  const parsed = validateInvite(await readJson(c))
  if (parsed.errors) throw invalid(parsed.errors)
  const { name, email, phone } = parsed.value

  const { id: existingId } = await confirmedAccount(email)
  if (existingId) {
    const row = await must(db.from('hr_users').select('status').eq('id', existingId).maybeSingle())
    if (row?.status === 'active') throw new ApiError(409, 'This person already has HR access.')
  }

  const earlier = await found(db.from('hr_invites').select('id').eq('email', email).eq('status', 'pending'))
  const invite: Invite = { id: crypto.randomUUID(), name, email, phone, invited_by: hr.name, status: 'pending' }
  await applyChange([
    ...earlier.flatMap((old) => [
      ...cancelLinksOps('hr-invite', { inviteId: old.id }),
      { table: 'hr_invites', op: 'update', match: { id: old.id }, row: { status: 'cancelled' } },
    ]),
    { table: 'hr_invites', op: 'insert', row: { id: invite.id, name, email, phone, invited_by: hr.name, invited_by_id: hr.id } },
  ])

  const result = await sendInviteLink(hr, invite, accessAudit(hr, 'HR user invited', `${name} (${email})`, 'Invited to the HR portal with a one-time setup link.'))
  return c.json({ inviteId: invite.id, ...result }, 201)
})

hrAccessRoutes.post('/invites/:id/link', async (c) => {
  await assertAllCompanies(c)
  const hr = c.get('hr')
  const invite = await pendingInvite(c.req.param('id'))
  return c.json(await sendInviteLink(hr, invite, accessAudit(hr, 'HR invite link sent', `${invite.name} (${invite.email})`, 'A new setup link was created. The earlier one stopped working.')))
})

hrAccessRoutes.post('/invites/:id/cancel', async (c) => {
  await assertAllCompanies(c)
  const hr = c.get('hr')
  const invite = await pendingInvite(c.req.param('id'))
  await applyChange([
    ...cancelLinksOps('hr-invite', { inviteId: invite.id }),
    { table: 'hr_invites', op: 'update', match: { id: invite.id }, row: { status: 'cancelled' } },
  ], accessAudit(hr, 'HR invite cancelled', `${invite.name} (${invite.email})`, 'The invite and its setup link were cancelled.'))
  return c.json({ ok: true })
})

hrAccessRoutes.post('/users/:id/status', async (c) => {
  await assertAllCompanies(c)
  const hr = c.get('hr')
  const body = await readJson(c)
  const status = body.status
  if (status !== 'active' && status !== 'inactive') throw invalid({ status: 'Choose active or inactive.' })
  const user = await rpc<Record<string, string>>('set_hr_user_status', { p_actor: hr.id, p_target: c.req.param('id'), p_status: status })
  if (status === 'inactive') {
    await rpc('end_user_sessions', { p_user: user.id })
  }
  await applyChange(
    status === 'inactive' ? [...cancelLinksOps('password-reset', { hrUserId: user.id })] : [],
    accessAudit(
      hr,
      status === 'active' ? 'HR access restored' : 'HR access removed',
      `${user.name} (${user.email})`,
      status === 'active'
        ? 'Can use the HR portal again.'
        : 'Can no longer use the HR portal. Active sessions and reset links were ended.',
    ),
  )
  return c.json({ user: { id: user.id, name: user.name, email: user.email, status: user.status, lastLoginAt: user.last_login_at } })
})

/** The signed-in user behind the request's bearer token, if any. Any assurance level counts. */
async function callerUserId(c: Context): Promise<string | null> {
  const auth = c.req.header('authorization')
  if (!auth || !/^Bearer\s+/i.test(auth)) return null
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  return error || !data.user ? null : data.user.id
}

async function setupInvite(c: Context) {
  await rateLimit(`hr-setup:ip:${clientIp(c)}`, ...SETUP_LIMIT)
  const link = await openLink(c.req.param('token'), 'hr-invite')
  const invite = await must(db.from('hr_invites').select('*').eq('id', link.invite_id).maybeSingle()) as Invite | null
  if (!invite || invite.status !== 'pending') throw new ApiError(404, 'This link has expired or was already used. Ask HR for a new one.')
  return { link, invite }
}

publicHrSetupRoutes.get('/public/hr-setup/:token', async (c) => {
  const { invite } = await setupInvite(c)
  const { id } = await confirmedAccount(invite.email)
  return c.json({ name: invite.name, email: invite.email, invitedBy: invite.invited_by, hasAccount: Boolean(id) })
})

publicHrSetupRoutes.post('/public/hr-setup/:token', async (c) => {
  const { link, invite } = await setupInvite(c)
  const body = await readJson(c)
  const { id: existingId, unconfirmedId } = await confirmedAccount(invite.email)

  if (existingId) {
    // Proof the person accepting owns this sign-in: they signed in with its password first.
    const refusal = existingAccountRefusal({ accountId: existingId, callerId: await callerUserId(c) })
    if (refusal) throw new ApiError(403, refusal, { code: 'sign-in-required' })
  } else {
    const problem = validateNewPassword(body.password, body.confirm)
    if (problem) throw invalid({ password: problem })
  }

  // Claim the setup link atomically first so concurrent submissions cannot both create accounts.
  const now = new Date().toISOString()
  const claimed = await must(
    db.from('setup_links')
      .update({ used_at: now })
      .eq('token_hash', link.token_hash)
      .is('used_at', null)
      .is('cancelled_at', null)
      .gt('expires_at', now)
      .select('token_hash'),
  )
  if (!claimed?.length) throw new ApiError(404, LINK_UNUSABLE)

  let userId = existingId
  let passwordSet = false
  try {
    if (!userId) {
      const password = body.password as string
      // An unconfirmed account never proved who owns the address; the invited person takes it over.
      const { data, error } = unconfirmedId
        ? await db.auth.admin.updateUserById(unconfirmedId, { password, email_confirm: true })
        : await db.auth.admin.createUser({ email: invite.email, password, email_confirm: true })
      if (error || !data.user) {
        console.error('could not create hr sign-in', error?.message)
        throw new ApiError(500, 'Could not create your sign-in. Please try again.')
      }
      userId = data.user.id
      passwordSet = true
    }

    const companies = await found(db.from('companies').select('id'))
    await applyChange([
      {
        table: 'hr_users',
        op: 'upsert',
        conflict: ['id'],
        row: { id: userId, name: invite.name, email: invite.email, role_id: 'hr-manager', company_ids: companies.map((co) => co.id), status: 'active' },
      },
      { table: 'hr_invites', op: 'update', match: { id: invite.id }, row: { status: 'accepted', accepted_user_id: userId } },
    ], accessAudit(null, 'HR invite accepted', `${invite.name} (${invite.email})`, `Joined the HR portal, invited by ${invite.invited_by}.`))
  } catch (error) {
    await db.from('setup_links').update({ used_at: null }).eq('token_hash', link.token_hash)
    throw error
  }

  return c.json({ email: invite.email, passwordSet })
})
