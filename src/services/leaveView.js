/**
 * Leave, read-only, from the backend's `leave_records` table (loaded into the
 * HR portal cache after sign-in).
 *
 * FRONTEND-ONLY helper: it never writes. Recording, ending or cancelling leave
 * needs a backend endpoint that does not exist yet (see
 * docs/backend-live-tracker-and-sms-verification.md, "Needed from the backend").
 */
import { rows } from './backend/cache'
import { leaveFromRow } from '../../supabase/functions/_shared/rules/facts.js'
import { accraTodayKey } from '../utils/accraTime'

export const LEAVE_STATUS = {
  approved: { label: 'Approved', tone: 'ok' },
  pending: { label: 'Pending', tone: 'pending' },
  rejected: { label: 'Rejected', tone: 'muted' },
}

/** All leave for one employee, newest first. */
export function listLeavesFor(employeeId) {
  return rows('leave_records')
    .map(leaveFromRow)
    .filter((l) => l.employeeId === employeeId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
}

/** The approved leave an employee is on today, or else their next one. */
export function currentOrNextLeave(employeeId, today = accraTodayKey()) {
  const approved = listLeavesFor(employeeId)
    .filter((l) => l.status === 'approved' && l.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const current = approved.find((l) => l.startDate <= today) ?? null
  return { current, next: current ? null : approved[0] ?? null }
}
