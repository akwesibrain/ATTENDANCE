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
import { shopStays, summariseTrail, trackingResult, visitProof } from '../_shared/rules/tracking.js'
import { assertCompany, type HrEnv } from './auth.ts'
import { allRows, loadFacts } from './facts.ts'
import { applyChange, db, found, invalid, must } from './lib.ts'

export const hrTrackingRoutes = new Hono<HrEnv>()

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>
type Shop = { shopId: string; latitude: number | null; longitude: number | null }

const asPoint = (p: Row) => ({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, at: p.recorded_at })

/** Each employee's listed shops, in order, for the given staff. */
async function listsFor(staffIds: string[]) {
  const lists = new Map<string, string[]>()
  if (!staffIds.length) return lists
  const rows = await allRows('employee_shops', 'position', (q: Row) => q.in('staff_id', staffIds))
  rows.forEach((row: Row) => lists.set(row.staff_id, [...(lists.get(row.staff_id) ?? []), row.shop_id]))
  return lists
}

async function shopsFor(ids: string[]): Promise<Map<string, Shop>> {
  if (!ids.length) return new Map()
  const rows = await found(db.from('shops').select('shop_id, shop_name, latitude, longitude').in('shop_id', [...new Set(ids)]))
  return new Map(rows.map((r: Row) => [r.shop_id, { shopId: r.shop_id, shopName: r.shop_name, latitude: r.latitude, longitude: r.longitude }]))
}

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

  const [sessions, summarised] = await Promise.all([
    found(db.from('tracking_sessions').select('*').eq('date', date).eq('status', 'closed')),
    found(db.from('tracking_day_summaries').select('staff_id').eq('date', date)),
  ])
  const done = new Set(summarised.map((s: Row) => s.staff_id))
  const lists = await listsFor(sessions.map((s: Row) => s.staff_id))
  const shops = await shopsFor([...lists.values()].flat())

  let count = 0
  for (const session of sessions) {
    const points = await allRows('location_points', 'recorded_at', (q: Row) => q.eq('session_id', session.id))
    if (done.has(session.staff_id) && !points.length) continue
    const flags = await found(db.from('tracking_flags').select('kind, points').eq('staff_id', session.staff_id).eq('date', date))
    const trail = points.map(asPoint)
    const end = session.clock_out_at ?? points[points.length - 1]?.recorded_at ?? session.clock_in_at
    const s = summariseTrail(trail, session.clock_in_at, end)
    const listShops = (lists.get(session.staff_id) ?? []).map((id) => shops.get(id)).filter(Boolean)
    await applyChange([
      {
        table: 'tracking_day_summaries',
        op: 'upsert',
        conflict: ['staff_id', 'date'],
        row: {
          staff_id: session.staff_id,
          company_id: session.company_id,
          date,
          clock_in: session.clock_in_at,
          clock_out: session.clock_out_at,
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
      },
      { table: 'location_points', op: 'delete', match: { session_id: session.id } },
    ])
    count += 1
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

function fromSummaryRow(row: Row) {
  return {
    points: row.points,
    trackedMinutes: row.tracked_minutes,
    coverage: row.coverage,
    signalLost: row.signal_lost,
    longestGapMinutes: row.longest_gap_minutes,
    distanceM: row.distance_m,
    shopStays: row.shop_stays ?? {},
  }
}

/** Today's summaries, worked out live from the trail. */
async function liveSummaries(companyId: string, date: string, now: Date, lists: Map<string, string[]>, shops: Map<string, Shop>) {
  const [sessions, points] = await Promise.all([
    found(db.from('tracking_sessions').select('id, staff_id, clock_in_at, clock_out_at, closes_at').eq('company_id', companyId).eq('date', date)),
    allRows('location_points', 'recorded_at', (q: Row) => q.eq('company_id', companyId).eq('date', date)),
  ])
  const bySession = new Map<string, Row[]>()
  points.forEach((p: Row) => bySession.set(p.session_id, [...(bySession.get(p.session_id) ?? []), p]))
  const out = new Map<string, ReturnType<typeof fromSummaryRow>>()
  sessions.forEach((session: Row) => {
    const trail = (bySession.get(session.id) ?? []).map(asPoint)
    const endMs = session.clock_out_at ? Date.parse(session.clock_out_at) : Math.min(now.getTime(), Date.parse(session.closes_at))
    const end = new Date(Math.max(endMs, Date.parse(session.clock_in_at))).toISOString()
    const s = summariseTrail(trail, session.clock_in_at, end)
    const listShops = (lists.get(session.staff_id) ?? []).map((id) => shops.get(id)).filter(Boolean)
    out.set(session.staff_id, { ...s, shopStays: shopStays(trail, listShops) })
  })
  return out
}

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
  const lists = await listsFor(records.map((r: Row) => r.employeeId))
  const shops = await shopsFor([...lists.values()].flat())

  const summaries = date === today
    ? await liveSummaries(companyId, date, now, lists, shops)
    : new Map((await found(db.from('tracking_day_summaries').select('*').eq('company_id', companyId).eq('date', date)))
      .map((row: Row) => [row.staff_id, fromSummaryRow(row)]))

  const rows = records.map((r: Row) => {
    const s = r.clockIn ? summaries.get(r.employeeId) ?? null : null
    const isMerch = r.category === 'merchandiser'
    const dayOver = !r.isToday || Boolean(r.clockOut) || now.getTime() >= Date.parse(r.expectedEnd)
    const proof = isMerch
      ? null
      : visitProof({ listIds: lists.get(r.employeeId) ?? [], shopsById: shops, visits: [], stays: s ? s.shopStays : null, dayOver })
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category: r.category,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      stillClockedIn: Boolean(r.clockIn && !r.clockOut && r.isToday),
      visits: isMerch ? null : 0,
      trackedMinutes: s?.trackedMinutes ?? null,
      coverage: s?.coverage ?? null,
      signalLost: s ? s.signalLost : null,
      longestGapMinutes: s ? s.longestGapMinutes : null,
      distanceKm: s ? Math.round(s.distanceM / 100) / 10 : null,
      points: s?.points ?? null,
      shops: proof ? { listed: proof.counts.listed, proven: proof.counts.proven, flagged: proof.counts.flagged, missed: proof.counts.missed } : null,
      result: trackingResult({ clockIn: r.clockIn, summary: s }),
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
