/**
 * Live tracking rules, shared by the server and the tests. The trail summary,
 * shop stays and visit proof are the frontend's algorithms
 * (locationTrackingService.js, visitListService.js) so both give the same
 * numbers. Positions never leave the day: summaries keep minutes and metres only.
 */

import { accraIso } from './accraTime.js'
import { shiftWindowMinutes } from './records.js'

/** Keep a new point only if this long has passed or the phone moved this far. */
export const MIN_SECONDS = 20
export const MIN_METRES = 15
/** Cap per person per day, so a modified phone cannot flood the table. */
export const MAX_POINTS_PER_DAY = 2000
/** A live position older than this is "signal lost"; each point covers up to this long. */
export const LIVE_STALE_MINUTES = 5
/** Points less accurate than this are left out of the distance travelled. */
export const NOISY_ACCURACY_M = 100
/** Allowance for GPS error when deciding someone stayed at a shop. */
export const GPS_TOLERANCE_M = 100
/** A gap in points longer than this breaks a stay. */
export const STAY_GAP_MINUTES = 5
/** Minimum stay at a shop for a visit to count as proven. */
export const MIN_STAY_MINUTES = 10
/** How far ahead of the server clock a phone's time may be. */
export const MAX_FUTURE_MS = 120000
/** The oldest point accepted (a native app may send a queued batch). */
export const MAX_AGE_MS = 12 * 3600000
/** Faster than this between two points is flagged as impossible movement. */
export const MAX_SPEED_KMH = 200
/** Most points read from one request. */
export const MAX_POINTS_PER_REQUEST = 500

const GOOD = 0.9
const PARTIAL = 0.6

