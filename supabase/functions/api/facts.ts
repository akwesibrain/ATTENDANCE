/** Loads stored facts and runs the shared rules over them on the server. */

import { accraDateKey } from '../_shared/rules/accraTime.js'
import {
  contextFromRows,
  correctionHistoryFromRow,
  employeeFromRow,
  rosterEntry,
  shopFromRow,
} from '../_shared/rules/facts.js'
import {
  detectCorrections, detectTrackingFlags, detectVisitIssues,
  detectFromRecord,
  detectFromRoster,
  planNotificationSync,
  scanDates,
} from '../_shared/rules/notifications.js'
import { buildRecords } from '../_shared/rules/records.js'
import { attendanceRulesInForce, composeSettings } from '../_shared/rules/settings.js'
import { allRows, ApiError, applyChange, db, must } from './lib.ts'
import { loadTrackingDays } from './trackingFacts.ts'
import { categoryForPosition } from '../_shared/rules/categories.js'

export { allRows }


/** Every matching row, however many pages that takes. */

export async function loadSettings() {
  const [general, companies, versions] = await Promise.all([
    allRows('settings_general', 'key'),
    allRows('settings_company', 'company_id'),
    allRows('settings_versions', 'id'),
  ])
  return composeSettings({ general, companies, versions })
}

type LoadOptions = { from: string; to: string; staffIds?: string[]; now?: Date }

/** The roster and record context for a date range. */
export async function loadFacts({ from, to, staffIds, now = new Date() }: LoadOptions) {
  // deno-lint-ignore no-explicit-any
  const inRange = (q: any) => {
    const ranged = q.gte('date', from).lte('date', to)
    return staffIds ? ranged.in('employee_id', staffIds) : ranged
  }
  const [settings, employeeRows, shops, events, corrections, correctionHistory, holidays, leaves, verifications] = await Promise.all([
    loadSettings(),
    // deno-lint-ignore no-explicit-any
    allRows('employees', 'staff_id', (q: any) => (staffIds ? q.in('staff_id', staffIds) : q)),
    allRows('shops', 'shop_id'),
    allRows('attendance_events', 'occurred_at', inRange),
    allRows('attendance_corrections', 'date', inRange),
    allRows('attendance_correction_history', 'changed_at', inRange),
    allRows('holidays', 'date'),
    // deno-lint-ignore no-explicit-any
    allRows('leave_records', 'start_date', (q: any) => {
      const ranged = q.lte('start_date', to).gte('end_date', from)
      return staffIds ? ranged.in('employee_id', staffIds) : ranged
    }),
    allRows('verification_events', 'dispatched_at', inRange),
  ])
  const ctx = contextFromRows(
    { events, corrections, correctionHistory, holidays, leaves, shops, verifications },
    settings,
    now,
  )
  const shopsById = new Map(shops.map((row) => [row.shop_id, shopFromRow(row)]))
  const roster = employeeRows.map((row) => rosterEntry(employeeFromRow(row), shopsById))
  return { settings, ctx, roster, shopsById }
}

/** Raise new notifications and note the ones whose condition has cleared. */
export async function syncNotifications(now = new Date()) {
  const today = accraDateKey(now)
  const dates = scanDates(today)
  const { settings, ctx, roster, shopsById } = await loadFacts({ from: dates[0], to: today, now })

  const issues: unknown[] = []
  const push = (issue: unknown) => issues.push(issue)
  const env = {
    rulesFor: (dateKey: string) => attendanceRulesInForce(settings, dateKey),
    repeatedThreshold: settings.monitoring.repeatedExceptionThreshold,
    nowMs: now.getTime(),
  }
  buildRecords(roster, dates, ctx).forEach((record: object) => detectFromRecord(record, push, env))
  roster.forEach((employee) => detectFromRoster(employee, push, shopsById))

  // Older entries raised their notification when they were saved.
  const since = new Date(now.getTime() - 8 * 86400000).toISOString()
  const history = await allRows(
    'attendance_correction_history',
    'changed_at',
    // deno-lint-ignore no-explicit-any
    (q: any) => q.gte('changed_at', since),
  )
  detectCorrections(history.map(correctionHistoryFromRow), push, new Map(roster.map((e) => [e.employeeId, e])))

  // Live tracking flags outlive the deleted trail, so alerts stay after the day.
  // deno-lint-ignore no-explicit-any
  const trackingFlags = await allRows('tracking_flags', 'date', (q: any) => q.gte('date', dates[0]).lte('date', today))
  detectTrackingFlags(trackingFlags, push, new Map(roster.map((e) => [e.employeeId, e])))

  // Shop visits against live tracking (Sales Reps and Supervisors), from the same facts as the daily report.
  const visitRecords = buildRecords(roster, dates, ctx)
    .map((r: { position: string }) => ({ ...r, category: categoryForPosition(r.position) }))
    .filter((r: { category: string }) => r.category === 'sales-rep' || r.category === 'supervisor')
  const visitDays = await loadTrackingDays(visitRecords, now)
  detectVisitIssues(visitDays.map((d) => ({ employee: d.record, date: d.record.date, dayOver: d.dayOver, proof: d.proof, shopNames: d.shopNames })), push)

  const [existing, reviews] = await Promise.all([
    allRows('notifications', 'id'),
    allRows('monitoring_alert_reviews', 'exception_id'),
  ])
  const plan = planNotificationSync({
    existing,
    issues,
    scannedDates: new Set(dates),
    preferences: settings.notifications,
    reviews: new Map(reviews.map((row) => [row.exception_id, row])),
    nowIso: now.toISOString(),
  })

  const ops = [
    ...plan.inserts.map((row) => ({ table: 'notifications', op: 'insert', row })),
    ...plan.updates.map(({ id, patch }) => ({ table: 'notifications', op: 'update', match: { id }, row: patch })),
    ...plan.history.map((row) => ({ table: 'notification_history', op: 'insert', row })),
  ]
  if (ops.length) {
    try {
      await applyChange(ops)
    } catch (error) {
      // Another run got there first and this one rolled back. Nothing is lost.
      if (error instanceof ApiError && error.extra.code === 'conflict') {
        return { added: 0, updated: 0, total: existing.length }
      }
      throw error
    }
  }
  return { added: plan.inserts.length, updated: plan.updates.length, total: existing.length + plan.inserts.length }
}
