/**
 * HR routes. Every write checks the session and the company, validates on the
 * server, and saves together with its audit entry in one transaction.
 */

import { Hono } from 'npm:hono@4.6.14'
import type { Context } from 'npm:hono@4.6.14'
import { smsProvider } from '../_shared/smsSender.ts'
import { accraDateKey, formatAccraDate } from '../_shared/rules/accraTime.js'
import { normalizeStaffId } from '../_shared/rules/checkin.js'
import { formatShopCoordinates, shopFromRow } from '../_shared/rules/facts.js'
import { validateHoliday } from '../_shared/rules/holidays.js'
import { OPEN_STATUSES, RESOLUTION_ACTIONS } from '../_shared/rules/notificationTypes.js'
import { buildRecord, correctionTimes, previewManualEntries, recordKey, validateCorrection } from '../_shared/rules/records.js'
import { validateCoordinates, validateEmployeeDetails } from '../_shared/rules/registration.js'
import {
  attendanceRulesInForce,
  diffValues,
  NOTIFICATION_GROUPS,
  validateAttendanceRules,
  validateCompany,
  validateGeneral,
  validateMonitoring,
  validateNotificationPrefs,
  validateOvertimeRate,
  validateSecurity,
  validateVat,
  validateWorkingHours,
  versionFor,
} from '../_shared/rules/settings.js'
import { assertAllCompanies, assertCompany, type HrEnv, type HrUser, requireHr } from './auth.ts'
import { loadFacts, loadSettings, syncNotifications } from './facts.ts'
import { ApiError, applyChange, db, found, invalid, later, must, rateLimit, readJson } from './lib.ts'

export const hrRoutes = new Hono<HrEnv>()
hrRoutes.use('*', requireHr)

