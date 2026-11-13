/** Scheduled work. Only the database scheduler holds the secret these need. */

import { Hono } from 'npm:hono@4.6.14'
import { sendSms, smsConfigured } from '../_shared/smsSender.ts'
import { accraDateKey, accraIso } from '../_shared/rules/accraTime.js'
import { needsShopList } from '../_shared/rules/categories.js'
import { scheduleCheckMinutes } from '../_shared/rules/monitoring.js'
import { buildRecord, outsideEmployment, shiftWindowMinutes } from '../_shared/rules/records.js'
import { hoursInForce } from '../_shared/rules/settings.js'
import { loadFacts, loadSettings, syncNotifications } from './facts.ts'
import { DISPATCH_CONCURRENCY, isEmployeeActive, runInBatches, sameSecret } from './guards.ts'
import { ApiError, applyChange, db, found, must, sha256Hex } from './lib.ts'
import { closePastDays } from './trackingDays.ts'
import { listsFor } from './trackingFacts.ts'

export const jobRoutes = new Hono()

jobRoutes.use('*', async (c, next) => {
  const secret = Deno.env.get('JOBS_SECRET')
  if (!secret) throw new ApiError(503, 'Scheduled jobs are not configured.')
  if (!(await sameSecret(c.req.header('x-job-secret') ?? '', secret))) throw new ApiError(403, 'Forbidden.')
  await next()
})

/** Whole minutes from 0 up to 1, from a secure source, so times cannot be predicted. */
function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}

const SKIPPED_DAYS = ['rest-day', 'holiday', 'on-leave']

jobRoutes.post('/generate-schedule', async (c) => {
  if (!smsConfigured()) return c.json({ skipped: 'SMS not configured' })
  const now = new Date()
  const date = accraDateKey(now)
  const { settings, ctx, roster, shopsById } = await loadFacts({ from: date, to: date, now })
  if (!settings.monitoring.smsEnabled) return c.json({ skipped: 'SMS checks are turned off' })

  const lists = await listsFor(roster.map((emp) => emp.employeeId))
  const rows = roster
    .filter((emp) => {
      if (Boolean(emp.employmentEnd) || !(emp.isFieldRole || needsShopList(emp.position)) || outsideEmployment(emp, date)) return false
      const ids = [...(lists.get(emp.employeeId) ?? []), ...(emp.shopId ? [emp.shopId] : [])]
      return ids.some((id) => shopsById.get(id)?.latitude != null)
    })
    .filter((emp) => !SKIPPED_DAYS.includes(buildRecord(emp, date, ctx).status))
    .flatMap((emp) => {
      const { start, end } = shiftWindowMinutes(hoursInForce(settings, emp.companyId, date))
      return scheduleCheckMinutes(start, end, secureRandom).map((minutes: number, index: number) => ({
        employee_id: emp.employeeId,
        company_id: emp.companyId,
        date,
        verification_number: index + 1,
        scheduled_at: accraIso(date, minutes),
      }))
    })
  if (rows.length) {
    await must(db.from('verification_schedule').upsert(rows, { onConflict: 'employee_id,date,verification_number', ignoreDuplicates: true }))
  }
  return c.json({ scheduled: rows.length })
})

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const BATCH = 200

