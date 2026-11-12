import { describe, expect, it } from 'vitest'
import { trackingSessionRow } from '../supabase/functions/_shared/rules/tracking.js'

const event = { date: '2026-11-12', occurred_at: '2026-11-12T08:01:00Z' }

describe('trackingSessionRow (a tracking token is issued only to field roles)', () => {
  it('gives warehouse and office staff no session', () => {
    expect(trackingSessionRow({ staff_id: 'BFL-0001', company_id: 'box-for-less', position: 'Warehouse Worker' }, event, '2026-11-12T23:00:00Z', 'h')).toBeNull()
    expect(trackingSessionRow({ staff_id: 'BFL-0002', company_id: 'box-for-less', position: 'Cashier' }, event, '2026-11-12T23:00:00Z', 'h')).toBeNull()
  })

  it('opens a session for a Sales Representative, holding only the token hash', () => {
    const row = trackingSessionRow({ staff_id: 'BFL-0007', company_id: 'box-for-less', position: 'Sales Representative' }, event, '2026-11-12T23:00:00Z', 'abc123')
    expect(row).toEqual({
      staff_id: 'BFL-0007',
      company_id: 'box-for-less',
      date: '2026-11-12',
      clock_in_at: '2026-11-12T08:01:00Z',
      closes_at: '2026-11-12T23:00:00Z',
      token_hash: 'abc123',
    })
  })

  it('opens one for Supervisors and Merchandisers too', () => {
    for (const position of ['Supervisor', 'Merchandiser']) {
      expect(trackingSessionRow({ staff_id: 'X', company_id: 'c', position }, event, 'z', 'h')).not.toBeNull()
    }
  })
})
