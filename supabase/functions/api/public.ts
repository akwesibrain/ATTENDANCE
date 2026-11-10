/** Employee routes. There is no login here, so every route is rate limited. */

import { Hono } from 'npm:hono@4.6.14'
import { compareFaces, enrollFace, UnusableFaceImage } from '../_shared/faceMatcher.ts'
import { accraDateKey } from '../_shared/rules/accraTime.js'
import { attendanceGate, MAX_FACE_ATTEMPTS, normalizeStaffId } from '../_shared/rules/checkin.js'
import { shopFromRow } from '../_shared/rules/facts.js'
import { parseJpegDataUrl } from '../_shared/rules/faceTemplate.js'
import { holidayNameFor } from '../_shared/rules/holidays.js'
import { checkGeofence, verificationResult } from '../_shared/rules/monitoring.js'
import { isWeekend, overtimeHours } from '../_shared/rules/policy.js'
import { parseRegistration } from '../_shared/rules/registration.js'
import { loadSettings, syncNotifications } from './facts.ts'
import { ApiError, applyChange, clientIp, db, discardPhoto, found, invalid, later, must, rateLimit, readJson, rpc, sha256Hex, storePhoto } from './lib.ts'

const ENROLLMENT_BUCKET = 'face-enrollment'
const ATTENDANCE_BUCKET = 'attendance-photos'
const NOT_FOUND = 'Staff ID not found. Check the ID and try again, or register first.'

// A kiosk serves a whole shop from one address, so address limits stay generous.
const LIMITS = {
  shops: [120, 60],
  register: [30, 3600],
  lookup: [240, 60],
  eventsByIp: [120, 60],
  eventsByStaff: [15, 600],
  verify: [60, 60],
} as const

export const publicRoutes = new Hono()

function faceBytes(value: unknown): Uint8Array {
  const bytes = parseJpegDataUrl(value)
  if (!bytes) throw new ApiError(400, 'Face verification is required. Please capture your photo to continue.')
  return bytes
}

