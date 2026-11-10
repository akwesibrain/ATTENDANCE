/**
 * Daily attendance records, derived from stored facts by the shared rules.
 * HR corrections and manual entries are saved on the server.
 */

import { ATTENDANCE_SOURCE, ATTENDANCE_STATUS, VERIFICATION_STATUS } from '../constants/attendanceLabels'
import { canViewCompany } from '../constants/hrUser'
import { accraTodayKey, formatAccraDateTime, formatAccraTime } from '../utils/accraTime'
import {
  contextFromRows,
  employeeFromRow,
  rosterEntry,
  shopFromRow,
} from '../../supabase/functions/_shared/rules/facts.js'
import {
  buildRecord,
  buildRecords,
  correctionTimes,
  previewManualEntries as previewEntries,
  validateCorrection as validateCorrectionRules,
} from '../../supabase/functions/_shared/rules/records.js'
import { submit } from './backend/client'
import { cacheVersion, photoUrl, refresh, rows } from './backend/cache'
import { attendanceRulesFor, getSettings } from './settingsService'

export { recordKey, recordOrigin } from '../../supabase/functions/_shared/rules/records.js'

let memo = { key: null, context: null }

/** The record builder's input. Re-made when data changes or the clock moves on. */
export function recordContext() {
  const key = `${cacheVersion()}:${Math.floor(Date.now() / 30000)}`
  if (memo.key !== key) {
    memo = {
      key,
      context: contextFromRows({
        events: rows('attendance_events'),
        corrections: rows('attendance_corrections'),
        correctionHistory: rows('attendance_correction_history'),
        holidays: rows('holidays'),
        leaves: rows('leave_records'),
        shops: rows('shops'),
        verifications: rows('verification_events'),
      }, getSettings(), new Date()),
    }
  }
  return memo.context
}