type Ctx = Context<HrEnv>
// deno-lint-ignore no-explicit-any
type RecordContext = any
// The rules are plain JavaScript, so a built record has no static type here.
type AttendanceRecord = Record<string, Record<string, unknown>>
const MAX_TEXT = 1000
const text = (value: unknown, max = MAX_TEXT) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const hasErrors = (errors: object) => Object.keys(errors).length > 0
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`
const NOTHING_CHANGED = { form: 'Nothing has changed.' }

function audit(hr: HrUser, fields: Record<string, unknown>) {
  return { actorName: hr.name, actorRole: hr.role, ...fields }
}

/* --------------------------------------------------------------------------
 * Session
 * ------------------------------------------------------------------------ */

hrRoutes.get('/me', (c) => c.json({ user: c.get('hr'), smsProvider: smsProvider() }))

hrRoutes.post('/signed-in', async (c) => {
  const hr = c.get('hr')
  await must(db.from('hr_users').update({ last_login_at: new Date().toISOString() }).eq('id', hr.id))
  await applyChange([], audit(hr, {
    source: 'HR Users & Permissions',
    action: 'Signed in',
    category: 'HR Users & Permissions',
    companyIds: hr.companyIds,
    affected: hr.name,
  }))
  return c.json({ ok: true })
})

/* --------------------------------------------------------------------------
 * Employees
 * ------------------------------------------------------------------------ */

async function employeeFor(c: Ctx, staffId: string) {
  const id = normalizeStaffId(staffId)
  const row = id ? await must(db.from('employees').select('*').eq('staff_id', id).maybeSingle()) : null
  if (!row) throw new ApiError(404, 'Employee not found.', { errors: { form: 'Employee not found.' } })
  assertCompany(c, row.company_id, 'You are not authorised to change this employee’s details.')
  return row
}

hrRoutes.patch('/employees/:staffId', async (c) => {
  const hr = c.get('hr')
  const emp = await employeeFor(c, c.req.param('staffId'))
  const body = await readJson(c)
  const values = {
    joinedOn: text(body.joinedOn, 10),
    emergencyContactName: text(body.emergencyContactName, 200),
    emergencyContactPhone: text(body.emergencyContactPhone, 40),
  }
  const errors = validateEmployeeDetails(values, accraDateKey())
  if (hasErrors(errors)) throw invalid(errors)

  const registered = accraDateKey(new Date(emp.registered_at))
  const previous = {
    joinedOn: emp.joined_on ?? registered,
    emergencyContactName: emp.emergency_contact_name,
    emergencyContactPhone: emp.emergency_contact_phone,
  }
  const labels = { joinedOn: 'date joined', emergencyContactName: 'emergency contact name', emergencyContactPhone: 'emergency contact phone' }
  const changed = (Object.keys(values) as (keyof typeof values)[])
    .filter((key) => values[key] !== previous[key] || (key === 'joinedOn' && !emp.joined_on))
  if (!changed.length) throw invalid(NOTHING_CHANGED)

  const show = (v: typeof values) => ({
    'Date joined': v.joinedOn ? formatAccraDate(v.joinedOn) : 'Not set',
    'Emergency contact name': v.emergencyContactName || 'Not given',
    'Emergency contact phone': v.emergencyContactPhone || 'Not given',
  })
  await applyChange([{
    table: 'employees',
    op: 'update',
    match: { staff_id: emp.staff_id },
    row: {
      joined_on: values.joinedOn,
      emergency_contact_name: values.emergencyContactName,
      emergency_contact_phone: values.emergencyContactPhone,
      details_updated_at: new Date().toISOString(),
      details_updated_by: hr.name,
    },
  }], audit(hr, {
    source: 'Employees',
    action: 'Employee details updated',
    category: 'Employee Management',
    companyIds: [emp.company_id],
    affected: `${emp.full_name} (${emp.staff_id})`,
    description: `Updated: ${changed.map((key) => labels[key]).join(', ')}.`,
    previous: show(previous),
    next: show(values),
  }))
  later(syncNotifications())
  return c.json({ ok: true })
})

hrRoutes.post('/employees/:staffId/shop', async (c) => {
  const hr = c.get('hr')
  const emp = await employeeFor(c, c.req.param('staffId'))
  const body = await readJson(c)
  const shop = await must(db.from('shops').select('*').eq('shop_id', text(body.shopId, 200)).maybeSingle())
  if (!shop || shop.company_id !== emp.company_id) throw new ApiError(400, 'Choose a shop from this employee’s company.')
  if (emp.assigned_shop_id === shop.shop_id) throw new ApiError(400, 'The employee is already assigned to this shop.')

  const now = new Date().toISOString()
  const previous = emp.assigned_shop_id
    ? await must(db.from('shops').select('*').eq('shop_id', emp.assigned_shop_id).maybeSingle())
    : null
  await applyChange([
    { table: 'shop_assignments', op: 'update', match: { employee_id: emp.staff_id, active: true }, row: { active: false } },
    {
      table: 'shop_assignments',
      op: 'insert',
      row: {
        company_id: emp.company_id,
        employee_id: emp.staff_id,
        shop_id: shop.shop_id,
        previous_shop_id: emp.assigned_shop_id,
        effective_date: now,
        assigned_at: now,
        assigned_by: hr.name,
        assigned_by_role: hr.role,
      },
    },
    { table: 'employees', op: 'update', match: { staff_id: emp.staff_id }, row: { assigned_shop_id: shop.shop_id } },
  ], audit(hr, {
    source: 'Employees',
    action: 'Employee shop assignment changed',
    category: 'Shifts & Shops',
    companyIds: [emp.company_id],
    affected: `${emp.full_name} (${emp.staff_id})`,
    description: `Effective ${now.slice(0, 10)}.`,
    previous: { shop: previous ? shopFromRow(previous).shopName : 'None' },
    next: { shop: shopFromRow(shop).shopName },
  }))
  later(syncNotifications())
  return c.json({ ok: true })
})

/* --------------------------------------------------------------------------
 * Attendance corrections and manual entries
 * ------------------------------------------------------------------------ */

function previousFrom(record: Record<string, unknown>) {
  return {
    clockIn: record.clockIn,
    clockOut: record.clockOut,
    clockInUnknown: record.clockInUnknown,
    clockOutUnknown: record.clockOutUnknown,
    source: record.source,
    status: record.status,
  }
}

function correctionAudit(hr: HrUser, emp: { companyId: string; fullName: string; employeeId: string }, date: string, action: string, manual: boolean, reason: string, remarks: string, previous: Record<string, unknown>, next: unknown) {
  const created = action === 'Manual record created' || action === 'Manual entry created'
  return audit(hr, {
    source: manual ? 'Attendance — Manual Entry' : 'Attendance',
    action: action === 'Manual entry replaced existing record'
      ? 'Attendance record replaced (manual entry)'
      : created
        ? manual ? 'Attendance record created (manual entry)' : 'Attendance record created'
        : 'Attendance record corrected',
    category: 'Attendance',
    companyIds: [emp.companyId],
    affected: `${emp.fullName} (${emp.employeeId}) · ${date}`,
    description: [reason, remarks].filter(Boolean).join('. '),
    previous: { clockIn: previous.clockIn, clockOut: previous.clockOut, status: previous.status },
    next,
  })
}

hrRoutes.post('/attendance/corrections', async (c) => {
  const hr = c.get('hr')
  const body = await readJson(c)
  const input = {
    employeeId: normalizeStaffId(body.employeeId) ?? '',
    date: text(body.date, 10),
    clockInTime: text(body.clockInTime, 5),
    clockOutTime: text(body.clockOutTime, 5),
    reason: text(body.reason, 200),
    remarks: text(body.remarks),
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw invalid({ date: 'Choose the attendance date.' })

  const now = new Date()
  const today = accraDateKey(now)
  const { ctx: facts, roster, settings } = await loadFacts({ from: input.date, to: input.date, staffIds: [input.employeeId], now })
  const ctx = facts as RecordContext
  const emp = roster[0]
  if (!emp) throw invalid({ employeeId: 'Choose an employee.' })
  assertCompany(c, emp.companyId, "You are not authorised for this employee's company.")

  const record: AttendanceRecord | null = input.date <= today ? buildRecord(emp, input.date, ctx) as RecordContext : null
  const minRemarks = attendanceRulesInForce(settings, today).minCorrectionRemarks
  const errors = validateCorrection(input, record, { minRemarks, today, nowMs: now.getTime() })
  if (hasErrors(errors) || !record) throw invalid(errors)

  const { clockIn, clockOut } = correctionTimes(input, record)
  const existing = ctx.corrections[recordKey(emp.employeeId, input.date)] ?? null
  const hadOriginal = Boolean(record.original.clockIn) || record.original.presentMarked
  const manualType = existing?.manualType ?? (hadOriginal ? 'corrected' : 'created')
  const action = existing || manualType !== 'created' ? 'Correction' : 'Manual record created'
  const previous = previousFrom(record)
  const stamp = now.toISOString()

  await applyChange([
    {
      table: 'attendance_corrections',
      op: 'upsert',
      conflict: ['employee_id', 'date'],
      row: {
        employee_id: emp.employeeId,
        date: input.date,
        company_id: emp.companyId,
        manual_type: manualType,
        entry_method: existing?.entryMethod ?? 'correction',
        clock_in: clockIn,
        clock_out: clockOut,
        updated_at: stamp,
      },
    },
    {
      table: 'attendance_correction_history',
      op: 'insert',
      row: {
        id: newId('COR'),
        employee_id: emp.employeeId,
        date: input.date,
        company_id: emp.companyId,
        action,
        changed_at: stamp,
        changed_by: hr.name,
        changed_by_role: hr.role,
        reason: input.reason,
        remarks: input.remarks,
        manual_type: manualType,
        previous,
        next: { clockIn, clockOut },
      },
    },
  ], correctionAudit(hr, emp, input.date, action, false, input.reason, input.remarks, previous, { clockIn, clockOut }))
  later(syncNotifications())
  return c.json({ ok: true })
})

const MAX_MANUAL_ROWS = 62

hrRoutes.post('/attendance/manual-entries', async (c) => {
  const hr = c.get('hr')
  const body = await readJson(c)
  const employeeId = normalizeStaffId(body.employeeId) ?? ''
  const replaceReason = text(body.replaceReason)
  const entries = (Array.isArray(body.entries) ? body.entries : []).map((e: Record<string, unknown>) => ({
    date: text(e?.date, 10),
    clockInTime: text(e?.clockInTime, 5),
    clockOutTime: text(e?.clockOutTime, 5),
    remarks: text(e?.remarks, 301),
    replace: e?.replace === true,
  }))
  if (!entries.length) throw invalid({ form: 'Add at least one attendance date.' })
  if (entries.length > MAX_MANUAL_ROWS) throw invalid({ form: `Enter at most ${MAX_MANUAL_ROWS} dates at a time.` })

  const valid = entries.map((e) => e.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (!valid.length) throw invalid({ form: 'Choose a date.' })
  const now = new Date()
  const { ctx: facts, roster } = await loadFacts({ from: valid[0], to: valid[valid.length - 1], staffIds: [employeeId], now })
  const ctx = facts as RecordContext
  const emp = roster[0]
  if (!emp) throw invalid({ form: 'Choose an employee.' })
  assertCompany(c, emp.companyId, "You are not authorised for this employee's company.")

  const rows = previewManualEntries(emp, entries, ctx)
  const invalidRows = rows.filter((r: { errors: object }) => hasErrors(r.errors))
  if (invalidRows.length) {
    throw invalid({ form: invalidRows[0].errors.form ?? `Fix ${invalidRows.length} row${invalidRows.length === 1 ? '' : 's'} before saving.` })
  }
  const needsReview = rows.filter((r: { state: string; replace: boolean }) => r.state.startsWith('exists') && !r.replace)
  if (needsReview.length) {
    throw invalid({ form: `${needsReview.length} date${needsReview.length === 1 ? ' already has' : 's already have'} an attendance record. Review each one and tick “Replace” to overwrite it, or remove the date.` })
  }
  const replacing = rows.filter((r: { state: string }) => r.state.startsWith('exists'))
  if (replacing.length && replaceReason.length < 10) {
    throw invalid({ replaceReason: 'Give a reason for replacing existing records (at least 10 characters).' })
  }

  const batchId = newId('MAN')
  const stamp = now.toISOString()
  const ops: unknown[] = []
  const audits: unknown[] = []
  rows.forEach((r: { date: string; state: string; remarks: string; record: Record<string, Record<string, unknown>> }) => {
    const { clockIn, clockOut } = correctionTimes(r, r.record)
    const existing = ctx.corrections[recordKey(employeeId, r.date)] ?? null
    const isReplace = r.state.startsWith('exists')
    const hadOriginal = Boolean(r.record.original.clockIn) || r.record.original.presentMarked
    const manualType = existing?.manualType ?? (hadOriginal ? 'corrected' : 'created')
    const action = isReplace ? 'Manual entry replaced existing record' : 'Manual entry created'
    const reason = isReplace ? replaceReason : 'Manual attendance entry'
    const previous = previousFrom(r.record)
    ops.push(
      {
        table: 'attendance_corrections',
        op: 'upsert',
        conflict: ['employee_id', 'date'],
        row: { employee_id: employeeId, date: r.date, company_id: emp.companyId, manual_type: manualType, entry_method: 'manual-entry', clock_in: clockIn, clock_out: clockOut, updated_at: stamp },
      },
      {
        table: 'attendance_correction_history',
        op: 'insert',
        row: {
          id: newId('COR'),
          employee_id: employeeId,
          date: r.date,
          company_id: emp.companyId,
          action,
          changed_at: stamp,
          changed_by: hr.name,
          changed_by_role: hr.role,
          reason,
          remarks: r.remarks,
          entry_method: 'manual-entry',
          entry_batch_id: batchId,
          manual_type: manualType,
          previous,
          next: { clockIn, clockOut },
        },
      },
    )
    audits.push(correctionAudit(hr, emp, r.date, action, true, reason, r.remarks, previous, { clockIn, clockOut }))
  })
  await applyChange(ops, audits)
  later(syncNotifications())
  return c.json({ created: rows.length - replacing.length, replaced: replacing.length, batchId })
})

/* --------------------------------------------------------------------------
 * Holidays
 * ------------------------------------------------------------------------ */

function formatDay(dateKey: string) {
  return formatAccraDate(dateKey, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

hrRoutes.post('/holidays', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const body = await readJson(c)
  const date = text(body.date, 10)
  const name = text(body.name, 200)
  const custom = await must(db.from('holidays').select('id, date, name')) ?? []
  const errors = validateHoliday({ date, name }, custom)
  if (hasErrors(errors)) throw invalid(errors)

  const holiday = { id: `hol-${crypto.randomUUID()}`, date, name, created_by: hr.name }
  await applyChange([{ table: 'holidays', op: 'insert', row: holiday }], audit(hr, {
    source: 'Settings',
    action: 'Holiday added',
    category: 'System Settings',
    companyIds: [],
    affected: `${name} — ${formatDay(date)}`,
    description: 'Applies to Box For Less and Double A. Not a working day; time worked counts as overtime.',
    previous: { holiday: 'None' },
    next: { holiday: name, date },
  }))
  later(syncNotifications())
  return c.json({ holiday: { id: holiday.id, date, name, createdBy: hr.name } }, 201)
})

hrRoutes.delete('/holidays/:id', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const holiday = await must(db.from('holidays').select('*').eq('id', c.req.param('id')).maybeSingle())
  if (!holiday) throw new ApiError(404, 'Only holidays set by HR can be removed.')
  await applyChange([{ table: 'holidays', op: 'delete', match: { id: holiday.id } }], audit(hr, {
    source: 'Settings',
    action: 'Holiday removed',
    category: 'System Settings',
    companyIds: [],
    affected: `${holiday.name} — ${formatDay(holiday.date)}`,
    description: 'The date is a normal working day again.',
    previous: { holiday: holiday.name, date: holiday.date },
    next: { holiday: 'None' },
  }))
  later(syncNotifications())
  return c.json({ ok: true })
})

/* --------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------ */

const settingsAudit = (hr: HrUser, action: string, companyIds: string[], affected: string, description: string, change: { previous: unknown; next: unknown }) =>
  audit(hr, { action, category: 'System Settings', companyIds, affected, description, previous: change.previous, next: change.next })

function sectionChange(key: string, value: unknown, hr: HrUser) {
  return {
    table: 'settings_general',
    op: 'upsert',
    conflict: ['key'],
    row: { key, value, updated_at: new Date().toISOString(), updated_by: hr.name },
  }
}

const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

function logoValue(value: unknown, fallback: unknown) {
  if (value === undefined) return fallback ?? null
  if (value === null) return null
  if (typeof value === 'string' && value.length <= 700_000 && LOGO.test(value)) return value
  throw invalid({ logo: 'Use a PNG, JPEG or WebP image under 500 KB.' })
}

hrRoutes.put('/settings/general', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const body = await readJson(c)
  const values = {
    systemName: text(body.systemName, 80),
    description: text(body.description, 241),
    language: text(body.language, 10),
    dateFormat: text(body.dateFormat, 20),
    timeFormat: text(body.timeFormat, 4),
    landingPage: text(body.landingPage, 20),
  }
  const errors = validateGeneral(values)
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const next = { ...settings.general, ...values, logo: logoValue(body.logo, settings.general.logo) }
  const change = diffValues(settings.general, next)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  await applyChange([sectionChange('general', next, hr)], settingsAudit(hr, 'General settings changed', [], 'General settings', `Changed: ${change.changed.join(', ')}`, change))
  return c.json({ ok: true })
})

hrRoutes.put('/settings/company/:companyId', async (c) => {
  const hr = c.get('hr')
  const companyId = c.req.param('companyId')
  assertCompany(c, companyId, 'You are not authorised to change this company’s settings.')
  const body = await readJson(c)
  const values = {
    displayName: text(body.displayName, 80),
    code: text(body.code, 5),
    phone: text(body.phone, 40),
    email: text(body.email, 200),
    address: text(body.address, 300),
    status: text(body.status, 10),
  }
  const errors = validateCompany(values)
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const previous = settings.companies[companyId]
  if (!previous) throw new ApiError(404, 'Company not found.')
  const next = { ...previous, ...values, logo: logoValue(body.logo, previous.logo) }
  const change = diffValues(previous, next)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  await applyChange(
    [{ table: 'settings_company', op: 'update', match: { company_id: companyId }, row: { profile: next } }],
    settingsAudit(hr, 'Company settings changed', [companyId], next.displayName, `Changed: ${change.changed.join(', ')}. Employee IDs and attendance records are unchanged.`, change),
  )
  return c.json({ ok: true })
})

async function saveVersion(kind: string, companyId: string | null, effectiveFrom: string, values: unknown, hr: HrUser) {
  let query = db.from('settings_versions').select('id').eq('kind', kind).eq('effective_from', effectiveFrom)
  query = companyId ? query.eq('company_id', companyId) : query.is('company_id', null)
  const existing = await must(query.maybeSingle())
  const row = { values, changed_by: hr.name, changed_at: new Date().toISOString() }
  return existing
    ? { table: 'settings_versions', op: 'update', match: { id: existing.id }, row }
    : { table: 'settings_versions', op: 'insert', row: { kind, company_id: companyId, effective_from: effectiveFrom, ...row } }
}

hrRoutes.put('/settings/attendance', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const body = await readJson(c)
  const effectiveFrom = text(body.effectiveFrom, 10)
  const v = (body.values ?? {}) as Record<string, unknown>
  const errors = validateAttendanceRules(v, effectiveFrom, accraDateKey())
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const previous = versionFor(settings.attendanceVersions, effectiveFrom).values
  const next = {
    ...previous,
    graceMinutes: Number(v.graceMinutes),
    clockOutWindowMinutes: Number(v.clockOutWindowMinutes),
    minCorrectionRemarks: Number(v.minCorrectionRemarks),
    missingClockIn: v.missingClockIn,
    incompleteHandling: v.incompleteHandling,
    correctionApproval: v.correctionApproval,
  }
  const change = diffValues(previous, next)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  await applyChange(
    [await saveVersion('attendance', null, effectiveFrom, next, hr)],
    settingsAudit(hr, 'Attendance rules changed', [], 'Attendance rules', `Effective from ${effectiveFrom}. Changed: ${change.changed.join(', ')}. Earlier attendance keeps the rules in force at the time.`, change),
  )
  later(syncNotifications())
  return c.json({ ok: true })
})

hrRoutes.put('/settings/working-hours/:companyId', async (c) => {
  const hr = c.get('hr')
  const companyId = c.req.param('companyId')
  assertCompany(c, companyId, 'You are not authorised to change this company’s working hours.')
  const body = await readJson(c)
  const effectiveFrom = text(body.effectiveFrom, 10)
  const v = (body.values ?? {}) as Record<string, unknown>
  const errors = validateWorkingHours(v, effectiveFrom, accraDateKey())
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const versions = settings.workingHoursVersions[companyId]
  if (!versions) throw new ApiError(404, 'Company not found.')
  const previous = versionFor(versions, effectiveFrom).values
  const next = {
    workingDays: [...new Set(v.workingDays as number[])].sort((a, b) => a - b),
    startTime: v.startTime,
    lateAfter: v.lateAfter,
    endTime: v.endTime,
    overtimeStart: v.overtimeStart,
    breakStart: v.breakStart,
    breakMinutes: Number(v.breakMinutes),
  }
  const change = diffValues(previous, next)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  await applyChange(
    [await saveVersion('working-hours', companyId, effectiveFrom, next, hr)],
    settingsAudit(hr, 'Working hours changed', [companyId], `${settings.companies[companyId].displayName} default hours`, `Effective from ${effectiveFrom}.`, change),
  )
  later(syncNotifications())
  return c.json({ ok: true })
})

hrRoutes.put('/settings/overtime/:companyId', async (c) => {
  const hr = c.get('hr')
  const companyId = c.req.param('companyId')
  assertCompany(c, companyId, 'You are not authorised to change this company’s overtime rate.')
  const body = await readJson(c)
  const effectiveFrom = text(body.effectiveFrom, 10)
  const errors = validateOvertimeRate(body.rate, effectiveFrom, accraDateKey())
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const versions = settings.payVersions[companyId]
  if (!versions) throw new ApiError(404, 'Company not found.')
  const previous = versionFor(versions, effectiveFrom).values
  const next = { overtimeRate: Number(body.rate) }
  if (previous.overtimeRate === next.overtimeRate) throw invalid(NOTHING_CHANGED)
  await applyChange(
    [await saveVersion('pay', companyId, effectiveFrom, next, hr)],
    settingsAudit(hr, 'Overtime rate changed', [companyId], `${settings.companies[companyId].displayName} overtime rate`, `GH₵${previous.overtimeRate} → GH₵${next.overtimeRate} per hour, effective ${effectiveFrom}. Earlier days keep the rate in force at the time.`, { previous: { overtimeRate: previous.overtimeRate }, next }),
  )
  return c.json({ ok: true })
})

hrRoutes.put('/settings/vat/:companyId', async (c) => {
  const hr = c.get('hr')
  const companyId = c.req.param('companyId')
  assertCompany(c, companyId, 'You are not authorised to change this company’s VAT rate.')
  const body = await readJson(c)
  const errors = validateVat(body.rate)
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  if (!settings.vat[companyId]) throw new ApiError(404, 'Company not found.')
  const previous = settings.vat[companyId].rate
  const next = Number(body.rate)
  if (previous === next) throw invalid(NOTHING_CHANGED)
  await applyChange(
    [{ table: 'settings_company', op: 'update', match: { company_id: companyId }, row: { vat_rate: next, vat_updated_by: hr.name, vat_updated_at: new Date().toISOString() } }],
    settingsAudit(hr, 'VAT rate changed', [companyId], `${settings.companies[companyId].displayName} VAT`, `${previous}% → ${next}%. VAT is a separate tax setting and is not deducted from overtime pay.`, { previous: { vatRate: previous }, next: { vatRate: next } }),
  )
  return c.json({ ok: true })
})

hrRoutes.put('/settings/monitoring', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const v = await readJson(c)
  const errors = validateMonitoring(v)
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const next = {
    ...settings.monitoring,
    defaultGeofenceRadius: Number(v.defaultGeofenceRadius),
    responseWindowMinutes: Number(v.responseWindowMinutes),
    repeatedExceptionThreshold: Number(v.repeatedExceptionThreshold),
    faceRequired: Boolean(v.faceRequired),
    gpsRequired: Boolean(v.gpsRequired),
    smsEnabled: Boolean(v.smsEnabled),
    locationProvider: v.locationProvider ?? settings.monitoring.locationProvider ?? 'none',
  }
  const change = diffValues(settings.monitoring, next)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  await applyChange([sectionChange('monitoring', next, hr)], settingsAudit(hr, 'Monitoring settings changed', [], 'Sales Rep Monitoring settings', `Changed: ${change.changed.join(', ')}.`, change))
  return c.json({ ok: true })
})

hrRoutes.put('/settings/notifications', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const prefs = await readJson(c)
  const errors = validateNotificationPrefs(prefs)
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const change = diffValues(settings.notifications, prefs)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  const labels = NOTIFICATION_GROUPS as Record<string, { label: string }>
  await applyChange(
    [sectionChange('notifications', { ...settings.notifications, ...prefs }, hr)],
    settingsAudit(hr, 'Notification settings changed', [], 'Notification preferences', `Changed: ${change.changed.map((key) => labels[key].label).join(', ')}. Applies to notifications raised from now on.`, change),
  )
  return c.json({ ok: true })
})

hrRoutes.put('/settings/security', async (c) => {
  const hr = c.get('hr')
  await assertAllCompanies(c)
  const v = await readJson(c)
  const errors = validateSecurity(v)
  if (hasErrors(errors)) throw invalid(errors)
  const settings = await loadSettings()
  const next = {
    ...settings.security,
    sessionTimeoutMinutes: Number(v.sessionTimeoutMinutes),
    loginAttemptLimit: Number(v.loginAttemptLimit),
    passwordMinLength: Number(v.passwordMinLength),
    passwordRequireMixed: Boolean(v.passwordRequireMixed),
  }
  const change = diffValues(settings.security, next)
  if (!change.changed.length) throw invalid(NOTHING_CHANGED)
  await applyChange([sectionChange('security', next, hr)], settingsAudit(hr, 'Security preferences changed', [], 'Security settings', `Changed: ${change.changed.join(', ')}.`, change))
  return c.json({ ok: true })
})

/* --------------------------------------------------------------------------
 * Shops
 * ------------------------------------------------------------------------ */

const LOCATION_SOURCES: Record<string, string> = {
  geocoded: 'found by location lookup and confirmed by HR',
  'map-adjusted': 'placed on the map by HR',
  manual: 'entered by HR',
}

hrRoutes.patch('/shops/:shopId/location', async (c) => {
  const hr = c.get('hr')
  const row = await must(db.from('shops').select('*').eq('shop_id', c.req.param('shopId')).maybeSingle())
  if (!row) throw invalid({ form: 'Shop not found.' })
  assertCompany(c, row.company_id)
  const shop = shopFromRow(row)
  const body = await readJson(c)
  const errors: Record<string, string> = { ...validateCoordinates(body.latitude, body.longitude) }
  if (body.latitude === '' || body.latitude == null) errors.latitude = errors.latitude ?? 'Choose a location first.'
  const locationSource = text(body.locationSource, 20)
  if (!LOCATION_SOURCES[locationSource]) errors.form = 'Say how the location was set.'
  if (hasErrors(errors)) throw invalid(errors)

  const label = text(body.locationLabel, 300) || null
  const next = {
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    location_source: locationSource,
    location_label: label,
    location_confirmed_by: hr.name,
    location_confirmed_at: new Date().toISOString(),
  }
  await applyChange([{ table: 'shops', op: 'update', match: { shop_id: row.shop_id }, row: next }], audit(hr, {
    source: 'Shop Directory',
    action: shop.latitude == null ? 'Shop location set' : 'Shop location changed',
    category: 'Shifts & Shops',
    companyIds: [row.company_id],
    affected: shop.displayName,
    description: `Location ${LOCATION_SOURCES[locationSource]}.${label ? ` ${label}` : ''}`,
    previous: { coordinates: formatShopCoordinates(shop) },
    next: { coordinates: formatShopCoordinates(next) },
  }))
  return c.json({ ok: true })
})

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** Finds candidate locations for HR to confirm. Nothing is saved here. */
hrRoutes.get('/geocode', async (c) => {
  const settings = await loadSettings()
  if ((settings.monitoring.locationProvider ?? 'none') === 'none') {
    return c.json({ status: 'not-configured', results: [], message: 'Automatic location lookup is not configured.' })
  }
  const part = (name: string) => text(c.req.query(name), 120)
  const shopName = part('shopName')
  const area = part('area')
  const town = part('town')
  if (shopName.length < 2 || (town.length < 2 && area.length < 2)) {
    return c.json({ status: 'invalid', results: [], message: 'Enter the shop name and its town or area first.' })
  }
  await rateLimit(`geocode:${c.get('hr').id}`, 30, 60)

  const parts = [shopName, part('address'), area, town].filter(Boolean)
  const query = `${parts.filter((v, i) => parts.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).join(', ')}, Ghana`
  const key = query.toLowerCase()
  const dayAgo = new Date(Date.now() - 86400000).toISOString()
  const cached = await must(db.from('geocode_cache').select('results').eq('query_key', key).gte('fetched_at', dayAgo).maybeSingle())
  let results = cached?.results
  if (!results) {
    try {
      const response = await fetch(`${NOMINATIM}?format=jsonv2&limit=6&countrycodes=gh&q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json', 'Accept-Language': 'en', 'User-Agent': 'WorkforcePro-Attendance/1.0' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      results = (Array.isArray(data) ? data : [])
        .map((d: Record<string, unknown>) => ({
          id: String(d.place_id ?? `${d.lat},${d.lon}`),
          label: d.display_name ?? 'Unnamed place',
          latitude: Number(d.lat),
          longitude: Number(d.lon),
          kind: [d.category, d.type].filter(Boolean).join(' · '),
          provider: 'OpenStreetMap (Nominatim)',
        }))
        .filter((r: { latitude: number; longitude: number }) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
      await applyChange([{
        table: 'geocode_cache',
        op: 'upsert',
        conflict: ['query_key'],
        row: { query_key: key, results, fetched_at: new Date().toISOString() },
      }])
    } catch (error) {
      console.error('geocode failed', error)
      return c.json({ status: 'error', results: [], query, message: 'The location service could not be reached. Check the connection, or set the location on the map.' })
    }
  }
  return c.json({ status: results.length ? 'ok' : 'no-results', results, query })
})

