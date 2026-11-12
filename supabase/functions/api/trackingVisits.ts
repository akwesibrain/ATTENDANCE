/**
 * Outlet visits from a Sales Representative's or Supervisor's phone. Only the
 * phone that clocked in today (its tracking token) can record them, only while
 * the session is open, and each visit needs a face scan that matches. A visit
 * keeps how far the phone was from the shop, never its coordinates.
 */

import { Hono } from 'npm:hono@4.6.14'
import { compareFaces } from '../_shared/faceMatcher.ts'
import { categoryForPosition } from '../_shared/rules/categories.js'
import {
  MAX_VISIT_FACE_ATTEMPTS,
  parseVisitLocation,
  parseVisitOutlet,
  visitFromRow,
  visitRow,
} from '../_shared/rules/tracking.js'
import { faceSample, loadEnrolledPhoto, readable } from './enrolment.ts'
import { syncNotifications } from './facts.ts'
import { ApiError, clientIp, db, found, invalid, later, must, rateLimit, readJson, rpc } from './lib.ts'
import { assertSessionOpen, bearerToken, sessionClosed, sessionFor } from './tracking.ts'

export const publicVisitRoutes = new Hono()

const LIMITS = {
  byToken: [30, 600],
  byIp: [300, 600],
} as const
const VISIT_ROLES = ['sales-rep', 'supervisor']
const NOT_IN_DIRECTORY = 'That outlet is not in the shop directory.'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

async function openSession(token: string) {
  const session = await sessionFor(token)
  await assertSessionOpen(session, new Date())
  return session
}

async function failedToday(staffId: string, date: string) {
  const row = await must(db.from('visit_face_attempts').select('failed').eq('staff_id', staffId).eq('date', date).maybeSingle())
  return row?.failed ?? 0
}

async function shopList(staffId: string) {
  const rows = await found(db.from('employee_shops').select('shop_id, position').eq('staff_id', staffId).order('position'))
  return rows.map((r: Row) => r.shop_id as string)
}

publicVisitRoutes.get('/tracking/visits', async (c) => {
  await rateLimit(`visits:ip:${clientIp(c)}`, ...LIMITS.byIp)
  const session = await openSession(bearerToken(c))
  const ids = await shopList(session.staff_id)
  const [shops, visits, failed] = await Promise.all([
    ids.length ? found(db.from('shops').select('shop_id, shop_name, latitude').in('shop_id', ids)) : Promise.resolve([]),
    found(db.from('outlet_visits').select('*').eq('session_id', session.id).order('occurred_at')),
    failedToday(session.staff_id, session.date),
  ])
  const byId = new Map<string, Row>(shops.map((s: Row) => [s.shop_id, s]))
  const visited = new Set(visits.map((v: Row) => v.shop_id).filter(Boolean))
  return c.json({
    shops: ids.flatMap((id) => {
      const shop = byId.get(id)
      return shop ? [{ shopId: id, shopName: shop.shop_name, hasLocation: shop.latitude != null, visited: visited.has(id) }] : []
    }),
    visits: visits.map(visitFromRow),
    attemptsLeft: Math.max(MAX_VISIT_FACE_ATTEMPTS - failed, 0),
  })
})

publicVisitRoutes.post('/tracking/visits', async (c) => {
  await rateLimit(`visits:ip:${clientIp(c)}`, ...LIMITS.byIp)
  const session = await openSession(bearerToken(c))
  await rateLimit(`visits:token:${session.token_hash.slice(0, 16)}`, ...LIMITS.byToken)

  const employee = await must(db.from('employees').select('staff_id, position').eq('staff_id', session.staff_id).maybeSingle())
  if (!employee || !VISIT_ROLES.includes(categoryForPosition(employee.position))) {
    throw new ApiError(409, 'Only Sales Representatives and Supervisors record outlet visits.')
  }
  if ((await failedToday(session.staff_id, session.date)) >= MAX_VISIT_FACE_ATTEMPTS) {
    throw new ApiError(423, 'Visits are locked for today after 5 face scans that did not match. Contact HR.', { code: 'visits-locked' })
  }

  const body = await readJson(c)
  const outlet = parseVisitOutlet(body)
  if ('error' in outlet) throw invalid({ outlet: outlet.error })
  let shop: Row | null = null
  if ('shopId' in outlet) {
    shop = await must(
      db.from('shops').select('shop_id, latitude, longitude')
        .eq('shop_id', outlet.shopId).eq('company_id', session.company_id).eq('status', 'active').maybeSingle(),
    )
    if (!shop) throw invalid({ outlet: NOT_IN_DIRECTORY })
  }
  const location = parseVisitLocation(body)

  const enrolled = await must(db.from('face_templates').select('algorithm, template').eq('employee_id', session.staff_id).maybeSingle())
  if (!enrolled) throw new ApiError(409, 'No registered face photo on file for this Staff ID. Please contact HR.')
  const face = faceSample(body)
  const { score, match } = await readable(() => compareFaces(enrolled, face, loadEnrolledPhoto))
  if (!match) {
    const failed = await rpc<number>('record_visit_face_failure', { p_staff: session.staff_id, p_date: session.date })
    const attemptsLeft = Math.max(MAX_VISIT_FACE_ATTEMPTS - failed, 0)
    throw new ApiError(403, attemptsLeft
      ? `Face does not match this Staff ID. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left today.`
      : 'Face does not match this Staff ID. Visits are locked for today. Contact HR.', { code: 'face-mismatch', attemptsLeft, lockedOut: attemptsLeft === 0 })
  }

  const listIds = await shopList(session.staff_id)
  const row = visitRow({
    session,
    outlet,
    shop: shop && { shopId: shop.shop_id, latitude: shop.latitude, longitude: shop.longitude },
    listIds,
    location,
    score,
    now: new Date(),
  })
  const stored = await rpc<Row | null>('record_visit', { p_session: session.id, p_visit: row })
  // The session closed while the face was being checked.
  if (!stored) throw sessionClosed()
  later(syncNotifications())
  return c.json({ visit: visitFromRow(stored) }, 201)
})