/** Everyone whose attendance is tracked for a company, or all companies when null. */
export function listAttendanceRoster(companyId = null) {
  const shopsById = new Map(rows('shops').map((row) => [row.shop_id, shopFromRow(row)]))
  return rows('employees')
    .filter((row) => !companyId || row.company_id === companyId)
    .map((row) => {
      const entry = rosterEntry(employeeFromRow(row), shopsById)
      return { ...entry, photo: photoUrl(entry.photoPath) }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

/** Records over a list of dates, newest first. Future days are never listed. */
export function listAttendanceRecords({ companyId = null, dates }) {
  return buildRecords(listAttendanceRoster(companyId), dates, recordContext())
    .sort((a, b) => b.date.localeCompare(a.date) || a.fullName.localeCompare(b.fullName))
}

/** One employee's record for a date, or null. */
export function getAttendanceRecord(employeeId, dateKey) {
  if (!employeeId || !dateKey || dateKey > accraTodayKey()) return null
  const employee = listAttendanceRoster().find((e) => e.employeeId === employeeId)
  return employee ? buildRecord(employee, dateKey, recordContext()) : null
}

/** Summary counts. "present" is everyone who attended: on time, late or incomplete. */
export function summariseAttendance(records) {
  const s = { records: records.length, present: 0, absent: 0, late: 0, atWork: 0, onLeave: 0, incomplete: 0, unknown: 0, workingMinutes: 0 }
  records.forEach((r) => {
    if (r.hasAttendance) s.present += 1
    if (r.status === 'absent') s.absent += 1
    if (r.isLate) s.late += 1
    if (r.atWork) s.atWork += 1
    if (r.status === 'on-leave') s.onLeave += 1
    if (r.status === 'incomplete') s.incomplete += 1
    if (r.status === 'unknown') s.unknown += 1
    if (r.workingMinutes) s.workingMinutes += r.workingMinutes
  })
  s.totalHours = Math.round((s.workingMinutes / 60) * 10) / 10
  return s
}

/* --------------------------------------------------------------------------
 * HR corrections and manual entries
 * ------------------------------------------------------------------------ */

const AFTER_CORRECTION = ['attendance_corrections', 'attendance_correction_history', 'audit_events']

export function validateCorrection(input, record) {
  return validateCorrectionRules(input, record, { minRemarks: attendanceRulesFor().minCorrectionRemarks })
}

export function previewCorrectionTimes(input, record) {
  const { clockIn, clockOut } = correctionTimes(input, record)
  return { clockIn, clockOut }
}

/** @returns {Promise<{ record: object } | { errors: object }>} */
export async function saveAttendanceCorrection(input) {
  const result = await submit('/hr/attendance/corrections', { method: 'POST', body: input })
  if (result.errors) return result
  await refresh(...AFTER_CORRECTION)
  return { record: getAttendanceRecord(input.employeeId, input.date) }
}

/** Check manual entries for one employee without saving. Each row comes back with its state. */
export function previewManualEntries(employeeId, entries, user) {
  const employee = listAttendanceRoster().find((e) => e.employeeId === employeeId) ?? null
  const rowsOut = previewEntries(employee, entries, recordContext())
  if (employee && !canViewCompany(user, employee.companyId)) {
    return rowsOut.map((row) => ({ ...row, errors: { ...row.errors, form: "You are not authorised for this employee's company." } }))
  }
  return rowsOut
}

/** @returns {Promise<{ created, replaced, batchId } | { errors: object }>} */
export async function saveManualEntries({ employeeId, entries, replaceReason = '' }) {
  const result = await submit('/hr/attendance/manual-entries', {
    method: 'POST',
    body: {
      employeeId,
      replaceReason,
      entries: entries.map(({ date, clockInTime, clockOutTime, remarks, replace }) => ({ date, clockInTime, clockOutTime, remarks, replace })),
    },
  })
  if (result.errors) return result
  await refresh(...AFTER_CORRECTION)
  return result
}

/* --------------------------------------------------------------------------
 * CSV export
 * ------------------------------------------------------------------------ */

function hoursText(minutes) {
  if (minutes == null) return ''
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2)
}

function clockText(iso, unknown) {
  if (unknown) return 'Unknown'
  return iso ? formatAccraTime(iso) : ''
}

/** CSV text for a list of attendance records (Africa/Accra times). */
export function attendanceRecordsToCsv(records) {
  const header = [
    'Date',
    'Employee Name',
    'Employee ID',
    'Company',
    'Job Position',
    'Assigned Shop',
    'Working Hours Schedule',
    'Expected Start',
    'Expected End',
    'Clock-In',
    'Clock-Out',
    'Working Hours',
    'Attendance Status',
    'Late (minutes)',
    'Verification Status',
    'Attendance Source',
    'Record Source',
    'Manual Change',
    'Last Changed By',
    'Last Changed At',
    'Notes',
  ]
  const rows = records.map((r) => {
    const last = r.corrections[0]
    return [
      r.date,
      r.fullName,
      r.employeeId,
      r.companyName,
      r.position,
      r.shop?.shopName ?? (r.isFieldRole ? 'Not assigned' : 'Not applicable'),
      r.schedule.name,
      formatAccraTime(r.expectedStart),
      formatAccraTime(r.expectedEnd),
      clockText(r.clockIn, r.clockInUnknown),
      clockText(r.clockOut, r.clockOutUnknown),
      hoursText(r.workingMinutes),
      ATTENDANCE_STATUS[r.status]?.label ?? r.status,
      r.isLate ? r.lateMinutes : r.lateUnknown ? 'Unknown' : '',
      VERIFICATION_STATUS[r.verification]?.label ?? r.verification,
      ATTENDANCE_SOURCE[r.source]?.label ?? '',
      recordOrigin(r) ? `${recordOrigin(r).label} (${recordOrigin(r).detail})` : '',
      r.manualType === 'created' ? 'Manually created' : r.manualType === 'corrected' ? 'Corrected' : '',
      last ? last.changedBy : '',
      last ? formatAccraDateTime(last.changedAt) : '',
      r.notes.join(' '),
    ]
  })
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