/* --------------------------------------------------------------------------
 * Sales monitoring alerts
 * ------------------------------------------------------------------------ */

const ALERT_STATUSES = ['new', 'under-review', 'resolved']

function reviewChange(exceptionId: string, companyId: string, status: string, note: string, hr: HrUser, at: string) {
  return {
    table: 'monitoring_alert_reviews',
    op: 'upsert',
    conflict: ['exception_id'],
    row: { exception_id: exceptionId, company_id: companyId, status, resolution_note: note, reviewed_at: at, reviewed_by: hr.name },
  }
}

hrRoutes.patch('/monitoring/alerts/:exceptionId', async (c) => {
  const hr = c.get('hr')
  const exceptionId = c.req.param('exceptionId')
  const [employeeId, dateKey, type] = exceptionId.split(':')
  const emp = await employeeFor(c, employeeId)
  const body = await readJson(c)
  const status = text(body.status, 20)
  if (!ALERT_STATUSES.includes(status)) throw invalid({ status: 'Choose a status.' })
  const note = text(body.resolutionNote)
  const existing = await must(db.from('monitoring_alert_reviews').select('status').eq('exception_id', exceptionId).maybeSingle())
  const at = new Date().toISOString()
  await applyChange([reviewChange(exceptionId, emp.company_id, status, note, hr, at)], audit(hr, {
    source: 'Sales Rep Monitoring',
    action: status === 'resolved' ? 'Monitoring alert resolved' : 'Monitoring alert review updated',
    category: 'Sales Rep Monitoring',
    companyIds: [emp.company_id],
    affected: `${emp.full_name} (${emp.staff_id}) · ${dateKey} · ${type}`,
    description: note,
    previous: { status: existing?.status ?? 'new' },
    next: { status },
  }))
  return c.json({ status, resolutionNote: note, reviewedAt: at })
})

