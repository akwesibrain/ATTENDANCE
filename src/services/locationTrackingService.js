/**
 * ============================================================================
 * MOCK LOCATION TRACKING SERVICE  —  NOT A PRODUCTION BACKEND
 * ============================================================================
 * Live location for Supervisors, Sales Reps and Merchandisers between
 * clock-in and clock-out.
 *
 * Rules:
 *   - Only Supervisors, Sales Reps and Merchandisers are tracked, and only
 *     while they are clocked in
 *     today (clocked in, not clocked out, not marked absent).
 *   - Clocking out stops tracking: the phone stops sending, and any location
 *     that still arrives after clock-out is refused here (in production the
 *     backend must enforce the same rule).
 *   - The phone sends its location only while it has a connection (mobile
 *     data or Wi-Fi) and the employee has allowed location access.
 *
 * Web limitation: a web page can only read the phone's location while the
 * attendance page is open. If the phone is locked or the browser is closed,
 * updates pause until the page is opened again. Tracking that never pauses
 * needs an installed phone app with background location; it would send the
 * same pings to the same backend rule.
 *
 * In production, recordLocationPing becomes a backend endpoint; do NOT invent
 * one here.
 * ============================================================================
 */

import { readJson, writeJson } from '../utils/localStore'
import { getAllEvents } from './attendanceService'
import { listEmployees } from './registrationService'
import { getVisitList, shopStays } from './visitListService'
import { getShop } from './shopsService'
import { categoryForPosition } from '../constants/employeeCategories'
import { accraTodayKey } from '../utils/accraTime'

const PINGS_KEY = 'mock-tracking:pings'
/**
 * Per-person daily summaries (time tracked, coverage, distance — no
 * positions). Written when a day's detailed trail is deleted, so the daily
 * report still works for past days without keeping anyone's movements.
 */
const SUMMARIES_KEY = 'mock-tracking:day-summaries'
/** Points less accurate than this are left out of the distance travelled. */
const NOISY_ACCURACY_M = 100
/** The Staff ID that clocked in on this phone (so tracking resumes after a reload). */
const DEVICE_KEY = 'mock-tracking:device-staff'
/** Roles tracked live between clock-in and clock-out. */
export const TRACKED_CATEGORIES = new Set(['supervisor', 'sales-rep', 'merchandiser'])
/** Fired on window when this phone starts or stops sharing. */
export const TRACKING_EVENT = 'tracking:changed'

/** Store a new point only if this long has passed or the phone moved this far. */
const MIN_SECONDS = 20
const MIN_METRES = 15
/** Cap per person per day, so storage cannot grow without limit. */
const MAX_PINGS_PER_DAY = 2000
/** A live position older than this is shown as "signal lost". */
export const LIVE_STALE_MINUTES = 5

function distanceMetres(a, b) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function readPings() {
  return readJson(PINGS_KEY, {})
}

/**
 * A registered employee by Staff ID, from the backend's employee list (only
 * loaded in the HR portal after sign-in; on a phone this returns null until
 * the backend sends tracking details with the clock-in response).
 */
export function findEmployee(staffId) {
  const id = String(staffId ?? '').trim().toUpperCase()
  if (!id) return null
  return listEmployees().find((e) => String(e.staffId).toUpperCase() === id) ?? null
}

/** Today's events for a Staff ID from the backend (oldest first). */
function todayEvents(staffId) {
  const today = accraTodayKey()
  return getAllEvents().filter((e) => e.date === today && String(e.staffId).toUpperCase() === staffId.toUpperCase())
}

/**
 * Whether a Staff ID should be tracked right now.
 * @returns {{ active: boolean, reason: 'tracking'|'not-found'|'not-tracked-role'|'not-clocked-in'|'clocked-out'|'absent' }}
 */