function readable<T>(action: () => T): T {
  try {
    return action()
  } catch (error) {
    if (error instanceof UnusableFaceImage) throw new ApiError(422, error.message, { code: 'unusable-photo' })
    throw error
  }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Active shops for the registration form. Locations stay with HR. */
publicRoutes.get('/public/shops', async (c) => {
  await rateLimit(`shops:ip:${clientIp(c)}`, ...LIMITS.shops)
  const companyId = c.req.query('companyId')
  if (!companyId) throw new ApiError(400, 'Choose a company first.')
  const shops = await found(
    db.from('shops')
      .select('shop_id, company_id, shop_name, town, area, address')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .order('shop_name'),
  )
  return c.json({
    shops: shops.map((s) => ({
      shopId: s.shop_id,
      companyId: s.company_id,
      shopName: s.shop_name,
      town: s.town,
      area: s.area,
      address: s.address,
    })),
  })
})

publicRoutes.post('/employees/register', async (c) => {
  await rateLimit(`register:ip:${clientIp(c)}`, ...LIMITS.register)
  const body = await readJson(c)

  // deno-lint-ignore no-explicit-any
  const parsed = parseRegistration(body) as any
  if (parsed.errors) throw invalid(parsed.errors)
  const form = parsed.value

  const image = faceBytes(body.faceImage)
  const template = readable(() => enrollFace(image))

  const photoPath = `${form.companyId}/${crypto.randomUUID()}.jpg`
  await storePhoto(ENROLLMENT_BUCKET, photoPath, image)

  let employee
  try {
    employee = await rpc<Record<string, string | null>>('register_employee', {
      p_employee: {
        company_id: form.companyId,
        full_name: form.fullName,
        position: form.position,
        payment_method: form.paymentMethod,
        phone: form.phone,
        email: form.email,
        address: form.address,
        emergency_contact_name: form.emergencyContactName,
        emergency_contact_phone: form.emergencyContactPhone,
        face_photo_path: photoPath,
      },
      p_template: template,
      p_shop_id: form.shopId,
      p_new_shop: form.newShop && {
        shop_id: `shop-${slug(form.companyId)}-${slug(`${form.newShop.shopName} ${form.newShop.area}`)}-${crypto.randomUUID().slice(0, 8)}`,
        shop_name: form.newShop.shopName,
        town: form.newShop.town,
        area: form.newShop.area,
        address: form.newShop.address,
      },
    })
  } catch (error) {
    await discardPhoto(ENROLLMENT_BUCKET, photoPath)
    throw error
  }

  return c.json({
    staffId: employee.staff_id,
    status: employee.status,
    companyId: employee.company_id,
    companyName: employee.company_name,
    fullName: employee.full_name,
    position: employee.position,
    paymentMethod: employee.payment_method,
    assignedShopId: employee.assigned_shop_id,
    registeredAt: employee.registered_at,
  }, 201)
})

async function findEmployee(staffId: string | null) {
  if (!staffId) return null
  return await must(
    db.from('employees')
      .select('staff_id, company_id, company_name, full_name, position, status')
      .eq('staff_id', staffId)
      .maybeSingle(),
  )
}

async function eventsToday(staffId: string, date: string) {
  return await found(
    db.from('attendance_events').select('type, occurred_at').eq('employee_id', staffId).eq('date', date),
  )
}

async function isHoliday(date: string) {
  const custom = await found(db.from('holidays').select('date, name'))
  return Boolean(holidayNameFor(date, custom))
}

async function failedAttemptsToday(staffId: string, date: string) {
  const row = await must(
    db.from('face_attempts').select('failed').eq('employee_id', staffId).eq('date', date).maybeSingle(),
  )
  return row?.failed ?? 0
}

/** Only what the kiosk needs before a face scan: no photo and no contact details. */
publicRoutes.get('/attendance/lookup/:staffId', async (c) => {
  await rateLimit(`lookup:ip:${clientIp(c)}`, ...LIMITS.lookup)
  const employee = await findEmployee(normalizeStaffId(c.req.param('staffId')))
  if (!employee) throw new ApiError(404, NOT_FOUND)

  const now = new Date()
  const date = accraDateKey(now)
  const [events, failed, holiday] = await Promise.all([
    eventsToday(employee.staff_id, date),
    failedAttemptsToday(employee.staff_id, date),
    isHoliday(date),
  ])
  const gate = attendanceGate({
    fullName: employee.full_name,
    status: employee.status,
    eventTypes: events.map((e) => e.type),
    now,
    holiday,
  })
  return c.json({
    staffId: employee.staff_id,
    fullName: employee.full_name,
    companyName: employee.company_name,
    nextAction: gate.nextAction,
    windowStatus: gate.windowStatus,
    blockedReason: gate.blockedReason,
    attemptsLeft: Math.max(MAX_FACE_ATTEMPTS - failed, 0),
  })
})

const EXPIRED_LINK = 'This verification link has expired or was already used.'

async function openCheck(tokenText: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(tokenText)) throw new ApiError(410, EXPIRED_LINK)
  const hash = await sha256Hex(tokenText)
  const row = await must(
    db.from('verification_tokens')
      .select('event_id, expires_at, used_at, verification_events(employee_id, shop_id, verification_number)')
      .eq('token_hash', hash)
      .maybeSingle(),
  )
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) throw new ApiError(410, EXPIRED_LINK)
  const event = row.verification_events as unknown as { employee_id: string; shop_id: string | null; verification_number: number }
  return { hash, eventId: row.event_id, expiresAt: row.expires_at, event }
}

/** What the SMS link page shows. */
publicRoutes.get('/verify/:token', async (c) => {
  await rateLimit(`verify:ip:${clientIp(c)}`, ...LIMITS.verify)
  const check = await openCheck(c.req.param('token'))
  const [employee, settings] = await Promise.all([
    found(db.from('employees').select('full_name').eq('staff_id', check.event.employee_id).single()),
    loadSettings(),
  ])
  return c.json({
    fullName: employee.full_name,
    verificationNumber: check.event.verification_number,
    expiresAt: check.expiresAt,
    faceRequired: settings.monitoring.faceRequired,
    gpsRequired: settings.monitoring.gpsRequired,
  })
})

