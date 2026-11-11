import { describe, expect, it } from 'vitest'
import {
  CODE_STEP_SECONDS,
  checkSiteCode,
  checkSitePass,
  makeSiteCode,
  makeSitePass,
  newDisplayId,
  parseSiteCode,
  passDisplayId,
  randomToken,
  siteCodeUrl,
} from '../supabase/functions/_shared/rules/siteCode.js'
import { attendanceGate, OTHER_COMPANY_CODE, SCAN_WORKPLACE_CODE } from '../supabase/functions/_shared/rules/checkin.js'

const id = newDisplayId()
const secret = randomToken()
const NOW = Date.parse('2026-11-11T08:00:00Z')
const step = CODE_STEP_SECONDS * 1000

describe('workplace QR codes', () => {
  it('are accepted while fresh', async () => {
    const code = await makeSiteCode(id, secret, NOW)
    expect(parseSiteCode(code)?.displayId).toBe(id)
    expect(await checkSiteCode(code, secret, NOW)).toBe('valid')
    expect(await checkSiteCode(code, secret, NOW + 2 * step)).toBe('valid')
  })

  it('run out after about a minute', async () => {
    const code = await makeSiteCode(id, secret, NOW)
    expect(await checkSiteCode(code, secret, NOW + 3 * step)).toBe('expired')
    expect(await checkSiteCode(code, secret, NOW - 2 * step)).toBe('expired')
  })

  it('cannot be made without the display secret or altered', async () => {
    const forged = await makeSiteCode(id, randomToken(), NOW)
    expect(await checkSiteCode(forged, secret, NOW)).toBe('invalid')
    const code = await makeSiteCode(id, secret, NOW)
    const [d, s, sig] = code.split('.')
    expect(await checkSiteCode(`${d}.${Number(s) + 1}.${sig}`, secret, NOW)).toBe('invalid')
    expect(await checkSiteCode('dsp-1.2.3', secret, NOW)).toBe('invalid')
    expect(await checkSiteCode(undefined, secret, NOW)).toBe('invalid')
  })

  it('open the check-in page', async () => {
    const code = await makeSiteCode(id, secret, NOW)
    expect(siteCodeUrl('https://app.example', code)).toBe(`https://app.example/attendance?site=${encodeURIComponent(code)}`)
  })
})

describe('site passes', () => {
  it('last ten minutes', async () => {
    const { pass } = await makeSitePass(id, secret, NOW)
    expect(passDisplayId(pass)).toBe(id)
    expect(await checkSitePass(pass, secret, NOW + 9 * 60000)).toBe(true)
    expect(await checkSitePass(pass, secret, NOW + 11 * 60000)).toBe(false)
  })

  it('cannot be made from a QR code or another secret', async () => {
    const code = await makeSiteCode(id, secret, NOW)
    expect(await checkSitePass(code, secret, NOW)).toBe(false)
    const { pass } = await makeSitePass(id, randomToken(), NOW)
    expect(await checkSitePass(pass, secret, NOW)).toBe(false)
  })
})

describe('checking in with a workplace code', () => {
  const at = new Date('2026-11-10T08:30:00Z')
  const gate = (extra) => attendanceGate({ fullName: 'Ama Mensah', status: 'ACTIVE', eventTypes: [], now: at, companyId: 'double-a', ...extra })
  const site = { companyId: 'double-a', name: 'Tema warehouse' }

  it('needs a scan only where the company requires it', () => {
    expect(gate({ siteRequired: true }).blockedReason).toBe(SCAN_WORKPLACE_CODE)
    expect(gate({ siteRequired: true, site }).blockedReason).toBeNull()
    expect(gate({ siteRequired: false }).blockedReason).toBeNull()
  })

  it("refuses another company's display", () => {
    expect(gate({ site: { ...site, companyId: 'box-for-less' } }).blockedReason).toBe(OTHER_COMPANY_CODE)
  })
})
