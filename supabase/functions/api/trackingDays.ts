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
import { LIVE_STALE_MINUTES, outletLabel, shopStays, summariseTrail, trackingResult, visitFromRow } from '../_shared/rules/tracking.js'
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
 * Live map snapshot
 * ------------------------------------------------------------------------ */

function dutyText(r: Row) {
  if (r.status === 'on-leave') return 'On leave'
  if (r.atWork) return 'On duty'
  if (r.clockOut) return 'Clocked out — tracking stopped'
  if (r.status === 'absent') return 'Marked absent'
  if (r.status === 'incomplete') return 'No clock-out'
  if (!r.workday) return 'Not scheduled'
  return 'Not clocked in'
}

hrTrackingRoutes.get('/tracking/live', async (c) => {
  const companyId = c.req.query('companyId') ?? ''
  if (!companyId) throw invalid({ companyId: 'Choose a company.' })
  assertCompany(c, companyId)

  const now = new Date()
  const today = accraDateKey(now)
  const { roster, ctx, shopsById } = await loadFacts({ from: today, to: today, now })
  const fieldRoster = roster
    .filter((e: Row) => e.companyId === companyId)
    .map((e: Row) => ({ ...e, category: categoryForPosition(e.position) }))
    .filter((e: Row) => TRACKED_CATEGORIES.includes(e.category))

  const staffIds = fieldRoster.map((e: Row) => e.employeeId)
  const [lists, latestRows, sessionRows, visitRows] = staffIds.length
    ? await Promise.all([
        listsFor(staffIds),
        found(db.from('tracking_latest').select('*').in('staff_id', staffIds).eq('date', today)),
        found(db.from('tracking_sessions').select('staff_id, status, clock_out_at, closes_at').in('staff_id', staffIds).eq('date', today)),
        allRows('outlet_visits', ['occurred_at', 'id'], (q: Row) => q.in('staff_id', staffIds).eq('date', today)),
      ])
    : [new Map<string, string[]>(), [], [], []]

  const latestById = new Map(latestRows.map((row: Row) => [row.staff_id, row]))
  const sessionById = new Map(sessionRows.map((row: Row) => [row.staff_id, row]))
  const visitsById = new Map<string, ReturnType<typeof visitFromRow>[]>()
  visitRows.forEach((row: Row) => {
    const list = visitsById.get(row.staff_id) ?? []
    list.push(visitFromRow(row))
    visitsById.set(row.staff_id, list)
  })

  const records = buildRecords(fieldRoster, [today], ctx)
  const people = records.map((r: Row) => {
    const category = categoryForPosition(r.position)
    const isMerch = category === 'merchandiser'
    const listIds = lists.get(r.employeeId) ?? (r.shop ? [r.shop.shopId] : [])
    const shops = listIds.map((id: string) => shopsById.get(id)).filter(Boolean)
    const visits = visitsById.get(r.employeeId) ?? []
    const latestVisit = visits[visits.length - 1] ?? null
    const session = sessionById.get(r.employeeId) ?? null
    const live = latestById.get(r.employeeId) ?? null

    // Fallback before first live ping: latest visited mapped outlet (Sales Rep / Supervisor)
    // or primary allocated shop (Merchandiser). Never invented.
    let fallback: Row | null = null
    if (!isMerch) {
      for (let i = visits.length - 1; i >= 0; i -= 1) {
        const v = visits[i]
        const sh = v.outlet?.shopId ? shopsById.get(v.outlet.shopId) : null
        if (sh && sh.latitude != null) {
          fallback = { latitude: sh.latitude, longitude: sh.longitude, accuracy: null, source: 'outlet', at: v.time, place: sh.shopName }
          break
        }
      }
    } else if (shops[0] && shops[0].latitude != null) {
      fallback = { latitude: shops[0].latitude, longitude: shops[0].longitude, accuracy: null, source: 'shop', at: null, place: shops[0].shopName }
    }

    const clockedOut = Boolean(r.clockOut) || session?.status === 'closed' || (session?.closes_at && Date.parse(session.closes_at) <= now.getTime())
    if (!r.clockIn || clockedOut) {
      return {
        employeeId: r.employeeId,
        fullName: r.fullName,
        category,
        duty: clockedOut && r.clockIn ? 'Clocked out — tracking stopped' : dutyText(r),
        onDuty: false,
        visitsToday: isMerch ? null : visits.length,
        lastEvent: latestVisit ? `Visit at ${outletLabel(latestVisit.outlet, shopsById)}` : null,
        lastEventAt: r.clockOut ?? latestVisit?.time ?? r.clockIn ?? null,
        shops,
        position: null,
      }
    }

    if (!live || live.session_status !== 'open') {
      return {
        employeeId: r.employeeId,
        fullName: r.fullName,
        category,
        duty: 'Clocked in — no live location yet',
        onDuty: true,
        visitsToday: isMerch ? null : visits.length,
        lastEvent: latestVisit
          ? `Visit at ${outletLabel(latestVisit.outlet, shopsById)}`
          : 'Phone has not sent a location (mobile data, Location or the page may be off)',
        lastEventAt: latestVisit?.time ?? r.clockIn ?? null,
        shops,
        position: fallback,
      }
    }

    const mins = Math.max(0, Math.round((now.getTime() - Date.parse(live.recorded_at)) / 60000))
    const lost = mins > LIVE_STALE_MINUTES
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category,
      duty: lost ? `Clocked in — signal lost ${mins} min ago` : 'Clocked in — live',
      onDuty: true,
      visitsToday: isMerch ? null : visits.length,
      lastEvent: lost
        ? 'No location for a while (mobile data or Location may be off, or the page closed)'
        : (latestVisit ? `Visit at ${outletLabel(latestVisit.outlet, shopsById)}` : 'Live location'),
      lastEventAt: live.recorded_at,
      shops,
      position: {
        latitude: live.latitude,
        longitude: live.longitude,
        accuracy: live.accuracy,
        source: 'live',
        at: live.recorded_at,
        place: null,
      },
    }
  }).sort((a: Row, b: Row) => a.fullName.localeCompare(b.fullName))

  const counts: Record<string, { total: number; placed: number; onDuty: number }> = {
    supervisor: { total: 0, placed: 0, onDuty: 0 },
    'sales-rep': { total: 0, placed: 0, onDuty: 0 },
    merchandiser: { total: 0, placed: 0, onDuty: 0 },
  }
  people.forEach((p: Row) => {
    const bucket = counts[p.category]
    if (!bucket) return
    bucket.total += 1
    if (p.position) bucket.placed += 1
    if (p.onDuty) bucket.onDuty += 1
  })

  return c.json({ asOf: now.toISOString(), people, counts })
})

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
    const smsEvents = r.smsEvents ?? []
    return {
      employeeId: r.employeeId,
      fullName: r.fullName,
      category: r.category,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      stillClockedIn: Boolean(r.clockIn && !r.clockOut && r.isToday),
      visits: isMerch ? null : visits.length,
      visitRecords: isMerch ? [] : visits,
      trackedMinutes: s?.trackedMinutes ?? null,
      coverage: s?.coverage ?? null,
      signalLost: s ? s.signalLost : null,
      longestGapMinutes: s ? s.longestGapMinutes : null,
      distanceKm: s ? Math.round(s.distanceM / 100) / 10 : null,
      points: s?.points ?? null,
      shops: proof ? { listed: proof.counts.listed, proven: proof.counts.proven, flagged: proof.counts.flagged, missed: proof.counts.missed } : null,
      proof: proof ? {
        listed: proof.listed.map((l: Row) => ({
          shopId: l.shopId,
          shopName: l.shop?.shopName ?? l.shopId,
          hasMapLocation: l.shop?.latitude != null,
          status: l.status,
          scans: l.scans,
          first: l.first ? { id: l.first.id, time: l.first.time } : null,
          visitDistance: l.visitDistance ?? null,
          stayMinutes: l.stayMinutes ?? null,
          closestM: l.closestM ?? null,
        })),
        offList: proof.offList,
        counts: proof.counts,
      } : null,
      sms: {
        sent: smsEvents.length,
        verified: smsEvents.filter((e: Row) => e.result === 'verified').length,
        missed: smsEvents.filter((e: Row) => e.result === 'missed').length,
        failed: smsEvents.filter((e: Row) => ['failed-face', 'outside-shop', 'sms-failed'].includes(e.result)).length,
      },
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
