/**
 * HR portal passwords: HR resets another HR user's password (by one-time link
 * or temporary password) or authenticator, and an HR user's own password change
 * is recorded. Every reset signs the person out everywhere. Passwords are never
 * logged.
 */

import { Hono } from 'npm:hono@4.6.14'
import type { Context } from 'npm:hono@4.6.14'
import {
  LINK_UNUSABLE,
  passwordResetRefusal,
  temporaryPassword,
  validateNewPassword,
} from '../_shared/rules/onboarding.js'
import { randomToken } from '../_shared/rules/siteCode.js'
import { assertAllCompanies, type HrEnv } from './auth.ts'
import { ApiError, applyChange, clientIp, db, invalid, must, rateLimit, readJson, rpc } from './lib.ts'
import { cancelLinksOps, createLink, openLink } from './setupLinks.ts'

const LIMITS = {
  ownChange: [10, 3600],
  resetPage: [20, 600],
} as const

export const hrPasswordRoutes = new Hono<HrEnv>()
export const publicPasswordResetRoutes = new Hono()

type HrRow = { id: string; name: string; email: string; status: string }

const passwordAudit = (actor: { name: string; role: string }, action: string, target: HrRow, description: string) => ({
  source: 'HR access',
  action,
  category: 'HR Users & Permissions',
  actorName: actor.name,
  actorRole: actor.role,
  companyIds: [],
  affected: `${target.name} (${target.email})`,
  description,
})

/** Set a sign-in password, turning Supabase's errors into one the person can act on. */
async function setPassword(userId: string, password: string) {
  const { error } = await db.auth.admin.updateUserById(userId, { password })
  if (!error) return
  console.error('password update failed', userId, error.message)
  // Weak, leaked or too-long passwords: Supabase's own message says what to change.
  if (error.status === 422 || /password/i.test(error.message)) throw invalid({ password: `That password was not accepted: ${error.message}` })
  throw new ApiError(500, 'Could not change the password. Please try again.')
}

/** Sign the person out on every device. Their old access tokens stop working too. */
async function endSessions(userId: string) {
  await rpc('end_user_sessions', { p_user: userId })
}

/** The HR user HR wants to reset, or a refusal. */
async function resetTarget(c: Context<HrEnv>): Promise<HrRow> {
  await assertAllCompanies(c)
  const target = await must(
    db.from('hr_users').select('id, name, email, status').eq('id', c.req.param('id')).maybeSingle(),
  ) as HrRow | null
  const refusal = passwordResetRefusal({ actorId: c.get('hr').id, target })
  if (refusal) throw new ApiError(target ? 409 : 404, refusal)
  return target as HrRow
}

/**
 * Records that an HR user changed their own password. The browser changes it
 * from the user's own session, which keeps that session and signs them out
 * everywhere else; a change made here with admin rights would end every
 * session, including the one in use.
 */
hrPasswordRoutes.post('/me/password-changed', async (c) => {
  const hr = c.get('hr')
  await rateLimit(`own-password:${hr.id}`, ...LIMITS.ownChange)
  const me = await must(db.from('hr_users').select('id, name, email, status').eq('id', hr.id).single()) as HrRow
  await applyChange([], passwordAudit(hr, 'Password changed', me, 'Changed their own password. Signed out on their other devices.'))
  return c.json({ ok: true })
})

hrPasswordRoutes.post('/users/:id/password-reset', async (c) => {
  const hr = c.get('hr')
  const target = await resetTarget(c)
  const body = await readJson(c)
  if (body.mode !== 'link' && body.mode !== 'temporary') throw invalid({ mode: 'Choose a reset link or a temporary password.' })

  if (body.mode === 'link') {
    const link = await createLink('password-reset', { hrUserId: target.id }, hr.name, passwordAudit(
      hr,
      'Password reset link created',
      target,
      'A one-time password reset link was created. Their old password stopped working and they were signed out everywhere.',
    ))
    // The old password must stop working now, not only once the link is used.
    await setPassword(target.id, randomToken(32))
    await endSessions(target.id)
    return c.json({ token: link.token, expiresAt: link.expiresAt })
  }

  const password = temporaryPassword()
  await setPassword(target.id, password)
  await endSessions(target.id)
  await applyChange(cancelLinksOps('password-reset', { hrUserId: target.id }), passwordAudit(
    hr,
    'Temporary password set',
    target,
    'A temporary password was set. Their old password and any reset link stopped working, and they were signed out everywhere.',
  ))
  return c.json({ password })
})

hrPasswordRoutes.post('/users/:id/authenticator-reset', async (c) => {
  const hr = c.get('hr')
  const target = await resetTarget(c)
  const { data, error } = await db.auth.admin.mfa.listFactors({ userId: target.id })
  if (error) throw new ApiError(500, 'Could not reset the authenticator. Please try again.')
  for (const factor of data.factors) {
    const { error: deleteError } = await db.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.id })
    if (deleteError) throw new ApiError(500, 'Could not reset the authenticator. Please try again.')
  }
  await endSessions(target.id)
  await applyChange([], passwordAudit(
    hr,
    'Authenticator reset',
    target,
    'Their authenticator app was removed and they were signed out everywhere. They set up a new one at their next sign-in.',
  ))
  return c.json({ ok: true })
})

async function resetLink(c: Context) {
  await rateLimit(`password-reset:ip:${clientIp(c)}`, ...LIMITS.resetPage)
  const link = await openLink(c.req.param('token'), 'password-reset')
  const user = await must(
    db.from('hr_users').select('id, name, email, status').eq('id', link.hr_user_id).maybeSingle(),
  ) as HrRow | null
  if (!user || user.status !== 'active') throw new ApiError(404, LINK_UNUSABLE)
  return { link, user }
}

publicPasswordResetRoutes.get('/public/password-reset/:token', async (c) => {
  const { user } = await resetLink(c)
  return c.json({ name: user.name, email: user.email })
})

publicPasswordResetRoutes.post('/public/password-reset/:token', async (c) => {
  const { link, user } = await resetLink(c)
  const body = await readJson(c)
  const problem = validateNewPassword(body.password, body.confirm)
  if (problem) throw invalid({ password: problem })

  // Claim the link first, so two requests with the same link cannot both win.
  const now = new Date().toISOString()
  const claimed = await must(
    db.from('setup_links').update({ used_at: now }).eq('token_hash', link.token_hash)
      .is('used_at', null).is('cancelled_at', null).gt('expires_at', now).select('token_hash'),
  )
  if (!claimed?.length) throw new ApiError(404, LINK_UNUSABLE)

  try {
    await setPassword(user.id, body.password as string)
  } catch (error) {
    // Nothing changed, so give the link back for another try.
    await db.from('setup_links').update({ used_at: null }).eq('token_hash', link.token_hash)
    throw error
  }
  await applyChange([], passwordAudit(
    { name: user.name, role: 'HR user' },
    'Password reset completed',
    user,
    'Chose a new password with a reset link.',
  ))
  return c.json({ email: user.email })
})
