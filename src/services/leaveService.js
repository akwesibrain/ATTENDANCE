/**
 * ============================================================================
 * MOCK LEAVE SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * A few leave records so the attendance rules can be shown: approved leave is
 * never counted as absence, and a pending request does not count as leave.
 *
 * The demo records are placed relative to today so they always fall inside the
 * current attendance period. A real leave module (requests, approvals) is
 * out of scope here; replace this with the backend leave API once defined.
 * ============================================================================
 */

import { accraTodayKey, addDaysToKey } from '../utils/accraTime'

function seedLeaves() {
  const today = accraTodayKey()
  return [
    {
      leaveId: 'LV-1001',
      employeeId: 'BFL-1004',
      leaveType: 'Annual leave',
      startDate: addDaysToKey(today, -2),
      endDate: addDaysToKey(today, 4),
      status: 'approved',
      approvedBy: 'John Mensah',
    },
    {
      leaveId: 'LV-1002',
      employeeId: 'DAA-1003',
      leaveType: 'Sick leave',
      startDate: addDaysToKey(today, -8),
      endDate: addDaysToKey(today, -7),
      status: 'approved',
      approvedBy: 'John Mensah',
    },
    {
      leaveId: 'LV-1003',
      employeeId: 'BFL-1002',
      leaveType: 'Annual leave',
      startDate: addDaysToKey(today, -5),
      endDate: addDaysToKey(today, -5),
      status: 'pending',
      approvedBy: null,
    },
  ]
}

/** All leave records (demo). */
export function mockListLeaves() {
  return seedLeaves()
}

function leaveOn(employeeId, dateKey, status) {
  return (
    seedLeaves().find(
      (l) =>
        l.employeeId === employeeId &&
        l.status === status &&
        dateKey >= l.startDate &&
        dateKey <= l.endDate,
    ) ?? null
  )
}

/** The approved leave covering an employee on a date, or null. */
export function getApprovedLeave(employeeId, dateKey) {
  return leaveOn(employeeId, dateKey, 'approved')
}

/** A pending (not yet approved) leave request on a date, or null. */
export function getPendingLeave(employeeId, dateKey) {
  return leaveOn(employeeId, dateKey, 'pending')
}
