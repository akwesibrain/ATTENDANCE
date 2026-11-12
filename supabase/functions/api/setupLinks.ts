/**
 * One-time setup links: a face link for an employee, an HR invite link, or an
 * HR user's password reset link.
 * Only the SHA-256 hash of each token is stored; the plain token goes back to
 * HR once, and the browser turns it into an address.
 */

import { sendSms, smsConfigured } from '../_shared/smsSender.ts'
import { LINK_UNUSABLE, linkExpiry, linkState, smsPlan } from '../_shared/rules/onboarding.js'
import { randomToken } from '../_shared/rules/siteCode.js'
import { ApiError, applyChange, db, must, sha256Hex } from './lib.ts'

export type LinkKind = 'face' | 'hr-invite' | 'password-reset'
export type LinkResult = { token: string; expiresAt: string; sms: 'sent' | 'skipped' | 'failed'; smsReason: string }
export type LinkRow = {
  token_hash: string
  kind: LinkKind
  staff_id: string | null
  invite_id: string | null
  hr_user_id: string | null
  expires_at: string
  used_at: string | null
  cancelled_at: string | null
}

type Subject = { staffId?: string; inviteId?: string; hrUserId?: string }

function subjectMatch(kind: LinkKind, subject: Subject) {
  if (kind === 'face' && subject.staffId) return { kind, staff_id: subject.staffId }
  if (kind === 'hr-invite' && subject.inviteId) return { kind, invite_id: subject.inviteId }
  if (kind === 'password-reset' && subject.hrUserId) return { kind, hr_user_id: subject.hrUserId }
  throw new Error(`A ${kind} link needs its subject`)
}

/** Cancel every earlier link for this subject, as one change list. */
export function cancelLinksOps(kind: LinkKind, subject: Subject, nowIso = new Date().toISOString()) {
  return [{ table: 'setup_links', op: 'update', match: subjectMatch(kind, subject), row: { cancelled_at: nowIso } }]
}

/** A new link for the subject. Earlier links for the same subject stop working. */
export async function createLink(kind: LinkKind, subject: Subject, createdBy: string, audit: unknown = null) {
  const token = randomToken(24)
  const now = Date.now()
  const expiresAt = linkExpiry(kind, now)
  await applyChange([
    ...cancelLinksOps(kind, subject, new Date(now).toISOString()),
    {
      table: 'setup_links',
      op: 'insert',
      row: {
        token_hash: await sha256Hex(token),
        kind,
        staff_id: subject.staffId ?? null,
        invite_id: subject.inviteId ?? null,
        hr_user_id: subject.hrUserId ?? null,
        expires_at: expiresAt,
        created_by: createdBy,
      },
    },
  ], audit)
  return { token, expiresAt }
}

/** The link behind a token, or a 404 carrying the one message for every unusable link. */
export async function openLink(token: unknown, kind: LinkKind): Promise<LinkRow> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) throw new ApiError(404, LINK_UNUSABLE)
  const row = await must(
    db.from('setup_links').select('*').eq('token_hash', await sha256Hex(token)).eq('kind', kind).maybeSingle(),
  ) as LinkRow | null
  if (linkState(row) !== 'open') throw new ApiError(404, LINK_UNUSABLE)
  return row as LinkRow
}

/** Text the link when SMS can carry it; say why when it cannot. */
export async function deliverLink(
  { phone, message, path }: { phone: string; message: (url: string) => string; path: string },
): Promise<Pick<LinkResult, 'sms' | 'smsReason'>> {
  const appUrl = Deno.env.get('APP_URL')?.trim().replace(/\/$/, '') ?? ''
  const plan = smsPlan({ phone, smsOn: smsConfigured(), appUrl })
  if (!plan.send) return { sms: 'skipped', smsReason: plan.reason }
  const sent = await sendSms(phone, message(appUrl + path)).catch((error) => {
    console.error('setup link sms failed', error)
    return false
  })
  return sent ? { sms: 'sent', smsReason: '' } : { sms: 'failed', smsReason: 'The SMS provider refused the message.' }
}
