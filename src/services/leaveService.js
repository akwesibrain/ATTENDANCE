/**
 * ============================================================================
 * MOCK LEAVE SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * HR records leave for an employee (type, first and last day, notes). Leave
 * recorded by HR is approved. Every calculation reads leave from here, so:
 *   - each working day in the leave shows as "On leave" in Attendance,
 *     Reports and the dashboard;
 *   - those days are never counted as absences, and are left out of overtime.
 * HR can end a leave early (the employee came back) or cancel it (recorded
 * by mistake). Nothing is deleted: cancelled leave stays in the history, and
 * every action is written to the audit log.
 *
 * Stored in browser storage for this prototype; the backend leave API will
 * replace it.
 * ============================================================================
 */

import { readJson, writeJson } from './mockStore'
import { can, canAccessCompany } from './permissionsService'
import { recordAuditEvent } from './auditStore'
import { defaultHoursFor } from './settingsService'
import { isScheduledWorkday } from '../utils/attendanceRules'
import { accraTodayKey, addDaysToKey, formatAccraDate } from '../utils/accraTime'
import { isDateKey } from '../utils/tenure'

const STORE_KEY = 'mock-leave:v1'
const MAX_DAYS = 366

export const LEAVE_TYPES = [
  'Annual leave',
  'Sick leave',
  'Maternity leave',
  'Paternity leave',
  'Compassionate leave',
  'Study leave',
  'Unpaid leave',
  'Other leave',
]

