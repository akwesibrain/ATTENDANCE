/**
 * HR adding employees, and employees setting up their face through a
 * one-time link HR sent them.
 */

import { Hono } from 'npm:hono@4.6.14'
import type { Context } from 'npm:hono@4.6.14'
import { enrollFace } from '../_shared/faceMatcher.ts'
import { faceLinkRefusal } from '../_shared/rules/onboarding.js'
import { parseRegistration } from '../_shared/rules/registration.js'
import { assertCompany, type HrEnv, type HrUser } from './auth.ts'
import { ENROLLMENT_BUCKET, enrolNewFace, faceSample, readable, registerEmployee } from './enrolment.ts'
import { ApiError, clientIp, db, discardPhoto, invalid, must, rateLimit, readJson, rpc, sha256Hex, storePhoto } from './lib.ts'
import { createLink, deliverLink, type LinkResult, openLink } from './setupLinks.ts'

const LIMITS = {
  enrolView: [60, 600],
  enrolByIp: [20, 600],
  enrolByToken: [10, 600],
} as const

export const hrEmployeeRoutes = new Hono<HrEnv>()
export const publicEnrolRoutes = new Hono()

const faceSms = (fullName: string) => (url: string) =>
  `Workforce attendance: hi ${fullName.split(' ')[0]}, set up your face for check-in here: ${url} (valid 7 days).`

/** Make a face link for an employee and text it to them when possible. */
async function sendFaceLink(hr: HrUser, employee: { staff_id: string; full_name: string; company_id: string; phone: string }): Promise<LinkResult> {
  const link = await createLink('face', { staffId: employee.staff_id }, hr.name, {
    source: 'Employee onboarding',
    action: 'Face setup link sent',
    category: 'Employee Management',
    actorName: hr.name,
    actorRole: hr.role,
    companyIds: [employee.company_id],
    affected: `${employee.full_name} (${employee.staff_id})`,
    description: 'A one-time face setup link was created. Any earlier link for this employee stopped working.',
  })
  const delivery = await deliverLink({ phone: employee.phone, message: faceSms(employee.full_name), path: `/enroll/${link.token}` })
  return { ...link, ...delivery }
}

hrEmployeeRoutes.post('/employees', async (c) => {
  const hr = c.get('hr')
  const body = await readJson(c)
  const withFace = Boolean(body.faceImage)

  // deno-lint-ignore no-explicit-any
  const parsed = parseRegistration(body, { faceRequired: withFace }) as any
  if (parsed.errors) throw invalid(parsed.errors)
  const form = parsed.value
  assertCompany(c, form.companyId)

  const face = withFace ? await enrolNewFace(body, form.companyId) : null
  const employee = await registerEmployee(form, face, { name: hr.name, role: hr.role })

  // The employee exists from here on. A link failure must not look like the
  // whole request failed, or HR would add the same person twice.
  let link: LinkResult | undefined
  let linkError: string | undefined
  if (!withFace && body.sendFaceLink === true) {
    try {
      link = await sendFaceLink(hr, {
        staff_id: employee.staff_id as string,
        full_name: employee.full_name as string,
        company_id: employee.company_id as string,
        phone: (employee.phone as string) ?? '',
      })
    } catch (error) {
      console.error('face link after adding employee failed', employee.staff_id, error)
      linkError = 'The employee was added, but the face setup link could not be created. Open their details and use Send face setup link.'
    }
  }

  return c.json({
    staffId: employee.staff_id,
    fullName: employee.full_name,
    companyName: employee.company_name,
    link,
    linkError,
  }, 201)
})

hrEmployeeRoutes.post('/employees/:staffId/face-link', async (c) => {
  const employee = await must(
    db.from('employees').select('staff_id, full_name, company_id, phone, status').eq('staff_id', c.req.param('staffId')).maybeSingle(),
  )
  if (!employee) throw new ApiError(404, 'Employee not found.')
  assertCompany(c, employee.company_id)
  const refusal = faceLinkRefusal(employee)
  if (refusal) throw new ApiError(409, refusal)
  return c.json(await sendFaceLink(c.get('hr'), employee))
})

async function enrolLink(c: Context, limit: readonly [number, number]) {
  await rateLimit(`enrol-view:ip:${clientIp(c)}`, ...limit)
  return await openLink(c.req.param('token'), 'face')
}

publicEnrolRoutes.get('/public/enroll/:token', async (c) => {
  const link = await enrolLink(c, LIMITS.enrolView)
  const employee = await must(
    db.from('employees').select('staff_id, full_name, company_name').eq('staff_id', link.staff_id).maybeSingle(),
  )
  if (!employee) throw new ApiError(404, 'Employee not found.')
  return c.json({ staffId: employee.staff_id, fullName: employee.full_name, companyName: employee.company_name })
})

publicEnrolRoutes.post('/public/enroll/:token', async (c) => {
  await rateLimit(`enrol:ip:${clientIp(c)}`, ...LIMITS.enrolByIp)
  const token = c.req.param('token')
  await rateLimit(`enrol:token:${await sha256Hex(token)}`, ...LIMITS.enrolByToken)
  const link = await openLink(token, 'face')
  const body = await readJson(c)
  if (body.biometricConsent !== true) throw invalid({ biometricConsent: 'Biometric consent is required to set up your face.' })

  const employee = await must(db.from('employees').select('company_id').eq('staff_id', link.staff_id).maybeSingle())
  if (!employee) throw new ApiError(404, 'Employee not found.')

  const face = faceSample(body)
  const photoPath = `${employee.company_id}/${crypto.randomUUID()}.jpg`
  const template = await readable(() => enrollFace(face, photoPath))
  await storePhoto(ENROLLMENT_BUCKET, photoPath, face.image)

  let result: { staff_id: string; full_name: string; previous_photo_path: string | null }
  try {
    result = await rpc('enroll_face', { p_token_hash: link.token_hash, p_template: template, p_photo_path: photoPath })
  } catch (error) {
    await discardPhoto(ENROLLMENT_BUCKET, photoPath)
    throw error
  }
  if (result.previous_photo_path) await discardPhoto(ENROLLMENT_BUCKET, result.previous_photo_path)
  return c.json({ staffId: result.staff_id, fullName: result.full_name })
})