/* --------------------------------------------------------------------------
 * Notifications
 * ------------------------------------------------------------------------ */

type Row = Record<string, unknown>
type Outcome = { patch?: Row; action: string; note?: string; comment?: boolean; review?: [string, string] }

function isOpen(row: Row) {
  return OPEN_STATUSES.includes(row.status as string)
}

async function decide(row: Row, body: Row, hr: HrUser): Promise<Outcome> {
  const stamp = new Date().toISOString()
  switch (body.action) {
    case 'read':
    case 'unread': {
      const read = body.action === 'read'
      if (row.read === read) throw new ApiError(409, `Already marked as ${body.action}.`, { code: 'no-change' })
      return { patch: { read }, action: read ? 'Marked as read' : 'Marked as unread' }
    }
    case 'assign': {
      const assignee = await must(db.from('hr_users').select('id, name, role_id, company_ids, status').eq('id', text(body.assigneeId, 64)).maybeSingle())
      if (!assignee) throw new ApiError(400, 'Choose who to assign.')
      if (assignee.status !== 'active' || !assignee.company_ids.includes(row.company_id)) {
        throw new ApiError(400, `${assignee.name} is not authorised for ${row.company_name}.`)
      }
      const current = row.assigned_to as Row | null
      if (current?.id === assignee.id) throw new ApiError(400, `Already assigned to ${assignee.name}.`)
      const role = assignee.role_id === 'hr-manager' ? 'HR Manager' : assignee.role_id
      return {
        patch: { assigned_to: { id: assignee.id, name: assignee.name, role } },
        action: 'Assigned',
        note: `${current?.name ?? 'Unassigned'} → ${assignee.name} (${role})`,
      }
    }
    case 'comment': {
      const comment = text(body.text)
      if (comment.length < 3) throw new ApiError(400, 'Write a comment first.')
      return { action: 'Comment', note: comment, comment: true }
    }
    case 'review': {
      if (row.status === 'under-review') throw new ApiError(400, 'Already under review.')
      if (!isOpen(row)) throw new ApiError(400, 'Reopen the notification first.')
      const note = text(body.note)
      return { patch: { status: 'under-review', read: true }, action: 'Status changed to Under Review', note, review: ['under-review', note] }
    }
    case 'resolve': {
      if (!isOpen(row)) throw new ApiError(400, 'This notification is already closed.')
      const actionTaken = text(body.actionTaken, 100)
      const notes = text(body.notes)
      if (!RESOLUTION_ACTIONS.includes(actionTaken)) throw new ApiError(400, 'Choose the action taken.')
      if (notes.length < 5) throw new ApiError(400, 'Add resolution notes (at least 5 characters).')
      return {
        patch: { status: 'resolved', read: true, resolution: { actionTaken, notes, by: hr.name, byRole: hr.role, at: stamp } },
        action: 'Resolved',
        note: `${actionTaken}: ${notes}`,
        review: ['resolved', `${actionTaken}: ${notes}`],
      }
    }
    case 'dismiss': {
      if (!isOpen(row)) throw new ApiError(400, 'This notification is already closed.')
      const reason = text(body.reason)
      if (reason.length < 5) throw new ApiError(400, 'A reason is required to dismiss (at least 5 characters).')
      return {
        patch: { status: 'dismissed', read: true, dismissal: { reason, by: hr.name, byRole: hr.role, at: stamp } },
        action: 'Dismissed',
        note: reason,
        review: ['resolved', `Dismissed in Notifications: ${reason}`],
      }
    }
    case 'reopen': {
      if (isOpen(row)) throw new ApiError(400, 'This notification is already open.')
      const reason = text(body.reason)
      if (reason.length < 5) throw new ApiError(400, 'Say why it is being reopened (at least 5 characters).')
      return { patch: { status: 'under-review' }, action: 'Reopened', note: reason, review: ['under-review', `Reopened: ${reason}`] }
    }
    default:
      throw new ApiError(400, 'Unknown action.')
  }
}