function validCoords(p) {
  if (!p) return false
  const lat = Number(p.latitude)
  const lng = Number(p.longitude)
  return p.latitude !== null && p.longitude !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/** Great-circle distance in metres, rounded, or null if either point is missing. */
export function distanceMetres(a, b) {
  if (!validCoords(a) || !validCoords(b)) return null
  const R = 6371000
  const rad = (d) => (Number(d) * Math.PI) / 180
  const dLat = rad(b.latitude) - rad(a.latitude)
  const dLng = rad(b.longitude) - rad(a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/**
 * Summary of one day's points between clock-in and clock-out: time tracked,
 * how much of it the phone was sending (each point covers up to
 * LIVE_STALE_MINUTES), how often and how long the signal was lost, and the
 * distance travelled. Points are { latitude, longitude, accuracy, at }.
 */
export function summariseTrail(points, startIso, endIso) {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  const stale = LIVE_STALE_MINUTES * 60000
  const valid = Number.isFinite(start) && Number.isFinite(end) && end > start
  const inDay = valid ? points.filter((p) => { const t = Date.parse(p.at); return t >= start - 60000 && t <= end + 60000 }) : points
  const base = {
    points: inDay.length,
    firstAt: inDay[0]?.at ?? null,
    lastAt: inDay[inDay.length - 1]?.at ?? null,
    trackedMinutes: valid ? Math.round((end - start) / 60000) : 0,
    coveredMinutes: 0,
    coverage: null,
    signalLost: 0,
    longestGapMinutes: 0,
    distanceM: 0,
  }
  if (!valid) return base
  if (!inDay.length) return { ...base, coverage: 0, signalLost: 1, longestGapMinutes: base.trackedMinutes }
  const times = inDay.map((p) => Math.min(end, Math.max(start, Date.parse(p.at))))
  let covered = 0
  let lost = 0
  let longest = 0
  const edges = [start, ...times, end]
  for (let i = 1; i < edges.length; i += 1) {
    const gap = edges[i] - edges[i - 1]
    if (i > 1) covered += Math.min(gap, stale) // time after a point counts as covered
    if (gap > stale) { lost += 1; longest = Math.max(longest, gap) }
  }
  let dist = 0
  for (let i = 1; i < inDay.length; i += 1) {
    const a = inDay[i - 1]
    const b = inDay[i]
    if ((a.accuracy ?? 0) <= NOISY_ACCURACY_M && (b.accuracy ?? 0) <= NOISY_ACCURACY_M) dist += distanceMetres(a, b) ?? 0
  }
  return {
    ...base,
    coveredMinutes: Math.round(covered / 60000),
    coverage: Math.min(1, covered / (end - start)),
    signalLost: lost,
    longestGapMinutes: Math.round(longest / 60000),
    distanceM: Math.round(dist),
  }
}

/**
 * How long the points show the person at each shop. A stay is a run of
 * consecutive points within GPS_TOLERANCE_M of the shop with no gap longer than
 * STAY_GAP_MINUTES; its length is first to last point.
 * @returns {{ [shopId]: { minutes, longestMinutes, closestM } }}
 */
export function shopStays(points, shops) {
  const out = {}
  shops.forEach((shop) => {
    if (!shop || shop.latitude == null || shop.longitude == null) return
    let total = 0
    let longest = 0
    let closest = null
    let runStart = null
    let runLast = null
    const close = () => {
      if (runStart != null) {
        const len = runLast - runStart
        total += len
        longest = Math.max(longest, len)
      }
      runStart = null
      runLast = null
    }
    points.forEach((p) => {
      const t = Date.parse(p.at)
      const d = distanceMetres(p, shop)
      if (d != null && (closest == null || d < closest)) closest = d
      if (d == null || d > GPS_TOLERANCE_M) { close(); return }
      if (runLast != null && t - runLast > STAY_GAP_MINUTES * 60000) close()
      if (runStart == null) runStart = t
      runLast = t
    })
    close()
    out[shop.shopId] = { minutes: Math.round(total / 60000), longestMinutes: Math.round(longest / 60000), closestM: closest }
  })
  return out
}

/**
 * The day's visits for one employee against their shop list.
 * @param {object} p
 * @param {string[]} p.listIds      shop IDs on the list
 * @param {Map} p.shopsById         shopId → { shopId, shopName, latitude, longitude }
 * @param {object[]} p.visits       the day's visits ({ outlet: { shopId }, time }); none until outlet visits exist
 * @param {object|null} p.stays     shopStays() result, or null without tracking
 * @param {boolean} p.dayOver       the working day has ended (missing visits become "missed")
 */
export function visitProof({ listIds, shopsById, visits, stays, dayOver }) {
  const listed = listIds.map((shopId) => {
    const shop = shopsById.get(shopId) ?? null
    const scans = visits.filter((v) => v.outlet?.shopId === shopId).sort((a, b) => String(a.time).localeCompare(String(b.time)))
    const stay = stays?.[shopId] ?? null
    const stayed = (stay?.longestMinutes ?? 0) >= MIN_STAY_MINUTES
    const measurable = shop?.latitude != null
    let status
    if (stayed) status = 'proven'
    else if (scans.length) status = measurable ? 'no-stay' : 'unmeasured'
    else status = dayOver ? 'missed' : 'pending'
    return {
      shopId,
      status,
      scans: scans.length,
      scanned: scans.length > 0,
      stayMinutes: stay ? stay.longestMinutes : null,
      closestM: stay?.closestM ?? null,
    }
  })
  const listSet = new Set(listIds)
  const offList = visits
    .filter((v) => !v.outlet?.shopId || !listSet.has(v.outlet.shopId))
    .map((v) => ({ visit: v, status: v.outlet?.shopId ? 'off-list' : 'not-in-list' }))
  const count = (s) => listed.filter((l) => l.status === s).length
  return {
    listed,
    offList,
    counts: {
      listed: listed.length,
      proven: count('proven'),
      visited: listed.filter((l) => l.scanned || l.status === 'proven').length,
      missed: count('missed'),
      flagged: count('no-stay') + count('missed') + offList.length,
    },
  }
}

/** The day's tracking result for the daily report. */
export function trackingResult({ clockIn, summary }) {
  if (!clockIn) return 'not-clocked-in'
  if (!summary || !summary.points) return 'no-signal'
  if (summary.coverage >= GOOD) return 'good'
  if (summary.coverage >= PARTIAL) return 'partial'
  return 'poor'
}

/**
 * Which of a phone's points to store. Rejects points outside the session
 * window (by server time) or malformed; thins like the phone (20 s or 15 m);
 * stops at MAX_POINTS_PER_DAY; flags fake locations and impossible speeds.
 * Thinned points count as accepted, as on the phone.
 * @returns {{ keep: object[], rejected: number, flags: { mock: number, speed: number } }}
 */
export function screenPoints({ session, last, storedToday, points, now }) {
  const nowMs = now.getTime()
  const startMs = Date.parse(session.clock_in_at)
  const endMs = session.clock_out_at ? Date.parse(session.clock_out_at) : Infinity
  const input = Array.isArray(points) ? points.slice(0, MAX_POINTS_PER_REQUEST) : []
  let rejected = 0
  const candidates = []
  for (const p of input) {
    const t = p && typeof p.recordedAt === 'string' ? Date.parse(p.recordedAt) : NaN
    const ok = validCoords(p) && Number.isFinite(t) && t >= startMs && t <= endMs && t <= nowMs + MAX_FUTURE_MS && t >= nowMs - MAX_AGE_MS
    if (!ok) { rejected += 1; continue }
    const accuracy = Number(p.accuracy)
    candidates.push({
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
      recorded_at: new Date(t).toISOString(),
      is_mock: p.isMock === true,
      flagged: null,
      ms: t,
    })
  }
  candidates.sort((a, b) => a.ms - b.ms)

  const keep = []
  const flags = { mock: 0, speed: 0 }
  let previous = last ? { latitude: Number(last.latitude), longitude: Number(last.longitude), ms: Date.parse(last.recorded_at) } : null
  for (const p of candidates) {
    if (previous) {
      const seconds = (p.ms - previous.ms) / 1000
      const metres = distanceMetres(previous, p) ?? 0
      if (seconds < MIN_SECONDS && metres < MIN_METRES) continue
      if (storedToday + keep.length >= MAX_POINTS_PER_DAY) { rejected += 1; continue }
      const kmh = (metres / 1000) / (Math.max(seconds, 1) / 3600)
      if (kmh > MAX_SPEED_KMH) p.flagged = 'speed'
    } else if (storedToday + keep.length >= MAX_POINTS_PER_DAY) {
      rejected += 1
      continue
    }
    if (p.is_mock) p.flagged = 'mock'
    if (p.flagged) flags[p.flagged] += 1
    const { ms, ...row } = p
    keep.push(row)
    previous = { latitude: p.latitude, longitude: p.longitude, ms }
  }
  return { keep, rejected, flags }
}

/** When a session with no clock-out closes: the working day's end plus the clock-out window. */
export function sessionClosesAt(dateKey, hours, rules) {
  const { end } = shiftWindowMinutes(hours)
  return new Date(Date.parse(accraIso(dateKey, end)) + Number(rules.clockOutWindowMinutes) * 60000).toISOString()
}
