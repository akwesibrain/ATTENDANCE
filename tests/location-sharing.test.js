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
  startLocationSharing,
} = await import('../src/services/locationTrackingService.js')
const { MAX_POINTS_PER_DAY, MAX_POINTS_PER_REQUEST } = await import('../supabase/functions/_shared/rules/tracking.js')

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

  it('does not drop unsent points when MAX_POINTS_PER_DAY shifts the queue mid-flush', async () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 'tok-cap', trackingClosesAt: future })
    const baseMs = Date.parse('2026-11-13T08:00:00Z')
    const initial = Array.from({ length: MAX_POINTS_PER_DAY }, (_, i) => ({
      latitude: 5.6037 + i * 0.0002,
      longitude: -0.187,
      accuracy: 10,
      recordedAt: new Date(baseMs + i * 25000).toISOString(),
    }))
    store.set(QUEUE_KEY, JSON.stringify(initial))

    let firstBatch = true
    const deliveredTimestamps = []
    fetchMock.mockImplementation(async (_url, init) => {
      const { points } = JSON.parse(init.body)
      deliveredTimestamps.push(...points.map((p) => p.recordedAt))
      if (firstBatch) {
        firstBatch = false
        // Queue 3 new points while the first 500-point batch is in flight,
        // shifting the oldest 3 items off the 2000-point cap.
        for (let j = 0; j < 3; j += 1) {
          queueLocationPoint(
            { latitude: 6.1 + j * 0.001, longitude: -0.2, accuracy: 8 },
            new Date(baseMs + (MAX_POINTS_PER_DAY + j) * 25000),
          )
        }
      }
      return reply(200, { accepted: points.length, rejected: 0, sessionOpen: true })
    })

    const res = await flushLocationQueue()
    expect(res.ok).toBe(true)
    expect(readLocationQueue()).toEqual([])
    expect(deliveredTimestamps).toHaveLength(MAX_POINTS_PER_DAY + 3)
    // Specifically verify boundary items right after the first batch were never skipped
    expect(deliveredTimestamps).toContain(initial[MAX_POINTS_PER_REQUEST].recordedAt)
    expect(deliveredTimestamps).toContain(initial[MAX_POINTS_PER_REQUEST + 1].recordedAt)
    expect(deliveredTimestamps).toContain(initial[MAX_POINTS_PER_REQUEST + 2].recordedAt)
  })

  it('does not send a previous worker’s unsent queue after another worker checks in', async () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 'tok-a', trackingClosesAt: future })
    queueLocationPoint({ latitude: 5.6037, longitude: -0.187, accuracy: 11 }, new Date('2026-11-13T09:00:00Z'))
    expect(readLocationQueue()).toHaveLength(1)

    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0008', trackingToken: 'tok-b', trackingClosesAt: future })
    expect(readLocationQueue()).toEqual([])

    const res = await flushLocationQueue()
    expect(res).toEqual({ ok: true, sent: 0, at: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('flushes queued points and restarts a stalled watch on visibilitychange', async () => {
    saveTrackingSession({ type: 'check-in', staffId: 'BFL-0007', trackingToken: 'tok-vis', trackingClosesAt: future })
    const docListeners = new Map()
    const winListeners = new Map()
    const watchPosition = vi.fn().mockReturnValueOnce(101).mockReturnValueOnce(102)
    const clearWatch = vi.fn()
    vi.stubGlobal('navigator', { onLine: true, geolocation: { watchPosition, clearWatch } })
    vi.stubGlobal('window', {
      addEventListener: (ev, fn) => winListeners.set(ev, fn),
      removeEventListener: (ev) => winListeners.delete(ev),
    })
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (ev, fn) => docListeners.set(ev, fn),
      removeEventListener: (ev) => docListeners.delete(ev),
    }
    vi.stubGlobal('document', doc)

    let nowMs = Date.parse('2026-11-13T10:00:00Z')
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    try {
      const stop = startLocationSharing(() => {})
      expect(watchPosition).toHaveBeenCalledTimes(1)

      // Queue an offline point and simulate returning to foreground after >30s sleep
      queueLocationPoint({ latitude: 5.6037, longitude: -0.187, accuracy: 12 }, new Date(nowMs))
      fetchMock.mockResolvedValueOnce(reply(200, { accepted: 1, rejected: 0, sessionOpen: true }))
      nowMs += 45000
      doc.visibilityState = 'visible'
      docListeners.get('visibilitychange')?.()

      await vi.waitFor(() => expect(readLocationQueue()).toEqual([]))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(clearWatch).toHaveBeenCalledWith(101)
      expect(watchPosition).toHaveBeenCalledTimes(2)

      stop()
      expect(docListeners.has('visibilitychange')).toBe(false)
    } finally {
      dateSpy.mockRestore()
    }
  })
})