/** One answer per link. The geofence is checked here, against the assigned shop. */
publicRoutes.post('/verify/:token', async (c) => {
  await rateLimit(`verify:ip:${clientIp(c)}`, ...LIMITS.verify)
  const check = await openCheck(c.req.param('token'))
  const body = await readJson(c)
  const settings = await loadSettings()

  let facePassed = true
  if (settings.monitoring.faceRequired) {
    const image = faceBytes(body.faceImage)
    const enrolled = await must(
      db.from('face_templates').select('algorithm, template').eq('employee_id', check.event.employee_id).maybeSingle(),
    )
    facePassed = enrolled ? readable(() => compareFaces(enrolled, image)).match : false
  }

  // A photo that could not be read leaves the link open; from here it is spent.
  const now = new Date().toISOString()
  const claimed = await found(
    db.from('verification_tokens').update({ used_at: now }).eq('token_hash', check.hash).is('used_at', null).gt('expires_at', now).select('event_id'),
  )
  if (!claimed.length) throw new ApiError(410, EXPIRED_LINK)

  const shop = check.event.shop_id
    ? await must(db.from('shops').select('*').eq('shop_id', check.event.shop_id).maybeSingle())
    : null
  const gps = settings.monitoring.gpsRequired
    ? checkGeofence(body, shop && shopFromRow(shop))
    : { status: 'not-required', distance: null }
  const result = verificationResult(facePassed, gps.status)
  const accuracy = typeof body.accuracy === 'number' && Number.isFinite(body.accuracy) ? Math.round(body.accuracy) : null

  await applyChange([{
    table: 'verification_events',
    op: 'update',
    match: { event_id: check.eventId },
    row: {
      responded_at: now,
      face_verification_status: !settings.monitoring.faceRequired ? 'not-required' : facePassed ? 'passed' : 'failed',
      // The current matcher cannot tell a live person from a photo.
      liveness_status: 'not-checked',
      gps_verification_status: gps.status,
      distance_from_shop: gps.distance,
      gps_accuracy: accuracy,
      result,
    },
  }])
  later(syncNotifications())
  return c.json({ result })
})

/** Record a check-in or check-out. The time always comes from the server. */
publicRoutes.post('/attendance/events', async (c) => {
  await rateLimit(`events:ip:${clientIp(c)}`, ...LIMITS.eventsByIp)
  const body = await readJson(c)
  const staffId = normalizeStaffId(body.staffId)
  if (staffId) await rateLimit(`events:staff:${staffId}`, ...LIMITS.eventsByStaff)

  const employee = await findEmployee(staffId)
  if (!employee) throw new ApiError(404, 'Staff ID not found. Please register first.')

  const now = new Date()
  const date = accraDateKey(now)
  const [events, holiday] = await Promise.all([eventsToday(employee.staff_id, date), isHoliday(date)])
  const gate = attendanceGate({
    fullName: employee.full_name,
    status: employee.status,
    eventTypes: events.map((e) => e.type),
    now,
    holiday,
  })
  if (gate.blockedReason) throw new ApiError(409, gate.blockedReason, { code: 'blocked' })

  const image = faceBytes(body.faceImage)
  const enrolled = await must(
    db.from('face_templates').select('algorithm, template').eq('employee_id', employee.staff_id).maybeSingle(),
  )
  if (!enrolled) throw new ApiError(409, 'No registered face photo on file for this Staff ID. Please contact HR.')

  const { score, match } = readable(() => compareFaces(enrolled, image))
  if (!match) {
    const failed = await rpc<number>('record_face_failure', {
      p_staff_id: employee.staff_id,
      p_max: MAX_FACE_ATTEMPTS,
    })
    const attemptsLeft = Math.max(MAX_FACE_ATTEMPTS - failed, 0)
    const markedAbsent = attemptsLeft === 0
    const message = markedAbsent
      ? `Face does not match this Staff ID. ${employee.full_name} has been marked ABSENT for today after ${MAX_FACE_ATTEMPTS} failed verification attempts.`
      : `Face does not match this Staff ID. You can only check in or out with your own registered face. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before this Staff ID is marked absent.`
    throw new ApiError(403, message, { code: 'face-mismatch', attemptsLeft, markedAbsent })
  }

  const weekend = isWeekend(now)
  const checkIn = events.find((e) => e.type === 'check-in')
  const overtime = gate.nextAction === 'check-out' && weekend
    ? overtimeHours(checkIn?.occurred_at, now.toISOString(), now)
    : null

  const photoPath = `${employee.company_id}/${date}/${employee.staff_id}-${gate.nextAction}-${crypto.randomUUID()}.jpg`
  await storePhoto(ATTENDANCE_BUCKET, photoPath, image)

  let event
  try {
    event = await rpc<Record<string, string | number | boolean | null>>('record_attendance_event', {
      p_staff_id: employee.staff_id,
      p_type: gate.nextAction,
      p_status: gate.windowStatus,
      p_score: score,
      p_photo_path: photoPath,
      p_weekend: weekend,
      p_overtime_hours: overtime,
    })
  } catch (error) {
    await discardPhoto(ATTENDANCE_BUCKET, photoPath)
    throw error
  }

  return c.json({
    id: event.id,
    staffId: employee.staff_id,
    fullName: employee.full_name,
    companyName: employee.company_name,
    position: employee.position,
    type: event.type,
    status: event.status,
    date: event.date,
    time: event.occurred_at,
    weekend: event.weekend,
    overtimeHours: event.overtime_hours,
  })
})
