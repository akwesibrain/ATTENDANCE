import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
})
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { SESSION_KEY, getVisitsToday, recordVisit, saveTrackingSession, trackingSession } = await import('../src/services/visitService.js')

const future = new Date(Date.now() + 3600000).toISOString()
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  store.clear()
  fetchMock.mockReset()
})

describe('the phone keeps its tracking session', () => {
  it('saves the token from a field employee’s check-in', () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 't', trackingClosesAt: future })
    expect(trackingSession()).toEqual({ token: 't', closesAt: future, staffId: 'BFL-0007', canRecordVisits: false })
    expect(SESSION_KEY).toBe('tracking:session')
  })

  it('ignores a check-in without a token (not a field role)', () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0001' })
    expect(trackingSession()).toBeNull()
  })

  it('remembers whether this person may record visits (final review: Important 4)', () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0009', trackingToken: 't', trackingClosesAt: future, canRecordVisits: false })
    expect(trackingSession().canRecordVisits).toBe(false)
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 't', trackingClosesAt: future, canRecordVisits: true })
    expect(trackingSession().canRecordVisits).toBe(true)
  })

  it('forgets it at check-out', () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 't', trackingClosesAt: future })
    saveTrackingSession({ type: 'check-out', staffId: 'BFL-0007' })
    expect(trackingSession()).toBeNull()
  })

  it('treats an expired session as none', () => {
    saveTrackingSession({ type: 'check-in', staffId: 'X', trackingToken: 't', trackingClosesAt: new Date(Date.now() - 1000).toISOString() })
    expect(trackingSession()).toBeNull()
  })
})

describe('visit calls', () => {
  beforeEach(() => saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 'tok', trackingClosesAt: future }))

  it('sends the tracking token', async () => {
    fetchMock.mockResolvedValue(reply(200, { shops: [], visits: [], attemptsLeft: 5 }))
    await getVisitsToday()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/api\/tracking\/visits$/)
    expect(init.headers.authorization).toBe('Bearer tok')
  })

  it('posts a visit', async () => {
    fetchMock.mockResolvedValue(reply(201, { visit: { id: 'v1' } }))
    const out = await recordVisit({ shopId: 's1', location: null, faceImage: 'img', faceDescriptor: [1] })
    expect(out.visit.id).toBe('v1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ shopId: 's1', location: null, faceImage: 'img', faceDescriptor: [1] })
  })

  it('forgets the session when the server says it closed', async () => {
    fetchMock.mockResolvedValue(reply(409, { error: 'Location sharing has stopped because you clocked out.', code: 'session_closed' }))
    await expect(getVisitsToday()).rejects.toMatchObject({ status: 409, data: { code: 'session_closed' } })
    expect(trackingSession()).toBeNull()
  })
})
