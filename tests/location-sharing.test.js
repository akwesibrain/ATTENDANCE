import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
})
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { saveTrackingSession, trackingSession } = await import('../src/services/visitService.js')
const {
  QUEUE_KEY,
  clearLocationQueue,
  flushLocationQueue,
  queueLocationPoint,
  readLocationQueue,
} = await import('../src/services/locationTrackingService.js')

const future = new Date(Date.now() + 3600000).toISOString()
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  store.clear()
  clearLocationQueue()
  fetchMock.mockReset()
})

describe('phone location queue and backend delivery', () => {
  it('refuses to queue points when no tracking session is open', () => {
    const res = queueLocationPoint({ latitude: 5.6037, longitude: -0.187, accuracy: 12 })
    expect(res).toEqual({ ok: false, reason: 'session_closed' })
    expect(readLocationQueue()).toEqual([])
  })

  it('thins stationary fixes within 20 seconds and 15 metres', () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', fullName: 'Kofi Boateng', trackingToken: 'tok-1', trackingClosesAt: future })
    const t0 = new Date('2026-11-13T09:00:00Z')
    const t5 = new Date('2026-11-13T09:00:05Z')
    const t25 = new Date('2026-11-13T09:00:25Z')

    expect(queueLocationPoint({ latitude: 5.6037, longitude: -0.187, accuracy: 10 }, t0)).toEqual({ ok: true, queued: true })
    expect(queueLocationPoint({ latitude: 5.60371, longitude: -0.18701, accuracy: 10 }, t5)).toEqual({ ok: true, queued: false })
    expect(queueLocationPoint({ latitude: 5.60371, longitude: -0.18701, accuracy: 10 }, t25)).toEqual({ ok: true, queued: true })
    expect(readLocationQueue()).toHaveLength(2)
  })

  it('keeps offline points in localStorage and flushes them when back online', async () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 'tok-offline', trackingClosesAt: future })
    queueLocationPoint({ latitude: 5.6037, longitude: -0.187, accuracy: 14 }, new Date('2026-11-13T09:00:00Z'))

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const offline = await flushLocationQueue()
    expect(offline).toEqual({ ok: false, reason: 'offline' })
    expect(store.has(QUEUE_KEY)).toBe(true)
    expect(readLocationQueue()).toHaveLength(1)

    fetchMock.mockResolvedValueOnce(reply(200, { accepted: 1, rejected: 0, sessionOpen: true }))
    const online = await flushLocationQueue()
    expect(online.ok).toBe(true)
    expect(online.sent).toBe(1)
    expect(readLocationQueue()).toEqual([])

    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toMatch(/\/functions\/v1\/api\/tracking\/points$/)
    expect(init.headers.authorization).toBe('Bearer tok-offline')
    expect(JSON.parse(init.body).points).toHaveLength(1)
  })

  it('clears both the session and the queue on 409 session_closed', async () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 'tok-closed', trackingClosesAt: future })
    queueLocationPoint({ latitude: 5.6037, longitude: -0.187, accuracy: 9 }, new Date('2026-11-13T09:00:00Z'))

    fetchMock.mockResolvedValueOnce(reply(409, { error: 'Location sharing has stopped because you clocked out.', code: 'session_closed' }))
    const res = await flushLocationQueue()
    expect(res).toEqual({ ok: false, reason: 'session_closed' })
    expect(trackingSession()).toBeNull()
    expect(readLocationQueue()).toEqual([])
  })
})

