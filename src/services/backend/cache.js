/**
 * The HR portal's in-memory copy of the facts it is allowed to read.
 *
 * Screens read synchronously during render, so the facts are loaded once after
 * sign-in and re-read after each change. Nothing here is written to the browser's
 * storage, and row-level security decides what comes back.
 */

import { useSyncExternalStore } from 'react'
import { accraDateKey, addDaysToKey } from '../../../supabase/functions/_shared/rules/accraTime.js'
import { supabase } from './client'

const HISTORY_DAYS = 400
const PAGE = 1000

const TABLES = {
  employees: { order: 'staff_id' },
  shops: { order: 'shop_id' },
  shop_assignments: { order: 'assigned_at' },
  employee_shops: { order: 'position' },
  employee_shop_changes: { order: 'at' },
  leave_records: { order: 'start_date', since: 'end_date' },
  attendance_events: { order: 'occurred_at', since: 'date' },
  attendance_corrections: { order: 'date', since: 'date' },
  attendance_correction_history: { order: 'changed_at', since: 'date' },
  verification_events: { order: 'dispatched_at', since: 'date' },
  monitoring_alert_reviews: { order: 'exception_id' },
  holidays: { order: 'date' },
  settings_general: { order: 'key' },
  settings_company: { order: 'company_id' },
  settings_versions: { order: 'id' },
  notifications: { order: 'occurred_at' },
  notification_history: { order: 'at' },
  audit_events: { order: 'at', since: 'at' },
  workplace_displays: { order: 'created_at' },
}

/** What can change without this browser doing anything. */
const LIVE_TABLES = ['employees', 'attendance_events', 'verification_events', 'notifications', 'notification_history', 'audit_events', 'workplace_displays']
const LIVE_REFRESH_MS = 60000

let store = {}
let hydrated = false
let version = 0
const listeners = new Set()

function announce() {
  version += 1
  listeners.forEach((listener) => listener())
}

async function fetchTable(name) {
  const { order, since } = TABLES[name]
  const cutoff = addDaysToKey(accraDateKey(), -HISTORY_DAYS)
  const all = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(name).select('*')
    if (since) query = query.gte(since, cutoff)
    const { data, error } = await query.order(order).range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not load ${name}: ${error.message}`)
    all.push(...data)
    if (data.length < PAGE) return all
  }
}

/* Face photos are private, so screens get short-lived links. */
const PHOTO_BUCKET = 'face-enrollment'
const PHOTO_LINK_SECONDS = 3600
const PHOTO_RENEW_MS = 45 * 60000
const photoLinks = new Map()

async function signPhotos() {
  const now = Date.now()
  const paths = (store.employees ?? [])
    .map((row) => row.face_photo_path)
    .filter((path) => path && !(photoLinks.get(path)?.signedAt > now - PHOTO_RENEW_MS))
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths.slice(i, i + 100), PHOTO_LINK_SECONDS)
    if (error) {
      console.error('Could not open employee photos', error.message)
      return
    }
    data.forEach((entry) => {
      if (entry.signedUrl) photoLinks.set(entry.path, { url: entry.signedUrl, signedAt: now })
    })
  }
}

export function photoUrl(path) {
  return path ? photoLinks.get(path)?.url ?? null : null
}

/** Load everything. Call after sign-in, before showing the portal. */
export async function hydrate() {
  const names = Object.keys(TABLES)
  const results = await Promise.all(names.map(fetchTable))
  store = Object.fromEntries(names.map((name, index) => [name, results[index]]))
  await signPhotos()
  hydrated = true
  announce()
}

/** Re-read some tables after a change. */
export async function refresh(...names) {
  try {
    const results = await Promise.all(names.map(fetchTable))
    names.forEach((name, index) => {
      store[name] = results[index]
    })
    if (names.includes('employees')) await signPhotos()
    announce()
  } catch (error) {
    // The change itself was saved. The screen catches up on the next refresh.
    console.error('Could not reload after a change', error.message)
  }
}

export function clearCache() {
  store = {}
  hydrated = false
  photoLinks.clear()
  announce()
}

/** The rows of a table, newest data as last loaded. */
export function rows(name) {
  return store[name] ?? []
}

export function isHydrated() {
  return hydrated
}

/** Settings → General. Pages without a sign-in use the 12-hour default. */
export function uses24HourClock() {
  return rows('settings_general').find((row) => row.key === 'general')?.value.timeFormat === '24h'
}

export function cacheVersion() {
  return version
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-renders the caller whenever the cache changes. */
export function useCacheVersion() {
  return useSyncExternalStore(subscribe, cacheVersion)
}

/** Keep the portal current while it is open. Returns a stop function. */
export function startLiveRefresh() {
  const timer = setInterval(() => {
    if (document.hidden) return
    refresh(...LIVE_TABLES)
  }, LIVE_REFRESH_MS)
  return () => clearInterval(timer)
}
