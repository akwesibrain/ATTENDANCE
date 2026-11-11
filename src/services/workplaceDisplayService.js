/**
 * Workplace QR displays.
 *
 * HR adds a display and opens its one-time setup link on a tablet at the
 * workplace. The tablet then shows a QR code that changes every 30 seconds.
 * Scanning it opens the check-in page, which swaps the code for a 10-minute pass.
 */

import { api, submit } from './backend/client'
import { refresh, rows } from './backend/cache'
import { getSettings } from './settingsService'

const DISPLAY_KEY = 'workforce:display'
const PASS_KEY = 'workforce:site-pass'

/* ------------------------------------------------------------------ HR */

function displayFromRow(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    status: row.status,
    pairedAt: row.paired_at,
    setupExpiresAt: row.setup_expires_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

export function listDisplays(companyId) {
  return rows('workplace_displays')
    .filter((row) => row.company_id === companyId)
    .map(displayFromRow)
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1))
}

export function workplaceCodeRequired(companyId) {
  return Boolean(getSettings().workplaceCodeRequired?.[companyId])
}

export function setupUrl(token) {
  return `${window.location.origin}/display/setup/${token}`
}

const reload = () => refresh('workplace_displays', 'settings_company', 'audit_events')

/** @returns {Promise<{ id, setupToken, expiresAt } | { errors }>} */
export async function addDisplay(companyId, name) {
  const result = await submit('/hr/displays', { method: 'POST', body: { companyId, name } })
  if (!result.errors) await reload()
  return result
}

export async function newSetupLink(displayId) {
  const result = await submit(`/hr/displays/${displayId}/setup-link`, { method: 'POST', body: {} })
  if (!result.errors) await reload()
  return result
}

export async function switchOffDisplay(displayId) {
  const result = await submit(`/hr/displays/${displayId}/revoke`, { method: 'POST', body: {} })
  if (!result.errors) await reload()
  return result
}

export async function setWorkplaceCodeRequired(companyId, required) {
  const result = await submit(`/hr/displays/required/${companyId}`, { method: 'PUT', body: { required } })
  if (!result.errors) await reload()
  return result
}

/* ------------------------------------------------------------------ The display device */

function readStored(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/** The display this device was set up as, or null. */
export function thisDisplay() {
  return readStored(window.localStorage, DISPLAY_KEY)
}

export async function claimDisplay(token) {
  const display = await api('/displays/claim', { method: 'POST', body: { token } })
  window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(display))
  return display
}

export function forgetDisplay() {
  window.localStorage.removeItem(DISPLAY_KEY)
}

/** How far this device's clock is from the server's, in milliseconds. */
export async function clockOffsetMs() {
  const before = Date.now()
  const { now } = await api('/public/time')
  const after = Date.now()
  return Date.parse(now) - (before + after) / 2
}

/* ------------------------------------------------------------------ The employee's phone */

/** Swap a scanned code for a pass, and keep it for this browser tab. */
export async function passFromCode(code) {
  const pass = await api('/attendance/site-pass', { method: 'POST', body: { code } })
  window.sessionStorage.setItem(PASS_KEY, JSON.stringify(pass))
  return pass
}

/** The pass from a recent scan, if it has not run out. */
export function currentPass() {
  const pass = readStored(window.sessionStorage, PASS_KEY)
  return pass && Date.parse(pass.expiresAt) > Date.now() ? pass : null
}

export function clearPass() {
  window.sessionStorage.removeItem(PASS_KEY)
}
