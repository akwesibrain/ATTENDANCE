/**
 * End of the tracking day and the daily report.
 *
 * closeDay summarises each person's trail for a date (time tracked, coverage,
 * distance, stays at their listed shops), saves the summary without any
 * coordinates, then deletes the points. It runs nightly (jobs), and as a
 * backup whenever a past day is asked for or a new day's first point arrives.
 * A database-only sweep removes any trail left after 48 hours regardless.
 */

import { Hono } from 'npm:hono@4.6.14'
import { accraDateKey } from '../_shared/rules/accraTime.js'
import { categoryForPosition, TRACKED_CATEGORIES } from '../_shared/rules/categories.js'
import { buildRecords } from '../_shared/rules/records.js'
import { isDateKey } from '../_shared/rules/tenure.js'
import { shopStays, summariseTrail, trackingResult } from '../_shared/rules/tracking.js'
import { assertCompany, type HrEnv } from './auth.ts'
import { loadFacts } from './facts.ts'
import { asPoint, listsFor, loadTrackingDays, shopsFor } from './trackingFacts.ts'
import { allRows, db, found, invalid, must, rpc } from './lib.ts'

export const hrTrackingRoutes = new Hono<HrEnv>()

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>
/**
 * Summarise and delete a date's trails. Sessions still open before their
 * closing time (an overnight shift) are left alone.
 */
export async function closeDay(date: string, now = new Date()) {
  const nowIso = now.toISOString()
  const closedNow = await found(
    db.from('tracking_sessions')
      .update({ status: 'closed', closed_reason: 'day-end', closed_at: nowIso })
      .eq('date', date).eq('status', 'open').lte('closes_at', nowIso)
      .select('staff_id'),
  )
  if (closedNow.length) {
    await must(db.from('tracking_latest').update({ session_status: 'closed' }).eq('date', date).in('staff_id', closedNow.map((s: Row) => s.staff_id)))
  }

  // Sessions not yet summarised. Each is saved under a lock by
  // save_session_summary, so a second run at the same moment changes nothing.
  const sessions = await found(
    db.from('tracking_sessions').select('*').eq('date', date).eq('status', 'closed').is('summarised_at', null).eq('trail_expired', false),
  )
  const lists = await listsFor(sessions.map((s: Row) => s.staff_id))
  const shops = await shopsFor([...lists.values()].flat())

  let count = 0
  for (const session of sessions) {
    const points = await allRows('location_points', 'recorded_at', (q: Row) => q.eq('session_id', session.id))
    const flags = await found(db.from('tracking_flags').select('kind, points').eq('staff_id', session.staff_id).eq('date', date))
    const trail = points.map(asPoint)
    const end = session.clock_out_at ?? points[points.length - 1]?.recorded_at ?? session.clock_in_at
    const s = summariseTrail(trail, session.clock_in_at, end)
    const listShops = (lists.get(session.staff_id) ?? []).map((id) => shops.get(id)).filter(Boolean)
    const saved = await rpc<boolean>('save_session_summary', {
      p_session: session.id,
      p_points: points.length,
      p_summary: {
        tracked_minutes: s.trackedMinutes,
        points: s.points,
        first_at: s.firstAt,
        last_at: s.lastAt,
        covered_minutes: s.coveredMinutes,
        coverage: s.coverage,
        signal_lost: s.signalLost,
        longest_gap_minutes: s.longestGapMinutes,
        distance_m: s.distanceM,
        shop_stays: shopStays(trail, listShops),
        mock_points: flags.find((f: Row) => f.kind === 'mock')?.points ?? 0,
        speed_points: flags.find((f: Row) => f.kind === 'speed')?.points ?? 0,
      },
    })
    if (saved) count += 1
  }
  await must(db.from('tracking_latest').delete().lt('date', accraDateKey(now)))
  return { closed: closedNow.length, summarised: count }
}

/** Close every day before today that still has a trail or an open session. */
export async function closePastDays(today = accraDateKey()) {
  const [withPoints, open] = await Promise.all([
    found(db.from('location_points').select('date').lt('date', today).order('date').limit(1000)),
    found(db.from('tracking_sessions').select('date').lt('date', today).eq('status', 'open').limit(1000)),
  ])
  const dates = [...new Set([...withPoints, ...open].map((row: Row) => row.date))].sort()
  for (const date of dates) await closeDay(date)
  return dates.length
}

/* --------------------------------------------------------------------------
 * Daily report
 * ------------------------------------------------------------------------ */

hrTrackingRoutes.get('/tracking/reports/daily', async (c) => {
  const companyId = c.req.query('companyId') ?? ''
  const date = c.req.query('date') ?? ''
  const role = c.req.query('role') ?? ''
  const now = new Date()
  const today = accraDateKey(now)
  if (!companyId) throw invalid({ companyId: 'Choose a company.' })
  assertCompany(c, companyId)
  if (!isDateKey(date) || date > today) throw invalid({ date: 'Choose a date up to today.' })
  if (role && !TRACKED_CATEGORIES.includes(role)) throw invalid({ role: 'Choose Supervisors, Sales Reps or Merchandisers.' })

  if (date < today) {
    await closePastDays(today)
    await closeDay(date, now)
  }

  const { roster, ctx } = await loadFacts({ from: date, to: date, now })
  const records = buildRecords(roster.filter((e: Row) => e.companyId === companyId), [date], ctx)
    .map((r: Row) => ({ ...r, category: categoryForPosition(r.position) }))
    .filter((r: Row) => TRACKED_CATEGORIES.includes(r.category) && (!role || r.category === role))
  const days = await loadTrackingDays(records, now)

  const rows = days.map(({ record: r, summary: s, unavailable, proof, visits }) => {
    const isMerch = r.category === 'merchandiser'
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category: r.category,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      stillClockedIn: Boolean(r.clockIn && !r.clockOut && r.isToday),
      visits: isMerch ? null : visits.length,
      trackedMinutes: s?.trackedMinutes ?? null,
      coverage: s?.coverage ?? null,
      signalLost: s ? s.signalLost : null,
      longestGapMinutes: s ? s.longestGapMinutes : null,
      distanceKm: s ? Math.round(s.distanceM / 100) / 10 : null,
      points: s?.points ?? null,
      shops: proof ? { listed: proof.counts.listed, proven: proof.counts.proven, flagged: proof.counts.flagged, missed: proof.counts.missed } : null,
      result: unavailable ? 'unavailable' : trackingResult({ clockIn: r.clockIn, summary: s }),
    }
  }).sort((a: Row, b: Row) => a.fullName.localeCompare(b.fullName))

  const tracked = rows.filter((r: Row) => r.coverage != null)
  return c.json({
    dateKey: date,
    rows,
    totals: {
      staff: rows.length,
      clockedIn: rows.filter((r: Row) => r.clockIn).length,
      tracked: tracked.length,
      averageCoverage: tracked.length ? tracked.reduce((n: number, r: Row) => n + r.coverage, 0) / tracked.length : null,
      distanceKm: Math.round(tracked.reduce((n: number, r: Row) => n + (r.distanceKm ?? 0), 0) * 10) / 10,
      noSignal: rows.filter((r: Row) => r.result === 'no-signal' || r.result === 'poor').length,
    },
  })
})
