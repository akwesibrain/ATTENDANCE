import { describe, expect, it } from 'vitest'
import { contextFromRows, employeeFromRow, rosterEntry, shopFromRow } from '../supabase/functions/_shared/rules/facts.js'
import { checkGeofence, distanceMeters, scheduleCheckMinutes, verificationResult } from '../supabase/functions/_shared/rules/monitoring.js'
import { detectCorrections, detectFromRecord, detectFromRoster, notificationIdFor, planNotificationSync, scanDates } from '../supabase/functions/_shared/rules/notifications.js'
import { buildRecord } from '../supabase/functions/_shared/rules/records.js'
import { validateEmployeeDetails } from '../supabase/functions/_shared/rules/registration.js'
import { composeSettings, diffValues, hoursInForce, overtimeRateInForce, validateNotificationPrefs, validateOvertimeRate, validateWorkingHours } from '../supabase/functions/_shared/rules/settings.js'

const HOURS = { workingDays: [1, 2, 3, 4, 5], startTime: '08:00', lateAfter: '09:00', endTime: '17:00', overtimeStart: '17:01', breakStart: '12:30', breakMinutes: 0 }
const RULES = { graceMinutes: 60, clockOutWindowMinutes: 120, missingClockIn: 'absent-after-shift-end', incompleteHandling: 'flag-and-notify', minCorrectionRemarks: 10, correctionApproval: 'not-required' }
const version = (kind, company_id, effective_from, values) => ({ kind, company_id, effective_from, values, changed_by: 'Test', changed_at: '2026-01-01T00:00:00Z' })

const settings = composeSettings({
  general: [
    { key: 'general', value: { systemName: 'Workforce Pro' } },
    { key: 'monitoring', value: { repeatedExceptionThreshold: 2 } },
    { key: 'notifications', value: { 'late-arrivals': { enabled: false } } },
    { key: 'security', value: {} },
    { key: 'data', value: {} },
  ],
  companies: [{ company_id: 'double-a', profile: { displayName: 'Double A' }, vat_rate: '5.50', vat_updated_by: null, vat_updated_at: null }],
  versions: [
    version('attendance', null, '2000-01-01', RULES),
    version('working-hours', 'double-a', '2000-01-01', HOURS),
    version('working-hours', 'double-a', '2026-11-11', { ...HOURS, startTime: '07:00' }),
    version('pay', 'double-a', '2000-01-01', { overtimeRate: 60 }),
    version('pay', 'double-a', '2026-11-11', { overtimeRate: 75 }),
  ],
})

const employeeRow = {
  staff_id: 'DAA-0001', company_id: 'double-a', company_name: 'Double A', full_name: 'Ama Mensah', position: 'Warehouse Worker',
  payment_method: 'bank', phone: '', email: '', address: '', emergency_contact_name: '', emergency_contact_phone: '',
  assigned_shop_id: null, face_photo_path: 'double-a/x.jpg', joined_on: null, registered_at: '2026-10-05T09:00:00Z', status: 'ACTIVE',
}
const shop = {
  shop_id: 's1', company_id: 'double-a', shop_name: 'Melcom', town: 'Kumasi', area: 'Adum', address: '', latitude: 6.69, longitude: -1.62,
  location_source: 'manual', location_label: null, geofence_radius: 150, status: 'active',
}

function context(rows = {}, now = new Date('2026-11-10T20:00:00Z')) {
  return contextFromRows({ events: [], corrections: [], correctionHistory: [], holidays: [], leaves: [], shops: [shop], verifications: [], ...rows }, settings, now)
}

const roster = (row = employeeRow) => rosterEntry(employeeFromRow(row), new Map([['s1', shopFromRow(shop)]]))
const collect = (run) => {
  const issues = []
  run((issue) => issues.push(issue))
  return issues
}
const env = { rulesFor: () => RULES, repeatedThreshold: 2, nowMs: Date.parse('2026-11-10T20:00:00Z') }