function notificationAudit(hr: HrUser, row: Row, action: string, note: string) {
  return audit(hr, {
    source: 'Notifications & Exceptions',
    action: `Notification: ${action}`,
    category: 'Notifications & Exceptions',
    companyIds: [row.company_id],
    affected: `${row.title} · ${row.employee_name ?? ''}${row.employee_id ? ` (${row.employee_id})` : ''}`,
    description: note,
  })
}

function historyRow(row: Row, action: string, by: string, note: string, comment = false) {
  return { table: 'notification_history', op: 'insert', row: { notification_id: row.id, company_id: row.company_id, action, by, note, is_comment: comment } }
}

/** Run detection on demand, for the Refresh button. */
hrRoutes.post('/notifications/sync', async (c) => {
  await rateLimit(`sync:${c.get('hr').id}`, 6, 60)
  return c.json(await syncNotifications())
})

hrRoutes.post('/notifications/mark-read', async (c) => {
  const hr = c.get('hr')
  const body = await readJson(c)
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === 'string').slice(0, 1000) as string[]
  const rows = ids.length
    ? await found(db.from('notifications').select('*').in('id', ids).eq('read', false).in('company_id', hr.companyIds))
    : []
  if (rows.length) {
    await applyChange(
      rows.flatMap((row) => [
        { table: 'notifications', op: 'update', match: { id: row.id }, row: { read: true } },
        historyRow(row, 'Marked as read', hr.name, 'Mark all as read.'),
      ]),
      rows.map((row) => notificationAudit(hr, row, 'Marked as read', 'Mark all as read.')),
    )
  }
  return c.json({ count: rows.length })
})