jobRoutes.post('/dispatch', async (c) => {
  if (!smsConfigured()) return c.json({ skipped: 'SMS not configured' })
  const settings = await loadSettings()
  if (!settings.monitoring.smsEnabled) return c.json({ skipped: 'SMS checks are turned off' })
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '')
  if (!appUrl) throw new ApiError(503, 'APP_URL is not configured.')

  const now = new Date()
  const nowIso = now.toISOString()
  const today = accraDateKey(now)
  const due = await found(
    db.from('verification_schedule').select('*').is('dispatched_at', null).lte('scheduled_at', nowIso).order('scheduled_at').limit(BATCH),
  )
  if (!due.length) return c.json({ sent: 0 })
  const empIds = [...new Set(due.map((row) => row.employee_id))]
  const dates = [...new Set(due.map((row) => row.date))]
  const [employees, lists, eventRows, corrRows] = await Promise.all([
    found(db.from('employees').select('staff_id, phone, assigned_shop_id, status').in('staff_id', empIds)),
    listsFor(empIds),
    found(db.from('attendance_events').select('employee_id, date, type').in('employee_id', empIds).in('date', dates)),
    found(db.from('attendance_corrections').select('employee_id, date, clock_in, clock_out').in('employee_id', empIds).in('date', dates)),
  ])
  const byId = new Map(employees.map((row) => [row.staff_id, row]))
  const eventsByKey = new Map<string, string[]>()
  eventRows.forEach((e) => {
    const k = `${e.employee_id}|${e.date}`
    eventsByKey.set(k, [...(eventsByKey.get(k) ?? []), e.type])
  })
  const corrByKey = new Map(corrRows.map((r) => [`${r.employee_id}|${r.date}`, r]))
  const expiresAt = new Date(now.getTime() + settings.monitoring.responseWindowMinutes * 60000).toISOString()

  const outcomes = await runInBatches(due, DISPATCH_CONCURRENCY, async (row) => {
    const employee = byId.get(row.employee_id)
    const k = `${row.employee_id}|${row.date}`
    const types = eventsByKey.get(k) ?? []
    const corr = corrByKey.get(k)
    const clockedIn = types.includes('check-in') || Boolean(corr?.clock_in)
    const clockedOut = types.includes('check-out') || types.includes('face-lockout') || Boolean(corr?.clock_out)
    // Never dispatch for an inactive employee, before clock-in, after clock-out, or on a past day.
    if (!isEmployeeActive(employee) || row.date < today || !clockedIn || clockedOut) {
      await must(
        db.from('verification_schedule')
          .update({ dispatched_at: nowIso, result: 'cancelled' })
          .eq('id', row.id)
          .is('dispatched_at', null),
      )
      return 'cancelled' as const
    }

    // Claim the schedule row atomically only while `dispatched_at` is still null so
    // concurrent clock-outs, deactivations, or overlapping runs cannot send duplicate SMS.
    const claimed = await must(
      db.from('verification_schedule')
        .update({ dispatched_at: nowIso })
        .eq('id', row.id)
        .is('dispatched_at', null)
        .select('id'),
    )
    if (!claimed?.length) return 'cancelled' as const

    const primaryShopId = lists.get(row.employee_id)?.[0] ?? employee?.assigned_shop_id ?? null
    const eventId = `${row.employee_id}-${row.date}-v${row.verification_number}`
    const token = newToken()
    try {
      await applyChange([
        {
          table: 'verification_events',
          op: 'insert',
          row: {
            event_id: eventId,
            employee_id: row.employee_id,
            company_id: row.company_id,
            shop_id: primaryShopId,
            date: row.date,
            verification_number: row.verification_number,
            dispatched_at: nowIso,
            delivery_status: 'sending',
          },
        },
        { table: 'verification_tokens', op: 'insert', row: { token_hash: await sha256Hex(token), event_id: eventId, expires_at: expiresAt } },
      ])
    } catch (error) {
      console.error('could not claim check', eventId, error)
      return 'skipped' as const
    }

    const message = `Workforce attendance check: open ${appUrl}/verify/${token} within ${settings.monitoring.responseWindowMinutes} minutes.`
    const delivered = await sendSms(employee?.phone ?? '', message).catch((error) => {
      console.error('sms failed', eventId, error)
      return false
    })
    await applyChange([{
      table: 'verification_events',
      op: 'update',
      match: { event_id: eventId },
      row: delivered
        ? { delivery_status: 'delivered' }
        : { delivery_status: 'failed', result: 'sms-failed', gps_verification_status: 'unavailable' },
    }])
    return delivered ? ('sent' as const) : ('failed' as const)
  })

  let sent = 0
  let failed = 0
  let cancelled = 0
  for (const outcome of outcomes) {
    if (outcome === 'sent') sent += 1
    else if (outcome === 'failed') failed += 1
    else if (outcome === 'cancelled') cancelled += 1
  }
  return c.json({ sent, failed, cancelled })
})

/** Checks nobody answered in time. A missed check is never an absence. */
jobRoutes.post('/close-missed', async (c) => {
  const expired = await found(
    db.from('verification_tokens')
      .select('event_id, verification_events!inner(result, delivery_status)')
      .is('used_at', null)
      .lt('expires_at', new Date().toISOString())
      .is('verification_events.result', null)
      .limit(BATCH),
  )
  if (expired.length) {
    await applyChange(expired.map((row) => {
      const event = row.verification_events as unknown as { delivery_status: string }
      return {
        table: 'verification_events',
        op: 'update',
        match: { event_id: row.event_id },
        row: event.delivery_status === 'delivered' ? { result: 'missed' } : { result: 'sms-failed', delivery_status: 'failed' },
      }
    }))
  }
  return c.json({ closed: expired.length })
})

/** Summarise each past day's location trail, then delete it. */
jobRoutes.post('/tracking-close-day', async (c) => c.json({ days: await closePastDays() }))

jobRoutes.post('/sync-notifications', async (c) => {
  const result = await syncNotifications()
  const dayAgo = new Date(Date.now() - 86400000).toISOString()
  await must(db.from('rate_limits').delete().lt('window_start', dayAgo))
  return c.json(result)
})