describe('settings from rows', () => {
  it('keeps effective-dated versions apart', () => {
    expect(hoursInForce(settings, 'double-a', '2026-11-10').startTime).toBe('08:00')
    expect(hoursInForce(settings, 'double-a', '2026-11-11').startTime).toBe('07:00')
    expect(overtimeRateInForce(settings, 'double-a', '2026-11-10')).toBe(60)
    expect(overtimeRateInForce(settings, 'double-a', '2026-11-12')).toBe(75)
  })

  it('reads the VAT rate as a number and fills in notification defaults', () => {
    expect(settings.vat['double-a'].rate).toBe(5.5)
    expect(settings.notifications['late-arrivals'].enabled).toBe(false)
    expect(settings.notifications['face-failed'].enabled).toBe(true)
  })
})

describe('settings validation', () => {
  it('refuses backdated changes', () => {
    expect(validateOvertimeRate(70, '2026-11-09', '2026-11-10').effectiveFrom).toMatch(/backdated/)
    expect(validateWorkingHours(HOURS, '2026-11-10', '2026-11-10')).toEqual({})
  })

  it('accepts pesewas without rounding errors and refuses a third decimal', () => {
    expect(validateOvertimeRate(19.99, '2026-11-10', '2026-11-10')).toEqual({})
    expect(validateOvertimeRate(19.999, '2026-11-10', '2026-11-10').overtimeRate).toBeDefined()
  })

  it('refuses a working day that does not exist', () => {
    expect(validateWorkingHours({ ...HOURS, workingDays: [9] }, '2026-11-10', '2026-11-10').workingDays).toBeDefined()
  })

  it('refuses unknown notification groups', () => {
    expect(validateNotificationPrefs({ nope: {} }).nope).toBeDefined()
  })

  it('reports only what changed', () => {
    expect(diffValues({ a: 1, b: 2 }, { a: 1, b: 3 }).changed).toEqual(['b'])
  })

  it('refuses a future joining date', () => {
    expect(validateEmployeeDetails({ joinedOn: '2026-11-11' }, '2026-11-10').joinedOn).toMatch(/future/)
  })
})

describe('records from rows', () => {
  const eventRow = (type, at) => ({ id: type, employee_id: 'DAA-0001', full_name: 'Ama Mensah', company_id: 'double-a', company_name: 'Double A', type, status: 'on-time', date: '2026-11-09', occurred_at: at, weekend: false, overtime_hours: null })

  it('reads database timestamps into the same form corrections compare against', () => {
    const ctx = context({ events: [eventRow('check-in', '2026-11-09T08:00:00+00:00')] })
    expect(buildRecord(roster(), '2026-11-09', ctx).clockIn).toBe('2026-11-09T08:00:00.000Z')
  })

  it('applies a stored correction and keeps its history in order', () => {
    const ctx = context({
      events: [eventRow('check-in', '2026-11-09T08:00:00+00:00')],
      corrections: [{ employee_id: 'DAA-0001', date: '2026-11-09', manual_type: 'corrected', entry_method: 'correction', clock_in: '2026-11-09T07:45:00+00:00', clock_out: '2026-11-09T17:00:00+00:00' }],
      correctionHistory: [
        { id: '2', employee_id: 'DAA-0001', date: '2026-11-09', changed_at: '2026-11-10T10:00:00Z', action: 'Correction', previous: {}, next: {} },
        { id: '1', employee_id: 'DAA-0001', date: '2026-11-09', changed_at: '2026-11-10T09:00:00Z', action: 'Correction', previous: {}, next: {} },
      ],
    })
    expect(buildRecord(roster(), '2026-11-09', ctx).clockIn).toBe('2026-11-09T07:45:00.000Z')
    expect(ctx.corrections['DAA-0001:2026-11-09'].history.map((h) => h.id)).toEqual(['1', '2'])
  })

  it('applies an HR-set holiday', () => {
    expect(buildRecord(roster(), '2026-11-09', context({ holidays: [{ date: '2026-11-09', name: 'Declared day' }] })).status).toBe('holiday')
  })

  it('counts only a shop that exists, and only for field roles', () => {
    expect(roster({ ...employeeRow, assigned_shop_id: 's1' }).shopId).toBeNull()
    expect(roster({ ...employeeRow, position: 'Merchandiser', assigned_shop_id: 's1' }).shopId).toBe('s1')
    expect(roster({ ...employeeRow, position: 'Merchandiser', assigned_shop_id: 'gone' }).shopId).toBeNull()
  })
})