export const LEAVE_STATUS = {
  approved: { label: 'Approved', tone: 'ok' },
  pending: { label: 'Pending', tone: 'pending' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

/** Demo records (relative to today), written once on first use. */
function seedLeaves() {
  const today = accraTodayKey()
  const seed = (leaveId, employeeId, companyId, leaveType, from, to, status) => ({
    leaveId,
    employeeId,
    companyId,
    leaveType,
    startDate: addDaysToKey(today, from),
    endDate: addDaysToKey(today, to),
    notes: '',
    status,
    recordedBy: status === 'approved' ? 'John Mensah' : null,
    recordedAt: `${addDaysToKey(today, from - 3)}T09:00:00.000Z`,
    history: [{ action: status === 'approved' ? 'Recorded' : 'Requested', by: status === 'approved' ? 'John Mensah' : 'Employee', at: `${addDaysToKey(today, from - 3)}T09:00:00.000Z`, note: 'Demo record' }],
    demo: true,
  })
  return [
    seed('LV-1001', 'BFL-1004', 'box-for-less', 'Annual leave', -2, 4, 'approved'),
    seed('LV-1002', 'DAA-1003', 'double-a', 'Sick leave', -8, -7, 'approved'),
    seed('LV-1003', 'BFL-1002', 'box-for-less', 'Annual leave', -5, -5, 'pending'),
  ]
}

function readLeaves() {
  const stored = readJson(STORE_KEY, null)
  if (Array.isArray(stored)) return stored
  const seeded = seedLeaves()
  writeJson(STORE_KEY, seeded)
  return seeded
}

function writeLeaves(list) {
  writeJson(STORE_KEY, list)
}

/** All leave records (newest first). */
export function mockListLeaves() {
  return readLeaves().slice().sort((a, b) => b.startDate.localeCompare(a.startDate))
}

/** One employee's leave history, newest first. */
export function listLeavesFor(employeeId) {
  return mockListLeaves().filter((l) => l.employeeId === employeeId)
}

function leaveOn(employeeId, dateKey, status) {
  return readLeaves().find((l) => l.employeeId === employeeId && l.status === status && dateKey >= l.startDate && dateKey <= l.endDate) ?? null
}

/** The approved leave covering an employee on a date, or null. */
export function getApprovedLeave(employeeId, dateKey) {
  return leaveOn(employeeId, dateKey, 'approved')
}

/** A pending (not yet approved) leave request on a date, or null. */
export function getPendingLeave(employeeId, dateKey) {
  return leaveOn(employeeId, dateKey, 'pending')
}

/** Approved leave in progress today, or the next upcoming one. */
export function currentOrNextLeave(employeeId, today = accraTodayKey()) {
  const approved = readLeaves().filter((l) => l.employeeId === employeeId && l.status === 'approved' && l.endDate >= today)
  approved.sort((a, b) => a.startDate.localeCompare(b.startDate))
  const current = approved.find((l) => l.startDate <= today) ?? null
  return { current, next: current ? null : approved[0] ?? null }
}

/** Working days (company working days, not holidays) inside a date range. */
export function leaveWorkingDays(companyId, startDate, endDate) {
  if (!isDateKey(startDate) || !isDateKey(endDate) || endDate < startDate) return 0
  let n = 0
  for (let d = startDate, i = 0; d <= endDate && i <= MAX_DAYS; d = addDaysToKey(d, 1), i += 1) {
    if (isScheduledWorkday(defaultHoursFor(companyId, d).workingDays, d)) n += 1
  }
  return n
}

function overlapping(employeeId, startDate, endDate, ignoreId = null) {
  return readLeaves().find((l) => l.employeeId === employeeId && l.leaveId !== ignoreId && l.status !== 'cancelled' && l.startDate <= endDate && l.endDate >= startDate) ?? null
}

export function validateLeave({ employeeId, leaveType, startDate, endDate, notes }) {
  const errors = {}
  if (!LEAVE_TYPES.includes(leaveType)) errors.leaveType = 'Choose the type of leave.'
  if (!startDate) errors.startDate = 'Enter the first day of leave.'
  else if (!isDateKey(startDate)) errors.startDate = 'Enter a valid date.'
  if (!endDate) errors.endDate = 'Enter the last day of leave.'
  else if (!isDateKey(endDate)) errors.endDate = 'Enter a valid date.'
  if (!errors.startDate && !errors.endDate) {
    if (endDate < startDate) errors.endDate = 'The last day cannot be before the first day.'
    else if ((Date.parse(endDate) - Date.parse(startDate)) / 86400000 >= MAX_DAYS) errors.endDate = 'A single leave cannot be longer than a year.'
    else {
      const clash = employeeId ? overlapping(employeeId, startDate, endDate) : null
      if (clash) errors.startDate = `Overlaps ${clash.leaveType.toLowerCase()} from ${formatAccraDate(clash.startDate)} to ${formatAccraDate(clash.endDate)}.`
    }
  }
  if ((notes ?? '').length > 300) errors.notes = 'Keep notes under 300 characters.'
  return errors
}

function guard(actor, companyId) {
  if (!can(actor, 'employees', 'edit') || !canAccessCompany(actor, companyId)) return 'You are not authorised to record leave for this employee.'
  return null
}

function audit(action, leave, employee, actor, description, previous, next) {
  recordAuditEvent({
    source: 'Employees',
    action,
    category: 'Attendance',
    actor: { name: actor.name, role: actor.role },
    companyIds: [leave.companyId],
    affected: `${employee?.fullName ?? leave.employeeId} (${leave.employeeId})`,
    description,
    previous,
    next,
  })
}

const span = (l) => `${l.leaveType}: ${formatAccraDate(l.startDate)} – ${formatAccraDate(l.endDate)}`

/**
 * HR records leave. employee: { employeeId|staffId, companyId, fullName }.
 * Approved immediately; attendance for those days becomes "On leave".
 */
export function mockRecordLeave(employee, input, actor) {
  const employeeId = employee?.employeeId ?? employee?.staffId
  if (!employeeId || !employee.companyId) return { errors: { form: 'Employee not found.' } }
  const denied = guard(actor, employee.companyId)
  if (denied) return { errors: { form: denied } }
  const errors = validateLeave({ ...input, employeeId })
  if (Object.keys(errors).length) return { errors }
  const now = new Date().toISOString()
  const leave = {
    leaveId: `LV-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    employeeId,
    companyId: employee.companyId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    notes: (input.notes ?? '').trim(),
    status: 'approved',
    recordedBy: actor.name,
    recordedAt: now,
    history: [{ action: 'Recorded', by: actor.name, at: now, note: (input.notes ?? '').trim() }],
  }
  writeLeaves([...readLeaves(), leave])
  const days = leaveWorkingDays(leave.companyId, leave.startDate, leave.endDate)
  audit('Leave recorded', leave, employee, actor, `${days} working day${days === 1 ? '' : 's'}. These days show as On leave and are never absences.${leave.notes ? ` Notes: ${leave.notes}` : ''}`, { leave: 'None' }, { leave: span(leave) })
  return { leave }
}

/** The employee came back early: the leave now ends on `endDate`. */
export function mockEndLeaveEarly(leaveId, endDate, reason, actor, employee = null) {
  const list = readLeaves()
  const leave = list.find((l) => l.leaveId === leaveId)
  if (!leave) return { error: 'Leave not found.' }
  const denied = guard(actor, leave.companyId)
  if (denied) return { error: denied }
  if (leave.status !== 'approved') return { error: 'Only approved leave can be ended early.' }
  if (!isDateKey(endDate)) return { error: 'Enter the last day of leave.' }
  if (endDate < leave.startDate) return { error: 'The last day cannot be before the leave started. Cancel the leave instead.' }
  if (endDate >= leave.endDate) return { error: `The new last day must be before ${formatAccraDate(leave.endDate)}.` }
  if ((reason ?? '').trim().length < 3) return { error: 'Give a short reason.' }
  const before = span(leave)
  const now = new Date().toISOString()
  leave.history = [...(leave.history ?? []), { action: 'Ended early', by: actor.name, at: now, note: `${reason.trim()} (was until ${formatAccraDate(leave.endDate)})` }]
  leave.endDate = endDate
  writeLeaves(list)
  audit('Leave ended early', leave, employee, actor, reason.trim(), { leave: before }, { leave: span(leave) })
  return { leave }
}

/** Recorded by mistake: the leave is cancelled (kept in the history). */
export function mockCancelLeave(leaveId, reason, actor, employee = null) {
  const list = readLeaves()
  const leave = list.find((l) => l.leaveId === leaveId)
  if (!leave) return { error: 'Leave not found.' }
  const denied = guard(actor, leave.companyId)
  if (denied) return { error: denied }
  if (leave.status === 'cancelled') return { error: 'This leave is already cancelled.' }
  if ((reason ?? '').trim().length < 3) return { error: 'Give a short reason.' }
  const now = new Date().toISOString()
  const before = `${span(leave)} (${LEAVE_STATUS[leave.status].label})`
  leave.status = 'cancelled'
  leave.history = [...(leave.history ?? []), { action: 'Cancelled', by: actor.name, at: now, note: reason.trim() }]
  writeLeaves(list)
  audit('Leave cancelled', leave, employee, actor, `${reason.trim()} Those days count as normal working days again.`, { leave: before }, { leave: 'Cancelled' })
  return { leave }
}
