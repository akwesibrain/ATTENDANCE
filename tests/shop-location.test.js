import { describe, expect, it } from 'vitest'
import {
  MAX_CAPTURE_ACCURACY_M,
  parseShopCapture,
  proposalRow,
} from '../supabase/functions/_shared/rules/tracking.js'

const LAT = 5.6
const LNG = -0.18
const east = (m) => LNG + m / (111320 * Math.cos((LAT * Math.PI) / 180))
const session = { id: 'sess-1', staff_id: 'BFL-0007', company_id: 'box-for-less', date: '2026-11-13' }
const now = new Date('2026-11-13T10:00:00Z')
const at = (accuracy) => ({ shopId: 's1', location: { latitude: LAT, longitude: LNG, accuracy } })

describe('parseShopCapture', () => {
  it('accepts a reading at the accuracy limit', () => {
    expect(MAX_CAPTURE_ACCURACY_M).toBe(30)
    expect(parseShopCapture(at(30))).toEqual({ shopId: 's1', latitude: LAT, longitude: LNG, accuracy: 30 })
  })
  it('refuses a reading that is not accurate enough', () => {
    expect(parseShopCapture(at(31))).toEqual({
      error: 'The GPS reading is not accurate enough yet (±31 m). Move into the open and try again.',
    })
  })
  it('needs a shop', () => {
    expect(parseShopCapture({ location: at(10).location })).toEqual({ error: 'Choose the shop.' })
  })
  it('needs a location with a known accuracy', () => {
    const unavailable = { error: 'Location is not available. Turn on Location (GPS).' }
    expect(parseShopCapture({ shopId: 's1' })).toEqual(unavailable)
    expect(parseShopCapture({ shopId: 's1', location: { latitude: 95, longitude: 0, accuracy: 5 } })).toEqual(unavailable)
    expect(parseShopCapture({ shopId: 's1', location: { latitude: LAT, longitude: LNG } })).toEqual(unavailable)
  })
})

describe('proposalRow', () => {
  const capture = { shopId: 's1', latitude: LAT, longitude: east(60), accuracy: 8 }

  it('builds a pending suggestion', () => {
    const row = proposalRow({ session, shop: { shop_id: 's1', latitude: null, longitude: null }, capture, now })
    expect(row).toEqual({
      shop_id: 's1',
      company_id: 'box-for-less',
      staff_id: 'BFL-0007',
      latitude: LAT,
      longitude: east(60),
      accuracy_m: 8,
      distance_from_current_m: null,
      status: 'pending',
      proposed_at: '2026-11-13T10:00:00.000Z',
      decided_by: null,
      decided_at: null,
    })
  })
  it('says how far the reading is from the current pin, when the shop has one', () => {
    const row = proposalRow({ session, shop: { shop_id: 's1', latitude: LAT, longitude: LNG }, capture, now })
    expect(row.distance_from_current_m).toBeGreaterThanOrEqual(59)
    expect(row.distance_from_current_m).toBeLessThanOrEqual(61)
  })
})
