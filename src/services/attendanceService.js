/**
 * The attendance kiosk and the raw check-in events. The server decides what is
 * allowed, compares the face and sets the time.
 */

import { eventFromRow } from '../../supabase/functions/_shared/rules/facts.js'
import { api } from './backend/client'
import { rows } from './backend/cache'

export { MAX_FACE_ATTEMPTS } from '../../supabase/functions/_shared/rules/checkin.js'

/** What the kiosk may do for this Staff ID right now. Throws if it is unknown. */
/** @param {string|null} sitePass from scanning a workplace display, if any */
export function lookupEmployee(staffId, sitePass = null) {
  const query = sitePass ? `?pass=${encodeURIComponent(sitePass)}` : ''
  return api(`/attendance/lookup/${encodeURIComponent(staffId.trim())}${query}`)
}

/**
 * Record the next action after a face scan. Throws on refusal; a face mismatch
 * carries `data.code`, `data.attemptsLeft` and `data.lockedOut`.
 */
export function recordAttendance({ staffId, faceImage, faceDescriptor, sitePass = null }) {
  return api('/attendance/events', { method: 'POST', body: { staffId, faceImage, faceDescriptor, sitePass } })
}

export function getAllEvents() {
  return rows('attendance_events').map(eventFromRow)
}
