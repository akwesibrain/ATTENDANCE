/**
 * The attendance kiosk and the raw check-in events. The server decides what is
 * allowed, compares the face and sets the time.
 */

import { eventFromRow } from '../../supabase/functions/_shared/rules/facts.js'
import { api } from './backend/client'
import { rows } from './backend/cache'

export { MAX_FACE_ATTEMPTS } from '../../supabase/functions/_shared/rules/checkin.js'

/** What the kiosk may do for this Staff ID right now. Throws if it is unknown. */
export function lookupEmployee(staffId) {
  return api(`/attendance/lookup/${encodeURIComponent(staffId.trim())}`)
}

/**
 * Record the next action after a face scan. Throws on refusal; a face mismatch
 * carries `data.code`, `data.attemptsLeft` and `data.lockedOut`.
 */
export function recordAttendance({ staffId, faceImage }) {
  return api('/attendance/events', { method: 'POST', body: { staffId, faceImage } })
}

export function getAllEvents() {
  return rows('attendance_events').map(eventFromRow)
}
