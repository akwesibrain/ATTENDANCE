/**
 * Raises HR notifications from attendance, SMS and assignment data.
 *
 * Every issue has a stable source key, and a notification's ID is derived from
 * it, so running detection again never creates a second copy. A notification
 * never marks anyone absent or applies discipline; HR reviews every exception.
 */

import { addDaysToKey, formatAccraDate, formatAccraTime } from './accraTime.js'
import { DIGITAL_GO_LIVE_DATE } from './attendanceRules.js'
import { NOTIFICATION_TYPES, OPEN_STATUSES } from './notificationTypes.js'
import { notificationPreferenceFor } from './settings.js'

/** How many days back, including today, each run scans. */
export const SCAN_DAYS = 7
const LONG_SHIFT_MINUTES = 14 * 60

const SALES_ALERT_TYPE = {
  missed: 'missed-verification',
  'sms-failed': 'sms-failed',
  'failed-face': 'failed-face',
  'outside-shop': 'outside-shop',
  'gps-unavailable': 'gps-unavailable',
}

const DATED_TYPES_CLEARABLE = new Set(['late-clock-in', 'no-clock-in', 'missing-clock-out', 'incomplete-record'])
const ROSTER_TYPES = new Set(['rep-no-shop', 'no-shop-required', 'inactive-shop'])

