/**
 * Employee registration and the employee directory.
 * Staff IDs are issued only by the server.
 */

import { accraDateKey } from '../utils/accraTime'
import { employeeFromRow } from '../../supabase/functions/_shared/rules/facts.js'
import { api, submit } from './backend/client'
import { photoUrl, refresh, rows } from './backend/cache'

export { validateEmployeeDetails } from '../../supabase/functions/_shared/rules/registration.js'

const REGISTERED_DEVICE_KEY = 'workforce:device-registered'

/** Newest first. */
export function listEmployees() {
  return rows('employees')
    .map((row) => {
      const employee = employeeFromRow(row)
      return { ...employee, faceImage: photoUrl(employee.facePhotoPath) }
    })
    .sort((a, b) => String(b.registeredAt).localeCompare(String(a.registeredAt)))
}

/** Hides registration on a device that has already registered someone. Not a security control. */
export function hasRegisteredOnThisDevice() {
  try {
    return window.localStorage.getItem(REGISTERED_DEVICE_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDeviceRegistered() {
  try {
    window.localStorage.setItem(REGISTERED_DEVICE_KEY, '1')
  } catch {
    // A private window simply shows the registration option again.
  }
}

/** @returns {Promise<object>} the created employee, including the new Staff ID */
export async function submitRegistration(registration) {
  const created = await api('/employees/register', {
    method: 'POST',
    body: {
      companyId: registration.companyId,
      firstName: registration.firstName,
      middleName: registration.middleName,
      lastName: registration.lastName,
      phone: registration.phone,
      email: registration.email,
      address: registration.address,
      emergencyContactName: registration.emergencyContactName,
      emergencyContactPhone: registration.emergencyContactPhone,
      paymentMethod: registration.paymentMethod,
      position: registration.position,
      shopMode: registration.shopMode,
      assignedShopId: registration.assignedShopId,
      newShop: registration.newShop,
      faceImage: registration.faceImage,
      biometricConsent: registration.confirmed === true,
    },
  })
  rememberDeviceRegistered()
  return created
}

/** The date the employee joined: set by HR, else the registration date. */
export function employeeJoinedOn(employee) {
  if (employee?.joinedOn) return employee.joinedOn
  return employee?.registeredAt ? accraDateKey(new Date(employee.registeredAt)) : null
}

/** @returns {Promise<{ employee: object } | { errors: object }>} */
export async function updateEmployeeDetails(staffId, values) {
  const result = await submit(`/hr/employees/${encodeURIComponent(staffId)}`, { method: 'PATCH', body: values })
  if (result.errors) return result
  await refresh('employees', 'audit_events', 'notifications', 'notification_history')
  return { employee: listEmployees().find((e) => e.staffId === staffId) }
}