describe('geofence', () => {
  it('measures distance', () => {
    expect(distanceMeters(5.68486, -0.02419, 5.68486, -0.02419)).toBe(0)
    expect(distanceMeters(0, 0, 0, 1)).toBeGreaterThan(111000)
  })

  it('passes inside the radius and fails outside it', () => {
    const near = { latitude: 6.69, longitude: -1.62 }
    const far = { latitude: 6.7, longitude: -1.62 }
    expect(checkGeofence(near, shopFromRow(shop)).status).toBe('passed')
    expect(checkGeofence(far, shopFromRow(shop)).status).toBe('failed')
  })

  it('reports no position, or a shop with no location, as unavailable', () => {
    expect(checkGeofence({}, shopFromRow(shop)).status).toBe('unavailable')
    expect(checkGeofence({ latitude: 'x', longitude: 2 }, shopFromRow(shop)).status).toBe('unavailable')
    expect(checkGeofence({ latitude: 1, longitude: 2 }, { latitude: null }).status).toBe('unavailable')
  })

  it('ranks a failed face above location', () => {
    expect(verificationResult(false, 'passed')).toBe('failed-face')
    expect(verificationResult(true, 'failed')).toBe('outside-shop')
    expect(verificationResult(true, 'unavailable')).toBe('gps-unavailable')
    expect(verificationResult(true, 'passed')).toBe('verified')
    expect(verificationResult(true, 'not-required')).toBe('verified')
  })
})

describe('SMS schedule', () => {
  const span = [480, 1020]
  it('gives exactly three ascending times inside the working window', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999999, Math.random]) {
      const times = scheduleCheckMinutes(...span, random)
      expect(times).toHaveLength(3)
      expect(times[0]).toBeLessThan(times[1])
      expect(times[1]).toBeLessThan(times[2])
      expect(times[0]).toBeGreaterThanOrEqual(span[0])
      expect(times[2]).toBeLessThan(span[1])
    }
  })
})

describe('notification detection', () => {
  const absentRecord = () => buildRecord(roster(), '2026-11-09', context())

  it('raises one issue for an absence, with a stable key', () => {
    const issues = collect((push) => detectFromRecord(absentRecord(), push, env))
    expect(issues.map((i) => i.sourceKey)).toEqual(['no-clock-in:DAA-0001:2026-11-09'])
    expect(notificationIdFor(issues[0].sourceKey)).toBe(notificationIdFor('no-clock-in:DAA-0001:2026-11-09'))
  })

  it('never claims an SMS result was simulated', () => {
    const event = { event_id: 'e1', employee_id: 'DAA-0001', date: '2026-11-09', verification_number: 1, dispatched_at: '2026-11-09T10:00:00Z', responded_at: '2026-11-09T10:02:00Z', delivery_status: 'delivered', face_verification_status: 'failed', liveness_status: 'not-checked', gps_verification_status: 'passed', result: 'failed-face' }
    const field = roster({ ...employeeRow, position: 'Merchandiser', assigned_shop_id: 's1' })
    const issues = collect((push) => detectFromRecord(buildRecord(field, '2026-11-09', context({ verifications: [event] })), push, env))
    const face = issues.find((i) => i.type === 'face-failed')
    expect(face.description).not.toMatch(/simulated/)
    expect(face.salesExceptionId).toBe('DAA-0001:2026-11-09:failed-face:e1')
  })

  it('flags a field role with no shop', () => {
    const issues = collect((push) => detectFromRoster(roster({ ...employeeRow, position: 'Merchandiser' }), push, new Map()))
    expect(issues[0].type).toBe('no-shop-required')
  })

  it('groups a manual-entry batch into one notice', () => {
    const entry = (date) => ({ id: date, employeeId: 'DAA-0001', date, entryBatchId: 'MAN-1', action: 'Manual entry created', changedBy: 'HR', changedByRole: 'HR Manager', changedAt: '2026-11-10T10:00:00.000Z', previous: {}, next: {} })
    const issues = collect((push) => detectCorrections([entry('2026-11-09'), entry('2026-11-10')], push, new Map([['DAA-0001', roster()]])))
    expect(issues).toHaveLength(1)
    expect(issues[0].sourceKey).toBe('manual-entry:MAN-1')
  })

  it('scans seven days ending today', () => {
    const dates = scanDates('2026-11-10')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-11-04')
    expect(dates[6]).toBe('2026-11-10')
  })
})

