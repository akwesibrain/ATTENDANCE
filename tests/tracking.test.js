import { describe, expect, it } from 'vitest'
import {
  MAX_POINTS_PER_DAY,
  screenPoints,
  sessionClosesAt,
  shopStays,
  summariseTrail,
  trackingResult,
  visitProof,
} from '../supabase/functions/_shared/rules/tracking.js'

const BASE = Date.parse('2026-11-12T09:00:00Z')
const LAT = 5.6
const LNG = -0.18
const METRES_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180)
const iso = (minute) => new Date(BASE + minute * 60000).toISOString()

/** A point near the test shop, moved `metresEast` east, at 09:00 + `minute`. */
function pt(minute, metresEast = 0, extra = {}) {
  return { latitude: LAT, longitude: LNG + metresEast / METRES_PER_DEG_LNG, accuracy: 10, at: iso(minute), ...extra }
}

const SHOP = { shopId: 's1', latitude: LAT, longitude: LNG }

describe('summariseTrail (tracker spec §8)', () => {
  it('a 60-minute day with points for the first 30 minutes', () => {
    const points = Array.from({ length: 31 }, (_, m) => pt(m))
    const s = summariseTrail(points, iso(0), iso(60))
    expect(s.coveredMinutes).toBe(35)
    expect(s.coverage).toBeCloseTo(0.583, 2)
    expect(s.signalLost).toBe(1)
    expect(s.longestGapMinutes).toBe(30)
    expect(s.trackedMinutes).toBe(60)
  })

  it('clocked in with no points', () => {
    const s = summariseTrail([], iso(0), iso(60))
    expect(s.coverage).toBe(0)
    expect(s.signalLost).toBe(1)
    expect(s.longestGapMinutes).toBe(60)
  })

  it('leaves a point with 500 m accuracy out of the distance', () => {
    expect(summariseTrail([pt(1), pt(2, 1000)], iso(0), iso(60)).distanceM).toBeGreaterThan(990)
    expect(summariseTrail([pt(1), pt(2, 1000, { accuracy: 500 })], iso(0), iso(60)).distanceM).toBe(0)
  })
})

describe('shopStays (tracker spec §6 and §8)', () => {
  it('points every 3 minutes from 09:00 to 09:12 within 100 m make a 12-minute stay', () => {
    const points = [0, 3, 6, 9, 12].map((m) => pt(m, 20))
    expect(shopStays(points, [SHOP]).s1.longestMinutes).toBe(12)
  })

  it('an 11-minute gap breaks the stay', () => {
    const points = [0, 4, 15, 19].map((m) => pt(m, 20))
    expect(shopStays(points, [SHOP]).s1.longestMinutes).toBe(4)
  })

  it('records the closest distance in metres', () => {
    expect(shopStays([pt(0, 2000)], [SHOP]).s1.closestM).toBeGreaterThan(1990)
  })
})

describe('visitProof', () => {
  const shopsById = new Map([['s1', SHOP]])
  it('a 12-minute stay proves the listed shop', () => {
    const proof = visitProof({ listIds: ['s1'], shopsById, visits: [], stays: { s1: { minutes: 12, longestMinutes: 12, closestM: 20 } }, dayOver: false })
    expect(proof.listed[0].status).toBe('proven')
    expect(proof.counts.proven).toBe(1)
  })
  it('a short stay is pending during the day and missed after it', () => {
    const stays = { s1: { minutes: 4, longestMinutes: 4, closestM: 20 } }
    expect(visitProof({ listIds: ['s1'], shopsById, visits: [], stays, dayOver: false }).listed[0].status).toBe('pending')
    expect(visitProof({ listIds: ['s1'], shopsById, visits: [], stays, dayOver: true }).listed[0].status).toBe('missed')
  })
})

describe('trackingResult', () => {
  it('grades coverage', () => {
    expect(trackingResult({ clockIn: 'x', summary: { points: 10, coverage: 0.95 } })).toBe('good')
    expect(trackingResult({ clockIn: 'x', summary: { points: 10, coverage: 0.7 } })).toBe('partial')
    expect(trackingResult({ clockIn: 'x', summary: { points: 10, coverage: 0.3 } })).toBe('poor')
    expect(trackingResult({ clockIn: 'x', summary: { points: 0, coverage: 0 } })).toBe('no-signal')
    expect(trackingResult({ clockIn: null, summary: null })).toBe('not-clocked-in')
  })
})