hrRoutes.post('/notifications/:id', async (c) => {
  const hr = c.get('hr')
  const row = await must(db.from('notifications').select('*').eq('id', c.req.param('id')).maybeSingle())
  if (!row || !hr.companyIds.includes(row.company_id)) throw new ApiError(404, 'Notification not found.')
  const body = await readJson(c)
  let outcome: Outcome
  try {
    outcome = await decide(row, body, hr)
  } catch (error) {
    if (error instanceof ApiError && error.extra.code === 'no-change') return c.json({ ok: true })
    throw error
  }
  const note = outcome.note ?? ''
  const at = new Date().toISOString()
  const patch: Row = { ...outcome.patch }
  const ops: unknown[] = [historyRow(row, outcome.action, hr.name, note, outcome.comment)]
  if (outcome.review && row.sales_exception_id) {
    ops.push(reviewChange(row.sales_exception_id, row.company_id, outcome.review[0], outcome.review[1], hr, at))
    patch.sales_synced_at = at
  }
  if (Object.keys(patch).length) ops.push({ table: 'notifications', op: 'update', match: { id: row.id }, row: patch })
  await applyChange(ops, notificationAudit(hr, row, outcome.action, note))
  return c.json({ ok: true })
})

/* --------------------------------------------------------------------------
 * Exports
 * ------------------------------------------------------------------------ */

