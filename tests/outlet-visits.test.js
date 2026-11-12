import { describe, expect, it } from 'vitest'
import {
  parseVisitLocation,
  parseVisitOutlet,
  visitFromRow,
  visitProof,
  visitRow,
} from '../supabase/functions/_shared/rules/tracking.js'

const LAT = 5.6
const LNG = -0.18
const east = (m) => LNG + m / (111320 * Math.cos((LAT * Math.PI) / 180))
const session = { id: 'sess-1', staff_id: 'BFL-0007', company_id: 'box-for-less', date: '2026-11-12' }
const now = new Date('2026-11-12T10:00:00Z')
const s1 = { shopId: 's1', shopName: 'Shop 1', latitude: LAT, longitude: LNG }

describe('parseVisitOutlet', () => {
  it('takes a shop from the directory', () => {
    expect(parseVisitOutlet({ shopId: ' s1 ' })).toEqual({ shopId: 's1' })
  })
  it('takes a typed-in outlet, tidied', () => {
    expect(parseVisitOutlet({ outlet: { name: '  Mama  Shop ', town: 'Osu' } })).toEqual({ name: 'Mama Shop', town: 'Osu' })
  })
  it('explains what is missing', () => {
    expect(parseVisitOutlet({})).toEqual({ error: 'Choose the outlet you are visiting.' })
    expect(parseVisitOutlet({ outlet: { name: 'M', town: 'Osu' } })).toEqual({ error: 'Enter the outlet name.' })
    expect(parseVisitOutlet({ outlet: { name: 'Mama Shop', town: '' } })).toEqual({ error: 'Enter the town or area.' })
  })
})

describe('parseVisitLocation', () => {
  it('accepts a valid location', () => {
    expect(parseVisitLocation({ location: { latitude: 5.6, longitude: -0.18, accuracy: 12 } })).toEqual({ latitude: 5.6, longitude: -0.18, accuracy: 12 })
  })
  it('treats a missing or bad location as unavailable', () => {
    expect(parseVisitLocation({ location: null })).toBeNull()
    expect(parseVisitLocation({})).toBeNull()
    expect(parseVisitLocation({ location: { latitude: 95, longitude: 0 } })).toBeNull()
    expect(parseVisitLocation({ location: { latitude: '5.6', longitude: -0.18 } })).toBeNull()
  })
})

describe('visitRow', () => {
  const base = { session, listIds: ['s1'], score: 0.31, now }

  it('stores the distance from the shop and never the coordinates', () => {
    const row = visitRow({ ...base, outlet: { shopId: 's1' }, shop: s1, location: { latitude: LAT, longitude: east(40), accuracy: 9 } })
    expect(row.distance_m).toBeGreaterThanOrEqual(39)
    expect(row.distance_m).toBeLessThanOrEqual(41)
    expect(row.status).toBe('recorded')
    expect(row.on_list).toBe(true)
    expect(row.gps_accuracy).toBe(9)
    expect(Object.keys(row).some((k) => /lat|lng|long/i.test(k))).toBe(false)
    expect(row).toMatchObject({ staff_id: 'BFL-0007', company_id: 'box-for-less', session_id: 'sess-1', date: '2026-11-12', shop_id: 's1', outlet_name: null, face_score: 0.31 })
  })

  it('records a visit without a location as location-unavailable', () => {
    const row = visitRow({ ...base, outlet: { shopId: 's1' }, shop: s1, location: null })
    expect(row.status).toBe('location-unavailable')
    expect(row.distance_m).toBeNull()
  })

  it('stores a typed-in outlet as not on the list', () => {
    const row = visitRow({ ...base, outlet: { name: 'Mama Shop', town: 'Osu' }, shop: null, location: { latitude: LAT, longitude: LNG, accuracy: 5 } })
    expect(row).toMatchObject({ shop_id: null, outlet_name: 'Mama Shop', outlet_town: 'Osu', on_list: false, distance_m: null, status: 'recorded' })
  })

  it('has no distance when the shop has no map location', () => {
    const row = visitRow({ ...base, outlet: { shopId: 's2' }, shop: { shopId: 's2', latitude: null, longitude: null }, location: { latitude: LAT, longitude: LNG, accuracy: 5 } })
    expect(row.distance_m).toBeNull()
    expect(row.status).toBe('recorded')
    expect(row.on_list).toBe(false)
  })
})

describe('visitProof with recorded visits', () => {
  const shopsById = new Map([['s1', s1], ['s2', { shopId: 's2', latitude: null, longitude: null }], ['s3', { shopId: 's3', latitude: LAT, longitude: LNG }]])
  const visit = (id, shopId, extra = {}) => visitFromRow({ id, occurred_at: '2026-11-12T09:00:00Z', shop_id: shopId, outlet_name: null, outlet_town: null, on_list: true, distance_m: 10, status: 'recorded', ...extra })

  it('flags a visit with no 10-minute stay, and one at a shop with no map location', () => {
    const proof = visitProof({ listIds: ['s1', 's2'], shopsById, visits: [visit('v1', 's1'), visit('v2', 's2')], stays: { s1: { longestMinutes: 4 } }, dayOver: true })
    expect(proof.listed.map((l) => l.status)).toEqual(['no-stay', 'unmeasured'])
  })

  it('flags off-list and typed-in visits, which never count as proven', () => {
    const typed = visit('v4', null, { outlet_name: 'Mama Shop', outlet_town: 'Osu', on_list: false })
    const proof = visitProof({ listIds: ['s1'], shopsById, visits: [visit('v3', 's3', { on_list: false }), typed], stays: { s1: { longestMinutes: 12 } }, dayOver: true })
    expect(proof.offList.map((o) => o.status)).toEqual(['off-list', 'not-in-list'])
    expect(proof.listed[0].status).toBe('proven')
    expect(proof.counts.flagged).toBe(2)
  })

  it('proves a visit with a 12-minute stay', () => {
    const proof = visitProof({ listIds: ['s1'], shopsById, visits: [visit('v1', 's1')], stays: { s1: { longestMinutes: 12 } }, dayOver: false })
    expect(proof.listed[0].status).toBe('proven')
  })

  it('counts no-stay, missed, off-list and not-in-list as flagged', () => {
    const proof = visitProof({ listIds: ['s1', 's3'], shopsById, visits: [visit('v1', 's1'), visit('v5', null, { outlet_name: 'X Shop', outlet_town: 'Osu', on_list: false })], stays: {}, dayOver: true })
    expect(proof.listed.map((l) => l.status)).toEqual(['no-stay', 'missed'])
    expect(proof.counts.flagged).toBe(3)
  })
})

describe('visitFromRow', () => {
  it('gives the API and visitProof shape', () => {
    expect(visitFromRow({ id: 'v1', occurred_at: 't', shop_id: null, outlet_name: 'Mama', outlet_town: 'Osu', on_list: false, distance_m: null, status: 'location-unavailable' }))
      .toEqual({ id: 'v1', time: 't', outlet: { shopId: null, name: 'Mama', town: 'Osu' }, onList: false, distanceM: null, status: 'location-unavailable' })
  })
})
