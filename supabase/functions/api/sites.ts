/**
 * Workplace QR displays on the server: finding a display's secret and checking
 * the pass a phone got by scanning its code.
 */

import { checkSitePass, passDisplayId } from '../_shared/rules/siteCode.js'
import { ApiError, db, must } from './lib.ts'

export type Site = { displayId: string; companyId: string; name: string }

export const SCAN_AGAIN = 'Your workplace QR scan has expired. Scan the code on the screen again.'

/** An active, set-up display with its secret, or null. */
export async function activeDisplay(id: string) {
  const display = await must(
    db.from('workplace_displays').select('id, company_id, company:companies(name), name, status').eq('id', id).maybeSingle(),
  )
  if (!display || display.status !== 'active') return null
  const secret = await must(db.from('display_secrets').select('secret').eq('display_id', id).maybeSingle())
  if (!secret) return null
  const company = display.company as unknown as { name: string } | null
  return { id: display.id as string, companyId: display.company_id as string, companyName: company?.name ?? '', name: display.name as string, secret: secret.secret as string }
}

/**
 * The workplace a pass proves, or null when none was sent.
 * A pass that was sent but is no longer valid is refused, so the employee
 * scans again rather than being told the scan is missing.
 */
export async function siteFromPass(pass: unknown): Promise<Site | null> {
  if (pass == null || pass === '') return null
  const id = typeof pass === 'string' ? passDisplayId(pass) : null
  const display = id ? await activeDisplay(id) : null
  if (!display || !(await checkSitePass(pass as string, display.secret))) {
    throw new ApiError(410, SCAN_AGAIN, { code: 'site-expired' })
  }
  return { displayId: display.id, companyId: display.companyId, name: display.name }
}