const EXPORT_CATEGORIES = ['System Settings', 'Attendance', 'Employee Management', 'Sales Rep Monitoring']

/** Files are built in the browser from data HR can already read; this logs it. */
hrRoutes.post('/audit/exports', async (c) => {
  const hr = c.get('hr')
  const body = await readJson(c)
  const action = text(body.action, 80)
  const category = text(body.category, 40)
  if (!action.endsWith('exported') || !EXPORT_CATEGORIES.includes(category)) throw new ApiError(400, 'Unknown export.')
  const companyIds = (Array.isArray(body.companyIds) ? body.companyIds : []).filter((id) => hr.companyIds.includes(id as string))
  await applyChange([], audit(hr, {
    source: text(body.source, 40) || 'Exports',
    action,
    category,
    companyIds,
    affected: text(body.affected, 200),
    description: text(body.description, 500),
  }))
  return c.json({ ok: true })
})

hrRoutes.post('/settings/export', async (c) => {
  const hr = c.get('hr')
  const settings = await loadSettings()
  const at = new Date().toISOString()
  await applyChange([sectionChange('data', { ...settings.data, lastConfigExportAt: at }, hr)], audit(hr, {
    source: 'Data Management',
    action: 'Configuration exported',
    category: 'System Settings',
    companyIds: [],
    affected: 'System configuration',
    description: 'Configuration downloaded as JSON.',
    previous: { lastConfigExportAt: settings.data.lastConfigExportAt ?? null },
    next: { lastConfigExportAt: at },
  }))
  return c.json({ at })
})
