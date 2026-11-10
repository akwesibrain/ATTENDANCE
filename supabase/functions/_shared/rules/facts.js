/**
 * Turns database rows into the objects the rules and screens work with.
 * The browser and the server both start from the same rows.
 */

import { accraDateKey } from './accraTime.js'
import { smsEventFromRow } from './monitoring.js'
import { createRecordContext, employmentStartFor, recordKey } from './records.js'
import { requiresShop } from './registration.js'
import { attendanceRulesInForce, hoursInForce } from './settings.js'

const iso = (value) => (value ? new Date(value).toISOString() : null)
const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ')

/** "Spintex Road, Accra". */
export function shopLocationText(shop) {
  if (!shop) return ''
  return [shop.area, shop.town].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
}

/** "China Mall — Spintex Road, Accra". */
export function shopDisplayName(shop) {
  if (!shop) return ''
  const where = shopLocationText(shop)
  return where ? `${shop.shopName} — ${where}` : shop.shopName
}

export function shopFromRow(row) {
  const base = { shopName: row.shop_name, town: row.town, area: row.area }
  const displayName = shopDisplayName(base)
  return {
    shopId: row.shop_id,
    companyId: row.company_id,
    baseName: row.shop_name,
    // Every screen shows the location with the name, so two outlets of the
    // same brand are never confused.
    shopName: displayName,
    displayName,
    town: row.town,
    area: row.area,
    address: row.address,
    addressLine: clean(row.address) || shopLocationText(base),
    latitude: row.latitude,
    longitude: row.longitude,
    locationSource: row.location_source,
    locationLabel: row.location_label,
    locationConfirmedBy: row.location_confirmed_by,
    locationConfirmedAt: row.location_confirmed_at,
    geofenceRadius: row.geofence_radius,
    status: row.status,
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export function employeeFromRow(row) {
  return {
    staffId: row.staff_id,
    status: row.status,
    companyId: row.company_id,
    companyName: row.company_name,
    fullName: row.full_name,
    position: row.position,
    paymentMethod: row.payment_method,
    phone: row.phone,
    email: row.email,
    address: row.address,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    assignedShopId: row.assigned_shop_id,
    facePhotoPath: row.face_photo_path,
    joinedOn: row.joined_on,
    registeredAt: row.registered_at,
    detailsUpdatedAt: row.details_updated_at,
    detailsUpdatedBy: row.details_updated_by,
  }
}

/** One employee as the attendance rules see them. */
export function rosterEntry(employee, shopsById) {
  const isFieldRole = requiresShop(employee.position)
  return {
    employeeId: employee.staffId,
    fullName: employee.fullName,
    companyId: employee.companyId,
    companyName: employee.companyName,
    position: employee.position,
    phone: employee.phone || null,
    paymentMethod: employee.paymentMethod ?? '',
    isFieldRole,
    shopId: isFieldRole && shopsById.has(employee.assignedShopId) ? employee.assignedShopId : null,
    photoPath: employee.facePhotoPath ?? null,
    employmentStart: employmentStartFor(employee.joinedOn, employee.registeredAt),
    joinedOn: employee.joinedOn ?? (employee.registeredAt ? accraDateKey(new Date(employee.registeredAt)) : null),
    kind: 'registered',
  }
}

export function eventFromRow(row) {
  return {
    id: row.id,
    staffId: row.employee_id,
    fullName: row.full_name,
    companyId: row.company_id,
    companyName: row.company_name,
    type: row.type,
    status: row.status,
    date: row.date,
    time: iso(row.occurred_at),
    weekend: row.weekend,
    overtimeHours: row.overtime_hours == null ? undefined : Number(row.overtime_hours),
    reason: row.reason,
    photoPath: row.photo_path,
  }
}

export function correctionHistoryFromRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.date,
    action: row.action,
    changedAt: iso(row.changed_at),
    changedBy: row.changed_by,
    changedByRole: row.changed_by_role,
    reason: row.reason,
    remarks: row.remarks,
    entryMethod: row.entry_method,
    entryBatchId: row.entry_batch_id,
    manualType: row.manual_type,
    previous: row.previous,
    next: row.next,
  }
}

export function leaveFromRow(row) {
  return {
    leaveId: row.leave_id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    approvedBy: row.approved_by,
  }
}

/**
 * The context the record builder needs, from database rows.
 * @param {object} rows events, corrections, correctionHistory, holidays, leaves, shops, verifications
 * @param {object} settings from composeSettings
 * @param {Date} [now]
 */
export function contextFromRows(rows, settings, now = new Date()) {
  const history = new Map()
  rows.correctionHistory
    .map(correctionHistoryFromRow)
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
    .forEach((entry) => {
      const key = recordKey(entry.employeeId, entry.date)
      history.set(key, [...(history.get(key) ?? []), entry])
    })

  const corrections = Object.fromEntries(
    rows.corrections.map((row) => {
      const key = recordKey(row.employee_id, row.date)
      return [key, {
        employeeId: row.employee_id,
        date: row.date,
        manualType: row.manual_type,
        entryMethod: row.entry_method,
        clockIn: iso(row.clock_in),
        clockOut: iso(row.clock_out),
        history: history.get(key) ?? [],
      }]
    }),
  )

  const smsByDay = new Map()
  rows.verifications
    .map((row) => ({ date: row.date, event: smsEventFromRow(row) }))
    .sort((a, b) => a.event.verificationNumber - b.event.verificationNumber)
    .forEach(({ date, event }) => {
      const key = recordKey(event.employeeId, date)
      smsByDay.set(key, [...(smsByDay.get(key) ?? []), event])
    })

  return createRecordContext({
    now,
    events: rows.events.map(eventFromRow),
    corrections,
    customHolidays: rows.holidays,
    leaves: rows.leaves.map(leaveFromRow),
    shopsById: new Map(rows.shops.map((row) => [row.shop_id, shopFromRow(row)])),
    hoursFor: (companyId, dateKey) => hoursInForce(settings, companyId, dateKey),
    attendanceRulesFor: (dateKey) => attendanceRulesInForce(settings, dateKey),
    smsDay: (employee, dateKey) => {
      const events = smsByDay.get(recordKey(employee.employeeId, dateKey))
      return events ? { events } : null
    },
  })
}

/** A shop's coordinates, or say they are not set yet. */
export function formatShopCoordinates(shop) {
  if (!shop || shop.latitude == null || shop.longitude == null) return 'Not set'
  return `${shop.latitude.toFixed(5)}, ${shop.longitude.toFixed(5)}`
}