describe('notification sync', () => {
  const issue = { sourceKey: 'no-clock-in:DAA-0001:2026-11-09', type: 'no-clock-in', description: 'x', employeeId: 'DAA-0001', employeeName: 'Ama', companyId: 'double-a', companyName: 'Double A', position: 'Clerk', relatedDate: '2026-11-09' }
  const base = { issues: [], existing: [], scannedDates: new Set(['2026-11-09']), preferences: settings.notifications, reviews: new Map(), nowIso: '2026-11-10T20:00:00.000Z' }
  const saved = { id: notificationIdFor(issue.sourceKey), source_key: issue.sourceKey, type: 'no-clock-in', status: 'new', related_date: '2026-11-09', company_id: 'double-a', condition_cleared_at: null, sales_exception_id: null }

  it('adds an unseen issue once, even if detected twice', () => {
    expect(planNotificationSync({ ...base, issues: [issue, issue] }).inserts).toHaveLength(1)
  })

  it('never adds a duplicate on a later run', () => {
    expect(planNotificationSync({ ...base, issues: [issue], existing: [saved] }).inserts).toHaveLength(0)
  })

  it('skips types HR turned off', () => {
    expect(planNotificationSync({ ...base, issues: [{ ...issue, sourceKey: 'late:x', type: 'late-clock-in' }] }).inserts).toHaveLength(0)
  })

  it('notes a cleared condition once and leaves the notification open', () => {
    const plan = planNotificationSync({ ...base, existing: [saved] })
    expect(plan.updates[0].patch).toEqual({ condition_cleared_at: base.nowIso })
    expect(plan.updates[0].patch.status).toBeUndefined()
    expect(planNotificationSync({ ...base, existing: [{ ...saved, condition_cleared_at: base.nowIso }] }).updates).toHaveLength(0)
  })

  it('leaves days outside the scan alone', () => {
    expect(planNotificationSync({ ...base, existing: [saved], scannedDates: new Set() }).updates).toHaveLength(0)
  })

  it('pulls a review made in Sales Rep Monitoring', () => {
    const row = { ...saved, type: 'sms-missed', sales_exception_id: 'x:y', sales_synced_at: null, related_date: null }
    const reviews = new Map([['x:y', { status: 'resolved', resolution_note: 'Checked', reviewed_at: '2026-11-10T19:00:00Z' }]])
    const plan = planNotificationSync({ ...base, existing: [row], reviews })
    expect(plan.updates[0].patch.status).toBe('resolved')
    expect(planNotificationSync({ ...base, existing: [{ ...row, sales_synced_at: '2026-11-10T19:00:00Z' }], reviews }).updates).toHaveLength(0)
  })
})
