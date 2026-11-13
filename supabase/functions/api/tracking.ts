/**
 * Live tracking from field staff's phones. A token is issued at clock-in
 * (openTrackingSession) and is the only way to send points; points are
 * accepted only inside the session window, by server time. After clock-out,
 * or the end of the clock-out window, the phone is told `session_closed` and
 * stops sharing.
 */

import { Hono } from 'npm:hono@4.6.14'
import type { Context } from 'npm:hono@4.6.14'
import { randomToken } from '../_shared/rules/siteCode.js'
import { MAX_POINTS_PER_REQUEST, screenPoints, trackingSessionRow } from '../_shared/rules/tracking.js'
import { ApiError, clientIp, db, later, must, rateLimit, rpc, sha256Hex } from './lib.ts'
import { closePastDays } from './trackingDays.ts'

export const publicTrackingRoutes = new Hono()

const LIMITS = {
  byToken: [120, 600],
  byIp: [600, 600],
} as const
const MAX_BODY_BYTES = 64 * 1024

type Employee = { staff_id: string; company_id: string; position: string }
type Event = { date: string; occurred_at: string }
type Kept = { latitude: number; longitude: number; accuracy: number | null; recorded_at: string; is_mock: boolean; flagged: 'mock' | 'speed' | null }
type Screened = { keep: Kept[]; rejected: number; flags: { mock: number; speed: number } }

/**
 * Opens today's tracking session for a field employee who just clocked in.
 * Returns the token for the phone, or null for other roles or on failure: a
 * tracking problem must never undo a check-in.
 */
export async function openTrackingSession(employee: Employee, event: Event, closesAt: string) {
  const token = randomToken(32)
  const row = trackingSessionRow(employee, event, closesAt, await sha256Hex(token))
  if (!row) return null
  const { error } = await db.from('tracking_sessions').insert(row)
  if (error) {
    console.error('could not open tracking session', employee.staff_id, error.message)
    return null
  }
  return { token, closesAt }
}

const sessionClosed = () => new ApiError(409, 'Location sharing has stopped because you clocked out.', { code: 'session_closed' })

/** The tracking token from `Authorization: Bearer …`. */
export function bearerToken(c: Context) {
  return (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}

/** The session a tracking token belongs to; 401 for an unknown token. */
export async function sessionFor(token: string) {
  const session = token
    ? await must(db.from('tracking_sessions').select('*').eq('token_hash', await sha256Hex(token)).maybeSingle())
    : null
  if (!session) throw new ApiError(401, 'This location sharing link is not valid.', { code: 'invalid_token' })
  return session
}

/**
 * Refuses a closed session with 409 session_closed. A session past its closing
 * time (no clock-out) is closed first, as the end of the working day.
 */
export async function assertSessionOpen(session: { id: string; staff_id: string; date: string; status: string; closes_at: string }, now: Date) {
  if (session.status === 'closed') throw sessionClosed()
  if (now.getTime() >= Date.parse(session.closes_at)) {
    await must(db.from('tracking_sessions')
      .update({ status: 'closed', closed_reason: 'day-end', closed_at: now.toISOString() })
      .eq('id', session.id).eq('status', 'open'))
    await must(db.from('tracking_latest').update({ session_status: 'closed' }).eq('staff_id', session.staff_id).eq('date', session.date))
    throw sessionClosed()
  }
}

export { sessionClosed }

publicTrackingRoutes.post('/tracking/points', async (c) => {
  await rateLimit(`points:ip:${clientIp(c)}`, ...LIMITS.byIp)
  const session = await sessionFor(bearerToken(c))
  await rateLimit(`points:token:${session.token_hash.slice(0, 16)}`, ...LIMITS.byToken)

  const raw = await c.req.text()
  if (raw.length > MAX_BODY_BYTES) throw new ApiError(400, 'Send fewer points at a time.')
  let body: { points?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    throw new ApiError(400, 'The request could not be read.')
  }
  if (!Array.isArray(body?.points)) throw new ApiError(400, 'Send a list of points.')
  if (body.points.length > MAX_POINTS_PER_REQUEST) throw new ApiError(400, 'Send fewer points at a time.')

  const now = new Date()
  await assertSessionOpen(session, now)

  const [lastRows, counted] = await Promise.all([
    must(db.from('location_points').select('latitude, longitude, recorded_at').eq('session_id', session.id).order('recorded_at', { ascending: false }).limit(1)),
    db.from('location_points').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
  ])
  if (counted.error) throw new ApiError(500, 'Something went wrong on the server. Please try again.')
  const { keep, rejected, flags } = screenPoints({
    session,
    last: lastRows?.[0] ?? null,
    storedToday: counted.count ?? 0,
    points: body.points,
    now,
  }) as Screened

  if (keep.length) {
    const flagRows = (['mock', 'speed'] as const)
      .filter((kind) => flags[kind] > 0)
      .map((kind) => {
        const times = keep.filter((p) => p.flagged === kind).map((p) => p.recorded_at)
        return { kind, points: flags[kind], first_at: times[0], last_at: times[times.length - 1] }
      })
    const newest = keep[keep.length - 1]
    await rpc('record_points', {
      p_session: session.id,
      p_points: keep,
      p_flags: flagRows,
      p_latest: { latitude: newest.latitude, longitude: newest.longitude, accuracy: newest.accuracy, recorded_at: newest.recorded_at },
    })
  }

  // Backup for the nightly job: each person's first batch of the day closes any past day still waiting.
  if (!counted.count) later(closePastDays())

  return c.json({ accepted: body.points.length - rejected, rejected, sessionOpen: true })
})
