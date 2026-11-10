/**
 * ============================================================================
 * MOCK NOTIFICATIONS & EXCEPTIONS SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * Raises in-app notifications from the data the other modules already hold:
 *
 *   - Attendance records (attendanceRecordsService): late, no clock-in,
 *     missing clock-out, incomplete records, unusual activity.
 *   - SMS verification events (salesMonitoringService): missed, delivery
 *     failed, face failed, GPS failed/unavailable, outside the geofence.
 *     Only events that have already happened; never future schedules.
 *   - Shop assignments: missing shop, inactive shop.
 *   - Data checks: historical records needing verification, duplicate
 *     check-in events, corrections, SMS activity without a clock-in.
 *
 * Duplicate prevention: every issue has a stable source key, and a
 * notification's ID is derived from it. A sync only adds keys it has not seen,
 * so refreshing or re-rendering never creates a second copy.
 *
 * History is append-only. Nothing is deleted; resolve and dismiss record who,
 * when, the action taken and the reason.
 *
 * Nothing is sent anywhere: no SMS, email or push. Notifications exist only
 * in this browser's mock storage. A notification never marks anyone absent
 * or applies discipline; HR reviews every exception.
 *
 * Replace with real API calls once the backend contract is defined. Do NOT
 * invent endpoints here.
 * ============================================================================
 */

import { getCompanyById } from '../constants/companies'
import {
  NOTIFICATION_TYPES,
  OPEN_STATUSES,
  SEVERITIES,
} from '../constants/notificationTypes'
import {
  canManageNotifications,
  canViewCompany,
  getHrUser,
} from '../constants/hrUser'
import {
  listAttendanceRecords,
  listAttendanceRoster,
  mockListAllCorrections,
} from './attendanceRecordsService'
import { mockGetAllEvents } from './attendanceService'
import { mockGetAlertReview, mockUpdateAlert } from './salesMonitoringService'
import { mockGetShop } from './shopsService'
import { DIGITAL_GO_LIVE_DATE } from '../utils/attendanceRules'
import { attendanceRulesFor, monitoringSettings, notificationPreferenceFor } from './settingsService'
import {
  accraDateKey,
  accraTodayKey,
  addDaysToKey,
  formatAccraDate,
  formatAccraTime,
} from '../utils/accraTime'

const STORE_KEY = 'mock-notifications:items'
const META_KEY = 'mock-notifications:meta'

/** How many days back (including today) a sync scans attendance. */
export const SCAN_DAYS = 7
/** Historical days (just before digital go-live) scanned for verification. */
export const HISTORICAL_REVIEW_DAYS = 10
/** A worked day longer than this is flagged as unusual. */
const LONG_SHIFT_MINUTES = 14 * 60

/* --------------------------------------------------------------------------
 * Persistence
 * ------------------------------------------------------------------------ */

function readJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore — mock persistence only.
  }
}

const readStore = () => readJson(STORE_KEY, {})
const writeStore = (store) => writeJson(STORE_KEY, store)

