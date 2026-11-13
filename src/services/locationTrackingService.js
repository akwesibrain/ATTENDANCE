/**
 * Live location sharing from a field employee's phone to the Supabase backend.
 *
 * Rules:
 *   - Only Supervisors, Sales Reps and Merchandisers receive a `trackingToken`
 *     when they clock in. No token means no location sharing.
 *   - Points are thinned on the phone (20 s or 15 m) and queued locally while
 *     mobile data is out, then sent in batches to `POST /tracking/points`.
 *   - On clock-out, session expiry, or `409 session_closed`, watching stops
 *     immediately and any unsent queue is cleared.
 */

import {
  LIVE_STALE_MINUTES,
  MAX_POINTS_PER_DAY,
  MAX_POINTS_PER_REQUEST,
  MIN_METRES,
  MIN_SECONDS,
  distanceMetres,
  shopStays,
  summariseTrail,
} from '../../supabase/functions/_shared/rules/tracking.js'
import { TRACKING_EVENT, clearTrackingSession, trackingSession } from './visitService'

export { LIVE_STALE_MINUTES, shopStays, summariseTrail, TRACKING_EVENT }

/** Roles tracked live between clock-in and clock-out. */
export const TRACKED_CATEGORIES = new Set(['supervisor', 'sales-rep', 'merchandiser'])
export const QUEUE_KEY = 'tracking:queue'

const API = `${import.meta.env?.VITE_SUPABASE_URL ?? ''}/functions/v1/api`

let lastAcceptedByStaff = new Map()
let inFlight = null

export function readLocationQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocationQueue(points) {
  try {
    if (!points.length) localStorage.removeItem(QUEUE_KEY)
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(points.slice(-MAX_POINTS_PER_DAY)))
  } catch { /* storage unavailable */ }
}

export function clearLocationQueue() {
  lastAcceptedByStaff.clear()
  try { localStorage.removeItem(QUEUE_KEY) } catch { /* ignore */ }
}

/**
 * Thin and queue one GPS fix for the active session on this phone.
 * @returns {{ ok: boolean, queued?: boolean, reason?: string }}
 */
export function queueLocationPoint(coords, at = new Date(), { isMock = false } = {}) {
  const session = trackingSession()
  if (!session) {
    clearLocationQueue()
    return { ok: false, reason: 'session_closed' }
  }
  if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
    return { ok: false, reason: 'bad-location' }
  }
  const recordedAt = at instanceof Date ? at.toISOString() : new Date(at).toISOString()
  const point = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
    recordedAt,
    ...(isMock === true ? { isMock: true } : {}),
  }

  const queue = readLocationQueue()
  const prev = queue[queue.length - 1] ?? lastAcceptedByStaff.get(session.staffId) ?? null
  if (prev) {
    const prevMs = Date.parse(prev.recordedAt ?? prev.at)
    const nextMs = Date.parse(recordedAt)
    const seconds = (nextMs - prevMs) / 1000
    if (Number.isFinite(seconds) && seconds < MIN_SECONDS && distanceMetres(prev, point) < MIN_METRES) {
      return { ok: true, queued: false }
    }
  }

  queue.push(point)
  writeLocationQueue(queue)
  lastAcceptedByStaff.set(session.staffId, point)
  return { ok: true, queued: true }
}

async function doFlush() {
  let totalSent = 0
  let lastAcceptedAt = null
  while (true) {
    const session = trackingSession()
    if (!session) {
      clearLocationQueue()
      return { ok: false, reason: 'session_closed' }
    }
    const queue = readLocationQueue()
    if (!queue.length) return { ok: true, sent: totalSent, at: lastAcceptedAt }

    const batch = queue.slice(0, MAX_POINTS_PER_REQUEST)
    let response
    try {
      response = await fetch(`${API}/tracking/points`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ points: batch }),
      })
    } catch {
      return { ok: false, reason: 'offline' }
    }

    const payload = await response.json().catch(() => null)
    if (response.status === 409 || response.status === 401 || payload?.code === 'session_closed' || payload?.code === 'invalid_token') {
      clearTrackingSession()
      clearLocationQueue()
      return { ok: false, reason: 'session_closed' }
    }
    if (!response.ok) {
      // Transient server / rate-limit failure: keep points queued for retry.
      return { ok: false, reason: 'offline' }
    }

    const remaining = readLocationQueue().slice(batch.length)
    writeLocationQueue(remaining)
    totalSent += Number(payload?.accepted ?? batch.length)
    lastAcceptedAt = batch[batch.length - 1]?.recordedAt ?? new Date().toISOString()
    if (!remaining.length) return { ok: true, sent: totalSent, at: lastAcceptedAt }
  }
}

/** Upload queued points in batches of up to 500. */
export function flushLocationQueue() {
  if (!inFlight) {
    inFlight = doFlush().finally(() => { inFlight = null })
  }
  return inFlight
}

/**
 * Start sending this phone's location while a tracking session is open.
 * Calls `onState({ status, at?, accuracy?, message? })`.
 * Returns a cleanup function that stops watching GPS.
 */
export function startLocationSharing(staffIdOrOnState, maybeOnState) {
  const onState = typeof staffIdOrOnState === 'function' ? staffIdOrOnState : maybeOnState
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onState?.({ status: 'unsupported' })
    return () => {}
  }
  if (!trackingSession()) {
    clearLocationQueue()
    onState?.({ status: 'stopped' })
    return () => {}
  }

  let stopped = false
  let watchId = null
  let timer = null

  const stop = () => {
    if (stopped) return
    stopped = true
    if (watchId != null) navigator.geolocation.clearWatch(watchId)
    if (timer != null) clearInterval(timer)
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  }

  const endSession = () => {
    stop()
    clearLocationQueue()
    onState?.({ status: 'stopped' })
  }

  const checkSession = () => {
    if (!trackingSession()) {
      endSession()
      return false
    }
    return true
  }

  const syncQueue = async (accuracy = null) => {
    if (stopped || !checkSession()) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onState?.({ status: 'offline' })
      return
    }
    const res = await flushLocationQueue()
    if (stopped) return
    if (!res.ok && res.reason === 'session_closed') {
      endSession()
      return
    }
    if (!res.ok && res.reason === 'offline') {
      onState?.({ status: 'offline' })
      return
    }
    onState?.({ status: 'sharing', at: res.at ?? new Date().toISOString(), accuracy })
  }

  function onOnline() {
    void syncQueue()
  }

  onState?.({ status: 'starting' })
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
  if (readLocationQueue().length) void syncQueue()

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (stopped || !checkSession()) return
      const fixTime = new Date(pos.timestamp || Date.now())
      const q = queueLocationPoint(pos.coords, fixTime, { isMock: pos.coords?.isMock === true || pos.mocked === true })
      if (!q.ok && q.reason === 'session_closed') {
        endSession()
        return
      }
      if (!q.queued && readLocationQueue().length === 0) {
        onState?.({ status: 'sharing', at: fixTime.toISOString(), accuracy: pos.coords.accuracy })
        return
      }
      void syncQueue(pos.coords.accuracy)
    },
    (err) => {
      if (stopped) return
      onState?.(err?.code === 1
        ? { status: 'denied' }
        : { status: 'unavailable', message: 'Turn on Location (GPS) on this phone.' })
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  )

  timer = setInterval(checkSession, 15000)
  return stop
}