export function trackingStatus(staffId) {
  const employee = findEmployee(staffId)
  if (!employee) return { active: false, reason: 'not-found' }
  if (!TRACKED_CATEGORIES.has(categoryForPosition(employee.position))) return { active: false, reason: 'not-tracked-role' }
  const events = todayEvents(employee.staffId)
  if (events.some((e) => e.type === 'absent')) return { active: false, reason: 'absent' }
  if (events.some((e) => e.type === 'check-out')) return { active: false, reason: 'clocked-out' }
  if (!events.some((e) => e.type === 'check-in')) return { active: false, reason: 'not-clocked-in' }
  return { active: true, reason: 'tracking' }
}

/**
 * MOCK ONLY — receive one location from a Merchandiser's phone.
 * Refused unless the person is clocked in right now.
 */
export function recordLocationPing(staffId, coords, at = new Date()) {
  const status = trackingStatus(staffId)
  if (!status.active) return { ok: false, reason: status.reason }
  if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) return { ok: false, reason: 'bad-location' }

  const id = findEmployee(staffId).staffId
  const today = accraTodayKey()
  const all = readPings()
  // Keep only today's trails: older days are summarised, then deleted.
  archiveOldDays(all, today)
  const key = `${id}|${today}`
  const list = all[key] ?? []
  const point = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
    at: at.toISOString(),
  }
  const last = list[list.length - 1]
  if (last) {
    const seconds = (Date.parse(point.at) - Date.parse(last.at)) / 1000
    if (seconds < MIN_SECONDS && distanceMetres(last, point) < MIN_METRES) return { ok: true, stored: false }
  }
  list.push(point)
  all[key] = list.slice(-MAX_PINGS_PER_DAY)
  writeJson(PINGS_KEY, all)
  return { ok: true, stored: true }
}

/** Today's live points for a Staff ID, oldest first. */
export function todayTrail(staffId) {
  return readPings()[`${String(staffId).toUpperCase()}|${accraTodayKey()}`] ?? []
}

/**
 * Summary of one day's points between clock-in and clock-out:
 * how long the person was tracked, how much of that time the phone was
 * sending (each point counts for up to LIVE_STALE_MINUTES), how often and how
 * long the signal was lost, and the distance travelled.
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
    if ((a.accuracy ?? 0) <= NOISY_ACCURACY_M && (b.accuracy ?? 0) <= NOISY_ACCURACY_M) dist += distanceMetres(a, b)
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

function dayEvents(staffId, dateKey) {
  return getAllEvents().filter((e) => e.date === dateKey && String(e.staffId).toUpperCase() === staffId.toUpperCase())
}

function clockTimes(staffId, dateKey) {
  const mine = dayEvents(staffId, dateKey)
  return {
    start: mine.find((e) => e.type === 'check-in')?.time ?? null,
    end: mine.find((e) => e.type === 'check-out')?.time ?? null,
  }
}

/** Shops whose stays are worth keeping for a day: the daily list plus any shop visited. */
function stayShops(staffId, dateKey) {
  const visited = dayEvents(staffId, dateKey).filter((e) => e.type === 'visit' && e.outlet?.shopId).map((e) => e.outlet.shopId)
  return [...new Set([...getVisitList(staffId), ...visited])].map((id) => getShop(id)).filter(Boolean)
}

/** Summarise and delete every trail that is not from `today` (mutates `all`). */
function archiveOldDays(all, today) {
  const old = Object.keys(all).filter((k) => !k.endsWith(`|${today}`))
  if (!old.length) return false
  const summaries = readJson(SUMMARIES_KEY, {})
  old.forEach((k) => {
    const [id, date] = k.split('|')
    const pts = all[k] ?? []
    if (!summaries[k]) {
      const { start, end } = clockTimes(id, date)
      summaries[k] = {
        ...summariseTrail(pts, start ?? pts[0]?.at, end ?? pts[pts.length - 1]?.at),
        clockIn: start,
        clockOut: end,
        // Minutes spent near each listed/visited shop — no positions.
        shopStays: shopStays(pts, stayShops(id, date)),
      }
    }
    delete all[k]
  })
  writeJson(SUMMARIES_KEY, summaries)
  return true
}

/**
 * The tracking summary for one person and day. Today is calculated live from
 * the trail (up to `now` while still clocked in); past days come from the
 * saved summary, or null if nothing was recorded.
 */