/** Stable notification ID for a source key. */
export function notificationIdFor(sourceKey) {
  let h = 2166136261
  for (let i = 0; i < sourceKey.length; i += 1) {
    h ^= sourceKey.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `NTF-${(h >>> 0).toString(36).toUpperCase().padStart(7, '0')}`
}

export function scanDates(today) {
  return Array.from({ length: SCAN_DAYS }, (_, i) => addDaysToKey(today, i - SCAN_DAYS + 1))
}

const dayText = (dateKey) => formatAccraDate(dateKey, { weekday: 'short', day: 'numeric', month: 'short' })

function whoFrom(person) {
  return {
    employeeId: person.employeeId,
    employeeName: person.fullName,
    companyId: person.companyId,
    companyName: person.companyName,
    position: person.position,
  }
}

/**
 * @param {object} r an attendance record
 * @param {function} push receives each issue
 * @param {object} env { rulesFor(dateKey), repeatedThreshold, nowMs }
 */
export function detectFromRecord(r, push, env) {
  if (r.date < DIGITAL_GO_LIVE_DATE) return
  const day = dayText(r.date)
  const base = { ...whoFrom(r), relatedDate: r.date }
  const rules = env.rulesFor(r.date)

  if (r.isLate && r.clockIn) {
    push({
      ...base,
      sourceKey: `late:${r.employeeId}:${r.date}`,
      type: 'late-clock-in',
      severity: r.lateMinutes > 60 ? 'medium' : 'low',
      description: `${r.fullName} clocked in at ${formatAccraTime(r.clockIn)} on ${day}, ${r.lateMinutes} minutes after the ${formatAccraTime(r.expectedStart)} start (${r.schedule.graceMinutes} min grace).`,
      occurredAt: r.clockIn,
    })
  }

  if (r.status === 'absent' && !r.faceLockoutReason) {
    push({
      ...base,
      sourceKey: `no-clock-in:${r.employeeId}:${r.date}`,
      type: 'no-clock-in',
      description: `${r.fullName} has no clock-in on ${day}. The working day ended at ${formatAccraTime(r.expectedEnd)} and there is no approved leave, so Attendance shows Absent. Confirm with the employee or supervisor before any action.`,
      occurredAt: r.expectedEnd,
    })
  }

  if (r.atWork && env.nowMs >= Date.parse(r.expectedEnd)) {
    push({
      ...base,
      sourceKey: `missing-clock-out:${r.employeeId}:${r.date}`,
      type: 'missing-clock-out',
      description: `${r.fullName}'s working day ended at ${formatAccraTime(r.expectedEnd)} but there is no clock-out yet. The check-out window stays open for ${rules.clockOutWindowMinutes} minutes after the working day.`,
      occurredAt: r.expectedEnd,
    })
  }

  if (r.status === 'incomplete' && rules.incompleteHandling === 'flag-and-notify') {
    push({
      ...base,
      sourceKey: `incomplete:${r.employeeId}:${r.date}`,
      type: 'incomplete-record',
      description: `${r.fullName} clocked in at ${formatAccraTime(r.clockIn)} on ${day} but never clocked out, so working hours cannot be calculated. Correct the record if the clock-out time can be confirmed.`,
      occurredAt: new Date(Date.parse(r.expectedEnd) + rules.clockOutWindowMinutes * 60000).toISOString(),
    })
  }

  if (r.faceLockoutReason) {
    push({
      ...base,
      sourceKey: `unusual:face-attempts:${r.employeeId}:${r.date}`,
      type: 'unusual-activity',
      severity: 'critical',
      title: 'Repeated failed face scans at check-in',
      description: `${r.faceLockoutReason} Either someone tried to use ${r.fullName}'s Staff ID, or the camera could not recognise them. If ${r.fullName} was at work, add a manual entry for the day.`,
      occurredAt: r.scanEvents.find((e) => e.label.startsWith('Face verification'))?.at ?? r.expectedStart,
    })
  }

  const failedChecks = r.smsEvents.filter((e) => e.result === 'failed-face' || e.result === 'outside-shop')
  if (failedChecks.length >= env.repeatedThreshold) {
    const last = failedChecks[failedChecks.length - 1]
    push({
      ...base,
      sourceKey: `unusual:repeated-failures:${r.employeeId}:${r.date}`,
      type: 'unusual-activity',
      severity: 'critical',
      title: 'Repeated verification failures in one day',
      description: `${failedChecks.length} of ${r.fullName}'s SMS verification checks on ${day} failed (face or location). This needs HR review; it is not an automatic finding of misconduct.`,
      occurredAt: last.respondedAt ?? last.dispatchedAt,
    })
  }

  if (r.restDayWork) {
    push({
      ...base,
      sourceKey: `unusual:rest-day:${r.employeeId}:${r.date}`,
      type: 'unusual-activity',
      severity: 'low',
      title: r.holidayName ? 'Attendance on a public holiday' : 'Attendance on a rest day',
      description: `${r.fullName} clocked in on ${day}, which is ${r.holidayName ? `a public holiday (${r.holidayName})` : 'a weekend or rest day'}. Confirm the work was authorised (overtime).`,
      occurredAt: r.clockIn,
    })
  }

  if (r.workingMinutes && r.workingMinutes > LONG_SHIFT_MINUTES) {
    push({
      ...base,
      sourceKey: `unusual:long-day:${r.employeeId}:${r.date}`,
      type: 'unusual-activity',
      severity: 'medium',
      title: 'Unusually long working day',
      description: `${r.fullName} recorded ${Math.round(r.workingMinutes / 6) / 10} hours on ${day}. Check the clock-in and clock-out times.`,
      occurredAt: r.clockOut,
    })
  }

  const reviewNote = 'This is an exception for HR review. It is not an absence and not a finding of misconduct.'
  r.smsEvents.forEach((e) => {
    const n = e.verificationNumber
    const sent = formatAccraTime(e.dispatchedAt)
    const smsBase = {
      ...base,
      smsEventId: e.eventId,
      salesExceptionId: SALES_ALERT_TYPE[e.result] ? `${r.employeeId}:${r.date}:${SALES_ALERT_TYPE[e.result]}:${e.eventId}` : null,
      occurredAt: e.respondedAt ?? e.dispatchedAt,
    }
    if (e.result === 'missed') {
      push({ ...smsBase, sourceKey: `sms:${e.eventId}:missed`, type: 'sms-missed', description: `SMS verification ${n} for ${r.fullName} was delivered at ${sent} on ${day} but received no response. ${reviewNote}` })
    } else if (e.result === 'sms-failed') {
      push({ ...smsBase, sourceKey: `sms:${e.eventId}:sms-failed`, type: 'sms-delivery-failed', description: `SMS verification ${n} for ${r.fullName} at ${sent} on ${day} could not be delivered to the employee's phone. The employee could not respond to this check.` })
    } else if (e.result === 'failed-face') {
      push({ ...smsBase, sourceKey: `sms:${e.eventId}:failed-face`, type: 'face-failed', description: `${r.fullName} responded to SMS verification ${n} on ${day}, but the face check did not match the enrolled photo. ${reviewNote}` })
    } else if (e.result === 'outside-shop') {
      push({ ...smsBase, sourceKey: `sms:${e.eventId}:outside-shop`, type: 'outside-geofence', description: `${r.fullName}'s location for SMS verification ${n} on ${day} was ${e.distanceFromShop} m from ${r.shop?.shopName ?? 'the assigned shop'}, outside the ${r.shop?.geofenceRadius ?? 150} m geofence. ${reviewNote}` })
    } else if (e.result === 'gps-unavailable') {
      push({ ...smsBase, sourceKey: `sms:${e.eventId}:gps-unavailable`, type: 'gps-failed', description: `${r.fullName} passed the face check for SMS verification ${n} on ${day}, but no location was received from the device, so GPS verification could not be completed.` })
    }
  })

  if (!r.hasAttendance && r.smsEvents.some((e) => e.respondedAt)) {
    push({
      ...base,
      sourceKey: `unusual-data:sms-without-clock-in:${r.employeeId}:${r.date}`,
      type: 'unusual-data',
      title: 'SMS verification activity without a clock-in',
      description: `${r.fullName} responded to SMS verification checks on ${day} but has no clock-in for that day. One of the two records may be wrong.`,
      occurredAt: r.smsEvents.find((e) => e.respondedAt).respondedAt,
    })
  }
}

export function detectFromRoster(emp, push, shopsById) {
  // Someone who has left needs no shop and no further setup.
  if (emp.employmentEnd) return
  const who = { ...whoFrom(emp), relatedDate: null }
  const since = emp.employmentStart ? `${emp.employmentStart}T08:00:00.000Z` : null

  if (emp.isFieldRole && !emp.shopId) {
    push({
      ...who,
      sourceKey: `no-shop:${emp.employeeId}`,
      type: emp.position.trim().toLowerCase() === 'sales representative' ? 'rep-no-shop' : 'no-shop-required',
      description: `${emp.fullName} (${emp.position}) has no assigned shop. Field roles need a shop so their location can be verified against its geofence. Assign one in Employees.`,
      occurredAt: since,
    })
  }
  const shop = emp.shopId ? shopsById.get(emp.shopId) : null
  if (shop && shop.status !== 'active') {
    push({
      ...who,
      sourceKey: `inactive-shop:${emp.employeeId}:${emp.shopId}`,
      type: 'inactive-shop',
      description: `${emp.fullName} is assigned to ${shop.shopName}, which is marked ${shop.status}. Reassign the employee to an active shop.`,
      occurredAt: since,
    })
  }
  if (!emp.photoPath) {
    push({
      ...who,
      sourceKey: `unusual-data:no-face:${emp.employeeId}`,
      type: 'unusual-data',
      title: 'Employee record has no face photo',
      description: `${emp.fullName}'s employee record has no enrolled face photo, so face verification at check-in cannot work. Re-enrol the employee.`,
      occurredAt: since,
    })
  }
}

/** @param {Array} entries correction history, each with employeeId and date */
export function detectCorrections(entries, push, rosterById) {
  const batches = new Map()
  entries.filter((c) => c.entryBatchId).forEach((c) => {
    batches.set(c.entryBatchId, [...(batches.get(c.entryBatchId) ?? []), c])
  })
  batches.forEach((list, batchId) => {
    const emp = rosterById.get(list[0].employeeId)
    if (!emp) return
    const dates = list.map((c) => c.date).sort()
    const replacedEntries = list.filter((c) => c.action === 'Manual entry replaced existing record')
    const replaced = replacedEntries.length
    push({
      ...whoFrom(emp),
      relatedDate: dates.length === 1 ? dates[0] : null,
      correctionId: list[0].id,
      sourceKey: `manual-entry:${batchId}`,
      type: 'correction-submitted',
      title: replaced ? 'Manual attendance entered (records replaced)' : 'Manual attendance entered',
      description: `${list[0].changedBy} (${list[0].changedByRole}) entered ${list.length} attendance day${list.length === 1 ? '' : 's'} manually for ${emp.fullName} (${dayText(dates[0])}${dates.length > 1 ? ` to ${dayText(dates[dates.length - 1])}` : ''}).${replaced ? ` ${replaced} existing record${replaced === 1 ? ' was' : 's were'} replaced after review. Reason: ${replacedEntries[0].reason}` : ''}`,
      occurredAt: list[list.length - 1].changedAt,
    })
  })

  const clockText = (time, unknown) => (time ? formatAccraTime(time) : unknown ? 'Unknown' : 'none')
  entries.filter((c) => !c.entryBatchId).forEach((c) => {
    const emp = rosterById.get(c.employeeId)
    if (!emp) return
    push({
      ...whoFrom(emp),
      relatedDate: c.date,
      correctionId: c.id,
      sourceKey: `correction:${c.id}`,
      type: 'correction-submitted',
      title: c.action === 'Manual record created' ? 'Attendance record created manually' : 'Attendance correction submitted',
      description: `${c.changedBy} (${c.changedByRole}) changed ${emp.fullName}'s attendance for ${dayText(c.date)}: in ${clockText(c.previous.clockIn, c.previous.clockInUnknown)} → ${formatAccraTime(c.next.clockIn)}, out ${clockText(c.previous.clockOut, c.previous.clockOutUnknown)} → ${clockText(c.next.clockOut)}. Reason: ${c.reason}. Remarks: ${c.remarks}`,
      occurredAt: c.changedAt,
    })
  })
}

function notificationRow(issue, preferences, nowIso) {
  const meta = NOTIFICATION_TYPES[issue.type]
  const preference = notificationPreferenceFor(issue.type, preferences)
  return {
    id: notificationIdFor(issue.sourceKey),
    source_key: issue.sourceKey,
    type: issue.type,
    category: meta.category,
    kind: meta.kind,
    severity: preference && preference.severity !== 'default' ? preference.severity : issue.severity ?? meta.severity,
    title: issue.title ?? meta.label,
    description: issue.description,
    employee_id: issue.employeeId,
    employee_name: issue.employeeName,
    company_id: issue.companyId,
    company_name: issue.companyName,
    position: issue.position,
    related_date: issue.relatedDate ?? null,
    sms_event_id: issue.smsEventId ?? null,
    sales_exception_id: issue.salesExceptionId ?? null,
    correction_id: issue.correctionId ?? null,
    occurred_at: issue.occurredAt ?? nowIso,
    created_at: nowIso,
  }
}

/**
 * Work out what a run should write. Only unseen source keys are added. Open
 * notifications whose condition has gone get one system note and stay open for
 * HR to close.
 *
 * @param {object} input
 * @param {Array} input.existing notification rows
 * @param {Array} input.issues detected issues
 * @param {Set} input.scannedDates dates this run covered
 * @param {object} input.preferences Settings → Notifications
 * @param {Map} input.reviews alert exception ID -> monitoring_alert_reviews row
 * @param {string} input.nowIso
 * @returns {{ inserts: Array, updates: Array, history: Array }}
 */
export function planNotificationSync({ existing, issues, scannedDates, preferences, reviews, nowIso }) {
  const known = new Set(existing.map((row) => row.source_key))
  const detected = new Set()
  const inserts = []
  const updates = []
  const history = []
  const note = (row, action, by, text) => history.push({ notification_id: row.id, company_id: row.company_id, action, by, note: text })

  issues.forEach((issue) => {
    if (detected.has(issue.sourceKey)) return
    detected.add(issue.sourceKey)
    const preference = notificationPreferenceFor(issue.type, preferences)
    if ((preference && !preference.enabled) || known.has(issue.sourceKey)) return
    const row = notificationRow(issue, preferences, nowIso)
    inserts.push(row)
    note(row, 'Notification created', 'System', 'Raised automatically.')
  })

  existing.forEach((row) => {
    const patch = {}
    const review = row.sales_exception_id ? reviews.get(row.sales_exception_id) : null
    if (review && !(row.sales_synced_at && Date.parse(review.reviewed_at) <= Date.parse(row.sales_synced_at))) {
      const by = 'HR (Sales Rep Monitoring)'
      patch.sales_synced_at = review.reviewed_at
      if (review.status === 'resolved' && OPEN_STATUSES.includes(row.status)) {
        patch.status = 'resolved'
        patch.resolution = { actionTaken: 'Resolved in Sales Rep Monitoring', notes: review.resolution_note || 'No note recorded.', by, at: review.reviewed_at }
        note(row, 'Resolved', by, review.resolution_note || 'Resolved from the Sales Rep Monitoring alerts list.')
      } else if (review.status === 'under-review' && row.status !== 'under-review') {
        patch.status = 'under-review'
        note(row, 'Status changed to Under Review', by, review.resolution_note || '')
      }
    }

    const inScope = ROSTER_TYPES.has(row.type) ||
      (DATED_TYPES_CLEARABLE.has(row.type) && row.related_date && scannedDates.has(row.related_date))
    if (inScope && OPEN_STATUSES.includes(patch.status ?? row.status) && !detected.has(row.source_key) && !row.condition_cleared_at) {
      patch.condition_cleared_at = nowIso
      note(row, 'Condition no longer detected', 'System', 'The underlying data has changed (for example the record was corrected or an assignment was made). Review and resolve if no further action is needed.')
    }
    if (Object.keys(patch).length) updates.push({ id: row.id, patch })
  })

  return { inserts, updates, history }
}