/** Stable notification ID for a source key (the duplicate-prevention key). */
export function notificationIdFor(sourceKey) {
  let h = 2166136261
  for (let i = 0; i < sourceKey.length; i += 1) {
    h ^= sourceKey.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `NTF-${(h >>> 0).toString(36).toUpperCase().padStart(7, '0')}`
}

/* --------------------------------------------------------------------------
 * Detection
 * ------------------------------------------------------------------------ */

const SALES_ALERT_TYPE = {
  missed: 'missed-verification',
  'sms-failed': 'sms-failed',
  'failed-face': 'failed-face',
  'outside-shop': 'outside-shop',
  'gps-unavailable': 'gps-unavailable',
}

function employeeFields(r) {
  return {
    employeeId: r.employeeId,
    employeeName: r.fullName,
    companyId: r.companyId,
    companyName: r.companyName || getCompanyById(r.companyId)?.name || '',
    position: r.position,
  }
}

function dayText(dateKey) {
  return formatAccraDate(dateKey, { weekday: 'short', day: 'numeric', month: 'short' })
}

function detectFromRecord(r, push) {
  const who = employeeFields(r)
  const day = dayText(r.date)
  const base = { ...who, relatedDate: r.date }

  // Historical records: only approved imports with Unknown values need a
  // verification request. Days with no imported entry raise nothing; they
  // are Unknown, never absences.
  if (r.date < DIGITAL_GO_LIVE_DATE) {
    if (r.historical && (r.status === 'unknown' || r.clockInUnknown || r.clockOutUnknown)) {
      const what = r.status === 'unknown'
        ? 'is unclear'
        : r.clockInUnknown && r.clockOutUnknown
          ? 'has no readable arrival or departure time'
          : r.clockInUnknown
            ? 'has no readable arrival time'
            : 'has no readable departure time'
      push({
        ...base,
        sourceKey: `historical:${r.employeeId}:${r.date}`,
        type: 'historical-verification',
        description: `The approved historical entry for ${r.fullName} on ${day} ${what} (notebook ${r.historical.notebookReference}${r.historical.pageReference ? `, page ${r.historical.pageReference}` : ''}). The value is shown as Unknown. Check the original notebook before relying on it.`,
        occurredAt: r.historical.approvedAt ?? r.expectedEnd,
        importBatchId: r.historical.batchId,
      })
    }
    return
  }

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

  if (r.status === 'absent' && !r.explicitAbsentReason) {
    push({
      ...base,
      sourceKey: `no-clock-in:${r.employeeId}:${r.date}`,
      type: 'no-clock-in',
      description: `${r.fullName} has no clock-in on ${day}. The working day ended at ${formatAccraTime(r.expectedEnd)} and there is no approved leave, so Attendance shows Absent. Confirm with the employee or supervisor before any action.`,
      occurredAt: r.expectedEnd,
    })
  }

  // Today: working day has ended, still clocked in, check-out window still open.
  if (r.atWork && Date.now() >= Date.parse(r.expectedEnd)) {
    push({
      ...base,
      sourceKey: `missing-clock-out:${r.employeeId}:${r.date}`,
      type: 'missing-clock-out',
      description: `${r.fullName}'s working day ended at ${formatAccraTime(r.expectedEnd)} but there is no clock-out yet. The check-out window stays open for ${attendanceRulesFor(r.date).clockOutWindowMinutes} minutes after the working day.`,
      occurredAt: r.expectedEnd,
    })
  }

  if (r.status === 'incomplete' && attendanceRulesFor(r.date).incompleteHandling === 'flag-and-notify') {
    push({
      ...base,
      sourceKey: `incomplete:${r.employeeId}:${r.date}`,
      type: 'incomplete-record',
      description: `${r.fullName} clocked in at ${formatAccraTime(r.clockIn)} on ${day} but never clocked out, so working hours cannot be calculated. Correct the record if the clock-out time can be confirmed.`,
      occurredAt: new Date(Date.parse(r.expectedEnd) + attendanceRulesFor(r.date).clockOutWindowMinutes * 60000).toISOString(),
    })
  }

  // Unusual activity
  if (r.explicitAbsentReason && r.source !== 'historical') {
    push({
      ...base,
      sourceKey: `unusual:face-attempts:${r.employeeId}:${r.date}`,
      type: 'unusual-activity',
      severity: 'critical',
      title: 'Repeated failed face scans at check-in',
      description: `${r.explicitAbsentReason} Someone may have tried to clock in with another person's Staff ID. Review before any action.`,
      occurredAt: r.scanEvents.find((e) => e.label.startsWith('Face verification'))?.at ?? r.expectedStart,
    })
  }
  const failedChecks = r.smsEvents.filter((e) => e.result === 'failed-face' || e.result === 'outside-shop')
  if (failedChecks.length >= monitoringSettings().repeatedExceptionThreshold) {
    push({
      ...base,
      sourceKey: `unusual:repeated-failures:${r.employeeId}:${r.date}`,
      type: 'unusual-activity',
      severity: 'critical',
      title: 'Repeated verification failures in one day',
      description: `${failedChecks.length} of ${r.fullName}'s SMS verification checks on ${day} failed (face or location). This needs HR review; it is not an automatic finding of misconduct.`,
      occurredAt: failedChecks[failedChecks.length - 1].respondedAt ?? failedChecks[failedChecks.length - 1].dispatchedAt,
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

  // SMS verification events (already happened; never future schedules).
  r.smsEvents.forEach((e) => {
    const n = e.verificationNumber
    const sent = formatAccraTime(e.dispatchedAt)
    const smsBase = {
      ...base,
      smsEventId: e.eventId,
      salesExceptionId: SALES_ALERT_TYPE[e.result]
        ? `${r.employeeId}:${r.date}:${SALES_ALERT_TYPE[e.result]}:${e.eventId}`
        : null,
      occurredAt: e.respondedAt ?? e.dispatchedAt,
    }
    const reviewNote = 'This is an exception for HR review. It is not an absence and not a finding of misconduct.'
    if (e.result === 'missed') {
      push({
        ...smsBase,
        sourceKey: `sms:${e.eventId}:missed`,
        type: 'sms-missed',
        description: `SMS verification ${n} for ${r.fullName} was delivered at ${sent} on ${day} but received no response. ${reviewNote}`,
      })
    } else if (e.result === 'sms-failed') {
      push({
        ...smsBase,
        sourceKey: `sms:${e.eventId}:sms-failed`,
        type: 'sms-delivery-failed',
        description: `SMS verification ${n} for ${r.fullName} at ${sent} on ${day} could not be delivered to the employee's phone. The employee could not respond to this check.`,
      })
    } else if (e.result === 'failed-face') {
      push({
        ...smsBase,
        sourceKey: `sms:${e.eventId}:failed-face`,
        type: 'face-failed',
        description: `${r.fullName} responded to SMS verification ${n} on ${day}, but the face check ${e.livenessStatus === 'failed' && e.faceVerificationStatus === 'passed' ? 'failed the liveness test' : 'did not match the enrolled photo'} (simulated result). ${reviewNote}`,
      })
    } else if (e.result === 'outside-shop') {
      push({
        ...smsBase,
        sourceKey: `sms:${e.eventId}:outside-shop`,
        type: 'outside-geofence',
        description: `${r.fullName}'s location for SMS verification ${n} on ${day} was ${e.distanceFromShop} m from ${r.shop?.shopName ?? 'the assigned shop'}, outside the ${r.shop?.geofenceRadius ?? 150} m geofence (simulated result). ${reviewNote}`,
      })
    } else if (e.result === 'gps-unavailable') {
      push({
        ...smsBase,
        sourceKey: `sms:${e.eventId}:gps-unavailable`,
        type: 'gps-failed',
        description: `${r.fullName} passed the face check for SMS verification ${n} on ${day}, but no location was received from the device, so GPS verification could not be completed.`,
      })
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

function detectFromRoster(emp, push) {
  const who = {
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    companyId: emp.companyId,
    companyName: emp.companyName,
    position: emp.position,
    relatedDate: null,
  }
  const since = emp.employmentStart ? `${emp.employmentStart}T08:00:00.000Z` : new Date().toISOString()

  if (emp.isFieldRole && !emp.shopId) {
    const isRep = emp.position.trim().toLowerCase() === 'sales representative'
    push({
      ...who,
      sourceKey: `no-shop:${emp.employeeId}`,
      type: isRep ? 'rep-no-shop' : 'no-shop-required',
      description: `${emp.fullName} (${emp.position}) has no assigned shop. Field roles need a shop so their location can be verified against its geofence. Assign one in Employees.`,
      occurredAt: since,
    })
  }
  if (emp.shopId) {
    const shop = mockGetShop(emp.shopId)
    if (shop && shop.status !== 'active') {
      push({
        ...who,
        sourceKey: `inactive-shop:${emp.employeeId}:${emp.shopId}`,
        type: 'inactive-shop',
        description: `${emp.fullName} is assigned to ${shop.shopName}, which is marked ${shop.status}. Reassign the employee to an active shop.`,
        occurredAt: since,
      })
    }
  }
  if (emp.kind === 'registered' && !emp.photo) {
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

function detectDuplicates(push, rosterById) {
  const seen = new Map()
  mockGetAllEvents().forEach((e) => {
    if (e.type !== 'check-in' && e.type !== 'check-out') return
    const key = `${e.staffId}:${e.date}:${e.type}`
    const list = seen.get(key) ?? []
    list.push(e)
    seen.set(key, list)
  })
  seen.forEach((list, key) => {
    if (list.length < 2) return
    const emp = rosterById.get(list[0].staffId)
    if (!emp) return
    const [, date, type] = key.split(':')
    push({
      employeeId: emp.employeeId,
      employeeName: emp.fullName,
      companyId: emp.companyId,
      companyName: emp.companyName,
      position: emp.position,
      relatedDate: date,
      sourceKey: `duplicate:${key}`,
      type: 'duplicate-record',
      description: `${list.length} ${type} events were recorded for ${emp.fullName} on ${dayText(date)} (${list.map((e) => formatAccraTime(e.time)).join(', ')}). Attendance uses the first one. Check which is correct.`,
      occurredAt: list[1].time,
    })
  })
}

function detectCorrections(push, rosterById) {
  const all = mockListAllCorrections()
  const batches = new Map()
  all.filter((c) => c.entryBatchId).forEach((c) => {
    const list = batches.get(c.entryBatchId) ?? []
    list.push(c)
    batches.set(c.entryBatchId, list)
  })
  batches.forEach((list, batchId) => {
    const emp = rosterById.get(list[0].employeeId)
    if (!emp) return
    const dates = list.map((c) => c.date).sort()
    const replaced = list.filter((c) => c.action === 'Manual entry replaced existing record').length
    push({
      employeeId: emp.employeeId,
      employeeName: emp.fullName,
      companyId: emp.companyId,
      companyName: emp.companyName,
      position: emp.position,
      relatedDate: dates.length === 1 ? dates[0] : null,
      correctionId: list[0].id,
      sourceKey: `manual-entry:${batchId}`,
      type: 'correction-submitted',
      title: replaced ? 'Manual attendance entered (records replaced)' : 'Manual attendance entered',
      description: `${list[0].changedBy} (${list[0].changedByRole}) entered ${list.length} attendance day${list.length === 1 ? '' : 's'} manually for ${emp.fullName}${dates.length ? ` (${dayText(dates[0])}${dates.length > 1 ? ` to ${dayText(dates[dates.length - 1])}` : ''})` : ''}.${replaced ? ` ${replaced} existing record${replaced === 1 ? ' was' : 's were'} replaced after review. Reason: ${list.find((c) => c.action === 'Manual entry replaced existing record').reason}` : ''}`,
      occurredAt: list[list.length - 1].changedAt,
    })
  })
  all.filter((c) => !c.entryBatchId).forEach((c) => {
    const emp = rosterById.get(c.employeeId)
    if (!emp) return
    const prevIn = c.previous.clockIn ? formatAccraTime(c.previous.clockIn) : c.previous.clockInUnknown ? 'Unknown' : 'none'
    const prevOut = c.previous.clockOut ? formatAccraTime(c.previous.clockOut) : c.previous.clockOutUnknown ? 'Unknown' : 'none'
    const newOut = c.next.clockOut ? formatAccraTime(c.next.clockOut) : 'none'
    push({
      employeeId: emp.employeeId,
      employeeName: emp.fullName,
      companyId: emp.companyId,
      companyName: emp.companyName,
      position: emp.position,
      relatedDate: c.date,
      correctionId: c.id,
      sourceKey: `correction:${c.id}`,
      type: 'correction-submitted',
      title: c.action === 'Manual record created' ? 'Attendance record created manually' : 'Attendance correction submitted',
      description: `${c.changedBy} (${c.changedByRole}) changed ${emp.fullName}'s attendance for ${dayText(c.date)}: in ${prevIn} → ${formatAccraTime(c.next.clockIn)}, out ${prevOut} → ${newOut}. Reason: ${c.reason}. Remarks: ${c.remarks}`,
      occurredAt: c.changedAt,
    })
  })
}

/** Scan the shared mock data and return every current issue (not saved). */
export function detectIssues() {
  const today = accraTodayKey()
  const recentDates = []
  for (let i = SCAN_DAYS - 1; i >= 0; i -= 1) recentDates.push(addDaysToKey(today, -i))
  const historicalDates = []
  for (let i = HISTORICAL_REVIEW_DAYS; i >= 1; i -= 1) {
    const d = addDaysToKey(DIGITAL_GO_LIVE_DATE, -i)
    if (d <= today) historicalDates.push(d)
  }

  const issues = []
  const push = (issue) => issues.push(issue)
  listAttendanceRecords({ companyId: null, dates: [...historicalDates, ...recentDates] }).forEach(
    (r) => detectFromRecord(r, push),
  )
  const roster = listAttendanceRoster(null)
  roster.forEach((emp) => detectFromRoster(emp, push))
  const rosterById = new Map(roster.map((e) => [e.employeeId, e]))
  detectDuplicates(push, rosterById)
  detectCorrections(push, rosterById)

  return { issues, scannedDates: new Set([...recentDates, ...historicalDates]) }
}

/* --------------------------------------------------------------------------
 * Sync (generation without duplicates)
 * ------------------------------------------------------------------------ */

const DATED_TYPES_CLEARABLE = new Set([
  'late-clock-in',
  'no-clock-in',
  'missing-clock-out',
  'incomplete-record',
  'historical-verification',
])
// Types whose source is re-checked in full on every sync (not date-windowed).
const ROSTER_TYPES = new Set([
  'rep-no-shop',
  'no-shop-required',
  'inactive-shop',
  'no-shift',
  'shift-review',
  'import-batch-submitted',
  'import-unmatched',
  'import-incomplete',
])

function historyEntry(action, by, note = '', extra = {}) {
  return {
    id: `H-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    action,
    by,
    note,
    ...extra,
  }
}

/** Configured severity (Settings → Notifications) or the type's default. */
function severityFor(issue, meta) {
  const pref = notificationPreferenceFor(issue.type)
  if (pref && pref.severity !== 'default') return pref.severity
  return issue.severity ?? meta.severity
}

function makeNotification(issue, now) {
  const meta = NOTIFICATION_TYPES[issue.type]
  return {
    id: notificationIdFor(issue.sourceKey),
    sourceKey: issue.sourceKey,
    type: issue.type,
    category: meta.category,
    kind: meta.kind,
    severity: severityFor(issue, meta),
    title: issue.title ?? meta.label,
    description: issue.description,
    employeeId: issue.employeeId,
    employeeName: issue.employeeName,
    companyId: issue.companyId,
    companyName: issue.companyName,
    position: issue.position,
    relatedDate: issue.relatedDate ?? null,
    smsEventId: issue.smsEventId ?? null,
    salesExceptionId: issue.salesExceptionId ?? null,
    correctionId: issue.correctionId ?? null,
    shiftId: issue.shiftId ?? null,
    importBatchId: issue.importBatchId ?? null,
    occurredAt: issue.occurredAt ?? now,
    createdAt: now,
    read: false,
    status: 'new',
    assignedTo: null,
    resolution: null,
    dismissal: null,
    conditionClearedAt: null,
    salesSyncedAt: null,
    history: [historyEntry('Notification created', 'System', 'Raised automatically from the mock data.')],
  }
}

/** Pull review decisions made in Sales Rep Monitoring's Alerts tab. */
function pullSalesReview(n) {
  if (!n.salesExceptionId) return
  const review = mockGetAlertReview(n.salesExceptionId)
  if (!review || !review.reviewedAt) return
  if (n.salesSyncedAt && review.reviewedAt <= n.salesSyncedAt) return
  n.salesSyncedAt = review.reviewedAt
  const by = 'HR (Sales Rep Monitoring)'
  if (review.status === 'resolved' && OPEN_STATUSES.includes(n.status)) {
    n.status = 'resolved'
    n.resolution = {
      actionTaken: 'Resolved in Sales Rep Monitoring',
      notes: review.resolutionNote || 'No note recorded.',
      by,
      at: review.reviewedAt,
    }
    n.history.push(historyEntry('Resolved', by, review.resolutionNote || 'Resolved from the Sales Rep Monitoring alerts list.'))
  } else if (review.status === 'under-review' && n.status !== 'under-review') {
    n.status = 'under-review'
    n.history.push(historyEntry('Status changed to Under Review', by, review.resolutionNote || ''))
  }
}

/**
 * Generate notifications from the shared mock data. Only issues whose source
 * key has not been seen are added, so calling this repeatedly never creates
 * duplicates. Open notifications whose condition is no longer detected get a
 * system note (once) but stay open for HR to close.
 * @returns {{ added: number, total: number, syncedAt: string }}
 */
export function mockSyncNotifications() {
  const store = readStore()
  const now = new Date().toISOString()
  const { issues, scannedDates } = detectIssues()
  const detected = new Set()
  let added = 0

  issues.forEach((issue) => {
    if (detected.has(issue.sourceKey)) return
    detected.add(issue.sourceKey)
    // Settings → Notifications: a disabled type is not raised from now on.
    // Notifications raised earlier are kept (never deleted).
    const pref = notificationPreferenceFor(issue.type)
    if (pref && !pref.enabled) return
    const id = notificationIdFor(issue.sourceKey)
    if (!store[id]) {
      store[id] = makeNotification(issue, now)
      added += 1
    }
  })

  Object.values(store).forEach((n) => {
    pullSalesReview(n)
    const inScope = ROSTER_TYPES.has(n.type) ||
      (DATED_TYPES_CLEARABLE.has(n.type) && n.relatedDate && scannedDates.has(n.relatedDate))
    if (inScope && OPEN_STATUSES.includes(n.status) && !detected.has(n.sourceKey) && !n.conditionClearedAt) {
      n.conditionClearedAt = now
      n.history.push(
        historyEntry(
          'Condition no longer detected',
          'System',
          'The underlying data has changed (for example the record was corrected or an assignment was made). Review and resolve if no further action is needed.',
        ),
      )
    }
  })

  writeStore(store)
  writeJson(META_KEY, { lastSyncedAt: now })
  return { added, total: Object.keys(store).length, syncedAt: now }
}

export function getLastSyncedAt() {
  return readJson(META_KEY, {}).lastSyncedAt ?? null
}

/* --------------------------------------------------------------------------
 * Reads (company-scoped)
 * ------------------------------------------------------------------------ */

function sortNotifications(a, b) {
  return b.occurredAt.localeCompare(a.occurredAt) ||
    SEVERITIES[a.severity].rank - SEVERITIES[b.severity].rank
}

// There is one HR account, so every enabled notification is visible to it.
function visibleToRole() {
  return true
}

/**
 * Notifications the user is authorised to see (their companies only), newest
 * first. Another company's notifications are never returned.
 */
export function mockListNotifications(user) {
  if (!user) return []
  return Object.values(readStore())
    .filter((n) => canViewCompany(user, n.companyId))
    .filter((n) => visibleToRole(n, user))
    .sort(sortNotifications)
}

/** One notification, or null if it does not exist or the user may not see it. */
export function mockGetNotification(id, user) {
  const n = readStore()[id]
  if (!n || !canViewCompany(user, n.companyId) || !visibleToRole(n, user)) return null
  return n
}

export function isOpen(n) {
  return OPEN_STATUSES.includes(n.status)
}

/** Needs HR attention: still open (New or Under Review) and Critical or High. */
export function requiresHrAttention(n) {
  return isOpen(n) && (n.severity === 'critical' || n.severity === 'high')
}

export function summariseNotifications(list) {
  return {
    total: list.length,
    unread: list.filter((n) => !n.read).length,
    critical: list.filter((n) => n.severity === 'critical' && isOpen(n)).length,
    pending: list.filter((n) => n.kind === 'exception' && isOpen(n)).length,
    resolved: list.filter((n) => n.kind === 'exception' && n.status === 'resolved').length,
    attention: list.filter(requiresHrAttention).length,
  }
}

/** Unread count for the top-bar bell. */
export function mockUnreadCount(user) {
  return mockListNotifications(user).filter((n) => !n.read).length
}

/** The Accra date (YYYY-MM-DD) of a notification's event, for date filters. */
export function notificationDateKey(n) {
  return accraDateKey(new Date(n.occurredAt))
}

/* --------------------------------------------------------------------------
 * HR actions — append-only history, company-scoped, permission-checked
 * ------------------------------------------------------------------------ */

function mutate(id, user, fn) {
  if (!canManageNotifications(user)) return { error: 'You are not authorised to act on notifications.' }
  const store = readStore()
  const n = store[id]
  if (!n || !canViewCompany(user, n.companyId) || !visibleToRole(n, user)) return { error: 'Notification not found.' }
  const error = fn(n)
  if (error) return { error }
  writeStore(store)
  return { notification: n }
}

/** Keep Sales Rep Monitoring's alert review in step with this one. */
function pushSalesReview(n, status, note) {
  if (!n.salesExceptionId) return
  const saved = mockUpdateAlert(n.salesExceptionId, { status, resolutionNote: note }, { audit: false })
  n.salesSyncedAt = saved?.reviewedAt ?? new Date().toISOString()
}

export function mockSetRead(id, read, user) {
  return mutate(id, user, (n) => {
    if (n.read === read) return null
    n.read = read
    n.history.push(historyEntry(read ? 'Marked as read' : 'Marked as unread', user.name))
    return null
  })
}

/** Mark every listed notification (that the user can see) as read. */
export function mockMarkAllRead(ids, user) {
  if (!canManageNotifications(user)) return { error: 'You are not authorised to act on notifications.', count: 0 }
  const store = readStore()
  let count = 0
  ids.forEach((id) => {
    const n = store[id]
    if (!n || n.read || !canViewCompany(user, n.companyId)) return
    n.read = true
    n.history.push(historyEntry('Marked as read', user.name, 'Mark all as read.'))
    count += 1
  })
  writeStore(store)
  return { count }
}

export function mockAssign(id, assigneeId, user) {
  const assignee = getHrUser(assigneeId)
  return mutate(id, user, (n) => {
    if (!assignee) return 'Choose who to assign.'
    if (!canViewCompany(assignee, n.companyId) || !canManageNotifications(assignee)) {
      return `${assignee.name} is not authorised for ${n.companyName}.`
    }
    if (n.assignedTo?.id === assignee.id) return `Already assigned to ${assignee.name}.`
    const previous = n.assignedTo?.name ?? 'Unassigned'
    n.assignedTo = { id: assignee.id, name: assignee.name, role: assignee.role }
    n.history.push(historyEntry('Assigned', user.name, `${previous} → ${assignee.name} (${assignee.role})`))
    return null
  })
}

export function mockAddComment(id, text, user) {
  const comment = (text ?? '').trim()
  return mutate(id, user, (n) => {
    if (comment.length < 3) return 'Write a comment first.'
    n.history.push(historyEntry('Comment', user.name, comment, { isComment: true }))
    return null
  })
}

export function mockStartReview(id, user, note = '') {
  return mutate(id, user, (n) => {
    if (n.status === 'under-review') return 'Already under review.'
    if (!isOpen(n)) return 'Reopen the notification first.'
    n.status = 'under-review'
    n.read = true
    n.history.push(historyEntry('Status changed to Under Review', user.name, note.trim()))
    pushSalesReview(n, 'under-review', note.trim())
    return null
  })
}

export function mockResolve(id, { actionTaken, notes }, user) {
  return mutate(id, user, (n) => {
    if (!isOpen(n)) return 'This notification is already closed.'
    if (!actionTaken) return 'Choose the action taken.'
    if ((notes ?? '').trim().length < 5) return 'Add resolution notes (at least 5 characters).'
    const at = new Date().toISOString()
    n.status = 'resolved'
    n.read = true
    n.resolution = { actionTaken, notes: notes.trim(), by: user.name, byRole: user.role, at }
    n.history.push(historyEntry('Resolved', user.name, `${actionTaken}: ${notes.trim()}`))
    pushSalesReview(n, 'resolved', `${actionTaken}: ${notes.trim()}`)
    return null
  })
}

export function mockDismiss(id, { reason }, user) {
  return mutate(id, user, (n) => {
    if (!isOpen(n)) return 'This notification is already closed.'
    if ((reason ?? '').trim().length < 5) return 'A reason is required to dismiss (at least 5 characters).'
    const at = new Date().toISOString()
    n.status = 'dismissed'
    n.read = true
    n.dismissal = { reason: reason.trim(), by: user.name, byRole: user.role, at }
    n.history.push(historyEntry('Dismissed', user.name, reason.trim()))
    pushSalesReview(n, 'resolved', `Dismissed in Notifications: ${reason.trim()}`)
    return null
  })
}

export function mockReopen(id, reason, user) {
  return mutate(id, user, (n) => {
    if (isOpen(n)) return 'This notification is already open.'
    if ((reason ?? '').trim().length < 5) return 'Say why it is being reopened (at least 5 characters).'
    n.status = 'under-review'
    n.history.push(historyEntry('Reopened', user.name, reason.trim()))
    pushSalesReview(n, 'under-review', `Reopened: ${reason.trim()}`)
    return null
  })
}
