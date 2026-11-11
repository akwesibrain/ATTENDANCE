import type { Context, MiddlewareHandler } from 'npm:hono@4.6.14'
import { ApiError, db, must, rateLimit } from './lib.ts'

export type HrUser = { id: string; name: string; role: string; companyIds: string[] }
export type HrEnv = { Variables: { hr: HrUser } }

const ROLE_LABELS: Record<string, string> = { 'hr-manager': 'HR Manager' }

/** Which sign-in level the session reached. The token is verified before this is read. */
function assuranceLevel(token: string): string | undefined {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(payload)).aal
}

/** Active HR users who completed MFA, and nobody else. */
export const requireHr: MiddlewareHandler<HrEnv> = async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) throw new ApiError(401, 'Please sign in.')

  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'Your session has ended. Please sign in again.')
  if (assuranceLevel(token) !== 'aal2') {
    throw new ApiError(403, 'Enter your authenticator code to continue.', { code: 'mfa-required' })
  }

  const user = await must(db.from('hr_users').select('id, name, role_id, company_ids, status').eq('id', data.user.id).maybeSingle())
  if (!user || user.status !== 'active') throw new ApiError(403, 'This account does not have access.')

  await rateLimit(`hr:${user.id}`, 600, 60)
  c.set('hr', {
    id: user.id,
    name: user.name,
    role: ROLE_LABELS[user.role_id] ?? user.role_id,
    companyIds: user.company_ids,
  })
  await next()
}

export function assertCompany(c: Context<HrEnv>, companyId: string, message = 'You are not authorised for this company.') {
  if (!c.get('hr').companyIds.includes(companyId)) throw new ApiError(403, message)
}

/** Settings that apply to every company need access to every company. */
export async function assertAllCompanies(c: Context<HrEnv>) {
  const companies = await must(db.from('companies').select('id'))
  if (!(companies ?? []).every((company) => c.get('hr').companyIds.includes(company.id))) {
    throw new ApiError(403, 'You are not authorised to change these settings.')
  }
}
