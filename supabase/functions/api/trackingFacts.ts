/**
 * The tracking facts behind each field employee's day: their shop list, the
 * day's summary (saved for past days, worked out live for today), whether the
 * trail was swept before it could be summarised, their recorded visits, and
 * the resulting shop-visit proof. The daily report and the visit alerts both
 * use this, so they always agree.
 */

import { accraDateKey } from '../_shared/rules/accraTime.js'
import { shopStays, summariseTrail, visitFromRow, visitProof } from '../_shared/rules/tracking.js'
import { allRows, db, found } from './lib.ts'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>
export type Shop = { shopId: string; shopName: string; latitude: number | null; longitude: number | null }
export type DaySummary = {
  points: number
  trackedMinutes: number
  coverage: number | null
  signalLost: number
  longestGapMinutes: number
  distanceM: number
  shopStays: Record<string, { minutes: number; longestMinutes: number; closestM: number | null }>
}

const key = (staffId: string, date: string) => `${staffId}|${date}`
export const asPoint = (p: Row) => ({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, at: p.recorded_at })

/** Each employee's listed shops, in order. */
export async function listsFor(staffIds: string[]) {
  const lists = new Map<string, string[]>()
  if (!staffIds.length) return lists
  const rows = await allRows('employee_shops', ['staff_id', 'position'], (q: Row) => q.in('staff_id', staffIds))
  rows.forEach((row: Row) => {
    const list = lists.get(row.staff_id) ?? []
    list.push(row.shop_id)
    lists.set(row.staff_id, list)
  })
  return lists
}

export async function shopsFor(ids: string[]): Promise<Map<string, Shop>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await found(db.from('shops').select('shop_id, shop_name, latitude, longitude').in('shop_id', unique))
  return new Map(rows.map((r: Row) => [r.shop_id, { shopId: r.shop_id, shopName: r.shop_name, latitude: r.latitude, longitude: r.longitude }]))
}

function fromSummaryRow(row: Row): DaySummary {
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

/** Today's summaries for these staff, worked out live from the trail. */
async function liveSummaries(staffIds: string[], date: string, now: Date, lists: Map<string, string[]>, shops: Map<string, Shop>) {
  const [sessions, points] = await Promise.all([
    found(db.from('tracking_sessions').select('id, staff_id, clock_in_at, clock_out_at, closes_at').in('staff_id', staffIds).eq('date', date)),
    allRows('location_points', ['recorded_at', 'id'], (q: Row) => q.in('staff_id', staffIds).eq('date', date)),
  ])
  const bySession = new Map<string, Row[]>()
  points.forEach((p: Row) => {
    const list = bySession.get(p.session_id) ?? []
    list.push(p)
    bySession.set(p.session_id, list)
  })
  const out = new Map<string, DaySummary>()
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

/**
 * The tracking side of each attendance record. Records need `employeeId`,
 * `date`, `category`, `clockIn`, `clockOut`, `isToday` and `expectedEnd`.
 * With `live: false`, today's summaries are not worked out from the trail
 * (cheaper; used where only visits outside the list are needed).
 */
export async function loadTrackingDays(records: Row[], now: Date, { live = true } = {}) {
  if (!records.length) return []
  const today = accraDateKey(now)
  const staffIds = [...new Set(records.map((r) => r.employeeId as string))]
  const dates = [...new Set(records.map((r) => r.date as string))]
  const pastDates = dates.filter((d) => d < today)

  const [lists, visitRows, savedRows, expiredRows] = await Promise.all([
    listsFor(staffIds),
    allRows('outlet_visits', ['occurred_at', 'id'], (q: Row) => q.in('staff_id', staffIds).in('date', dates)),
    pastDates.length
      ? allRows('tracking_day_summaries', ['staff_id', 'date'], (q: Row) => q.in('staff_id', staffIds).in('date', pastDates))
      : Promise.resolve([]),
    found(db.from('tracking_sessions').select('staff_id, date').in('staff_id', staffIds).in('date', dates).eq('trail_expired', true)),
  ])
  const shops = await shopsFor([...[...lists.values()].flat(), ...visitRows.map((v: Row) => v.shop_id)])
  const shopNames = new Map([...shops].map(([id, shop]) => [id, shop.shopName]))

  const summaries = new Map<string, DaySummary>()
  savedRows.forEach((row: Row) => summaries.set(key(row.staff_id, row.date), fromSummaryRow(row)))
  if (live && dates.includes(today)) {
    ;(await liveSummaries(staffIds, today, now, lists, shops)).forEach((s, staffId) => summaries.set(key(staffId, today), s))
  }
  const expired = new Set(expiredRows.map((row: Row) => key(row.staff_id, row.date)))
  const visits = new Map<string, ReturnType<typeof visitFromRow>[]>()
  visitRows.forEach((row: Row) => {
    const k = key(row.staff_id, row.date)
    const list = visits.get(k) ?? []
    list.push(visitFromRow(row))
    visits.set(k, list)
  })

  return records.map((record) => {
    const k = key(record.employeeId, record.date)
    const summary = record.clockIn ? summaries.get(k) ?? null : null
    // A swept trail is unknown, not missing: nothing is marked missed or no-signal.
    const unavailable = Boolean(record.clockIn) && !summary && expired.has(k)
    const dayOver = !unavailable && (!record.isToday || Boolean(record.clockOut) || now.getTime() >= Date.parse(record.expectedEnd))
    const dayVisits = visits.get(k) ?? []
    // No clock-in (rest day, leave, holiday, absence): there is no visit proof to give.
    const proof = record.category === 'merchandiser' || !record.clockIn
      ? null
      : visitProof({ listIds: lists.get(record.employeeId) ?? [], shopsById: shops, visits: dayVisits, stays: summary ? summary.shopStays : null, dayOver })
    return { record, summary, unavailable, dayOver, proof, visits: dayVisits, shopNames, clockedIn: Boolean(record.clockIn), tracked: Boolean(summary) }
  })
}