describe('screenPoints (tracker spec §4.1 and §8)', () => {
  const closed = { clock_in_at: '2026-11-12T08:00:00Z', clock_out_at: '2026-11-12T17:00:00Z' }
  const open = { clock_in_at: '2026-11-12T08:00:00Z', clock_out_at: null }
  const at = (time, extra = {}) => ({ latitude: LAT, longitude: LNG, accuracy: 10, recordedAt: `2026-11-12T${time}Z`, ...extra })
  const run = (session, points, { now = '2026-11-12T17:05:00Z', last = null, storedToday = 0 } = {}) =>
    screenPoints({ session, last, storedToday, points, now: new Date(now) })

  it('keeps a point 1 second before clock-out and rejects one 1 second after', () => {
    expect(run(closed, [at('16:59:59')]).keep).toHaveLength(1)
    const late = run(closed, [at('17:00:01')])
    expect(late.keep).toHaveLength(0)
    expect(late.rejected).toBe(1)
  })

  it('rejects a point before clock-in', () => {
    expect(run(closed, [at('07:59:59')]).rejected).toBe(1)
  })

  it('allows 2 minutes in the future and 12 hours in the past, no more', () => {
    const noon = { now: '2026-11-12T12:00:00Z' }
    expect(run(open, [at('12:02:00')], noon).keep).toHaveLength(1)
    expect(run(open, [at('12:02:01')], noon).rejected).toBe(1)
    const early = { clock_in_at: '2026-11-11T00:00:00Z', clock_out_at: null }
    expect(run(early, [{ ...at('00:00:00'), recordedAt: '2026-11-11T23:59:00Z' }], { now: '2026-11-12T12:00:00Z' }).rejected).toBe(1)
  })

  it('rejects malformed points', () => {
    expect(run(closed, [at('10:00:00', { latitude: 'x' }), at('10:01:00', { latitude: 95 }), null, at('10:02:00', { recordedAt: 'soon' })]).rejected).toBe(4)
  })

  it('thins points closer than 20 s and 15 m, counting them as accepted', () => {
    const r = run(closed, [at('10:00:00'), at('10:00:05', { longitude: LNG + 3 / METRES_PER_DEG_LNG })])
    expect(r.keep).toHaveLength(1)
    expect(r.rejected).toBe(0)
  })

  it('thins against the last stored point too', () => {
    const last = { latitude: LAT, longitude: LNG, recorded_at: '2026-11-12T10:00:00Z' }
    expect(run(closed, [at('10:00:10')], { last }).keep).toHaveLength(0)
  })

  it('stops at 2,000 points a day', () => {
    const r = run(closed, [at('10:00:00'), at('10:05:00', { latitude: LAT + 0.01 })], { storedToday: MAX_POINTS_PER_DAY - 1 })
    expect(r.keep).toHaveLength(1)
    expect(r.rejected).toBe(1)
  })

  it('flags a fake location without dropping it', () => {
    const r = run(closed, [at('10:00:00', { isMock: true })])
    expect(r.keep[0].flagged).toBe('mock')
    expect(r.keep[0].is_mock).toBe(true)
    expect(r.flags.mock).toBe(1)
  })

  it('flags a jump faster than 200 km/h', () => {
    const r = run(closed, [at('10:00:00'), at('10:00:10', { longitude: LNG + 1000 / METRES_PER_DEG_LNG })])
    expect(r.keep).toHaveLength(2)
    expect(r.keep[1].flagged).toBe('speed')
    expect(r.flags.speed).toBe(1)
  })

  it('never divides by zero for two points at the same moment', () => {
    const r = run(closed, [at('10:00:00'), at('10:00:00', { longitude: LNG + 1000 / METRES_PER_DEG_LNG })])
    // The gap counts as at least 1 s, so 1 km "at once" is flagged rather than Infinity km/h.
    expect(r.keep).toHaveLength(2)
    expect(r.keep[1].flagged).toBe('speed')
    expect(r.rejected).toBe(0)
  })

  it('sorts points by the time they were recorded', () => {
    const r = run(closed, [at('10:10:00'), at('10:00:00', { latitude: LAT + 0.01 })])
    expect(r.keep.map((p) => p.recorded_at)).toEqual(['2026-11-12T10:00:00.000Z', '2026-11-12T10:10:00.000Z'])
  })
})

describe('sessionClosesAt', () => {
  it('is the end of the working day plus the clock-out window', () => {
    expect(sessionClosesAt('2026-11-12', { startTime: '08:00', endTime: '17:00' }, { clockOutWindowMinutes: 360 })).toBe('2026-11-12T23:00:00.000Z')
  })
  it('handles an overnight shift', () => {
    expect(sessionClosesAt('2026-11-12', { startTime: '22:00', endTime: '06:00' }, { clockOutWindowMinutes: 60 })).toBe('2026-11-13T07:00:00.000Z')
  })
})