export function daySummary(staffId, dateKey, clockIn, clockOut, now = new Date()) {
  const id = String(staffId).toUpperCase()
  const today = accraTodayKey()
  if (dateKey === today) {
    if (!clockIn) return null
    const end = clockOut ?? (now.getTime() > Date.parse(clockIn) ? now.toISOString() : clockIn)
    return summariseTrail(todayTrail(id), clockIn, end)
  }
  const all = readPings()
  if (archiveOldDays(all, today)) writeJson(PINGS_KEY, all)
  return readJson(SUMMARIES_KEY, {})[`${id}|${dateKey}`] ?? null
}

/**
 * Minutes live tracking shows the person near each shop on a day, or null if
 * there is no live tracking for that day. Today is calculated from the trail;
 * past days come from the saved summary.
 */
export function dayShopStays(staffId, dateKey) {
  const id = String(staffId).toUpperCase()
  const today = accraTodayKey()
  if (dateKey === today) {
    const trail = todayTrail(id)
    return trail.length ? shopStays(trail, stayShops(id, dateKey)) : null
  }
  const all = readPings()
  if (archiveOldDays(all, today)) writeJson(PINGS_KEY, all)
  return readJson(SUMMARIES_KEY, {})[`${id}|${dateKey}`]?.shopStays ?? null
}

/** The latest live point today, or null. */
export function latestLocation(staffId) {
  const trail = todayTrail(staffId)
  return trail[trail.length - 1] ?? null
}

// ---------- Phone side ----------

export function deviceTrackedStaffId() {
  try { return window.localStorage.getItem(DEVICE_KEY) } catch { return null }
}

function announce() {
  try { window.dispatchEvent(new Event(TRACKING_EVENT)) } catch { /* not in a browser */ }
}

/** Called after a successful scan on this phone: start on clock-in, stop on clock-out. */
export function onAttendanceRecorded(event) {
  if (!event) return
  try {
    if (event.type === 'check-in' && trackingStatus(event.staffId).active) window.localStorage.setItem(DEVICE_KEY, event.staffId)
    if (event.type === 'check-out' && deviceTrackedStaffId() === event.staffId) window.localStorage.removeItem(DEVICE_KEY)
  } catch { /* storage unavailable */ }
  announce()
}

function stopDevice() {
  try { window.localStorage.removeItem(DEVICE_KEY) } catch { /* ignore */ }
  announce()
}

/**
 * Start sending this phone's location for staffId. Calls onState with
 * { status, at?, message? } where status is one of:
 *   'starting' | 'sharing' | 'offline' | 'denied' | 'unavailable' | 'unsupported' | 'stopped'
 * Returns a function that stops sharing.
 */
export function startLocationSharing(staffId, onState) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onState({ status: 'unsupported' })
    return () => {}
  }
  let stopped = false
  let watchId = null
  let timer = null
  const stop = () => {
    if (stopped) return
    stopped = true
    if (watchId != null) navigator.geolocation.clearWatch(watchId)
    clearInterval(timer)
  }
  const endIfClockedOut = () => {
    if (trackingStatus(staffId).active) return false
    stop()
    stopDevice()
    onState({ status: 'stopped' })
    return true
  }

  onState({ status: 'starting' })
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (stopped || endIfClockedOut()) return
      if (navigator.onLine === false) { onState({ status: 'offline' }); return }
      const r = recordLocationPing(staffId, pos.coords, new Date(pos.timestamp || Date.now()))
      if (!r.ok && r.reason === 'clocked-out') { endIfClockedOut(); return }
      onState({ status: 'sharing', at: new Date().toISOString(), accuracy: pos.coords.accuracy })
    },
    (err) => {
      if (stopped) return
      onState(err?.code === 1
        ? { status: 'denied' }
        : { status: 'unavailable', message: 'Turn on Location (GPS) on this phone.' })
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  )
  // Clock-out from another device or tab also stops this phone.
  timer = setInterval(endIfClockedOut, 15000)
  return stop
}
