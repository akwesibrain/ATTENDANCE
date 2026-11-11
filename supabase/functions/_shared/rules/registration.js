/**
 * Employee registration rules, shared by the browser and the server.
 * The server's check is the one that counts.
 */

import {
  validateOptionalEmail,
  validateOptionalPhone,
  validatePhone,
  validateRequired,
} from './validation.js'
import { accraTodayKey } from './accraTime.js'
import { isDateKey } from './tenure.js'

/** The only three ways the company pays salaries. */
export const PAYMENT_METHODS = [
  { id: 'table-top', label: 'Table Top' },
  { id: 'mobile-money', label: 'Mobile Money' },
  { id: 'bank', label: 'Bank' },
]

/** Positions that must be linked to the shop they work from. */
export const FIELD_POSITIONS = ['sales representative', 'merchandiser']

export function requiresShop(position) {
  return FIELD_POSITIONS.includes((position ?? '').trim().toLowerCase())
}

const PRIVILEGED_PATTERN =
  /\b(admin|administrator|hr|human resources|supervisor|manager|superintendent|director|chief|head of)\b/i

/** Elevated titles are granted by the company, never self-assigned. */
export function isPrivilegedPosition(position) {
  return PRIVILEGED_PATTERN.test(position.trim())
}

export function validatePersonalInformation(data) {
  return {
    firstName: validateRequired(data.firstName, 'First name'),
    lastName: validateRequired(data.lastName, 'Last name'),
    phone: validatePhone(data.phone),
    email: validateOptionalEmail(data.email),
    emergencyContactPhone: validateOptionalPhone(data.emergencyContactPhone, 'Emergency contact phone'),
  }
}

export function validateJobPosition(data) {
  const position = data.position?.trim() ?? ''
  if (!position) return 'Please enter your job position to continue.'
  if (position.length < 2) return 'Job position must be at least 2 characters.'
  if (isPrivilegedPosition(position)) {
    return 'Administrator, HR and supervisor roles cannot be self-assigned. Enter your operational job title, or contact HR if you believe this is a mistake.'
  }
  return ''
}

const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ')

function parseCoordinate(value) {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : NaN
}

export function validateCoordinates(latitude, longitude) {
  const errors = {}
  const lat = parseCoordinate(latitude)
  const lng = parseCoordinate(longitude)
  if ((lat == null) !== (lng == null)) errors.latitude = 'Enter both latitude and longitude, or leave both empty.'
  else if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) errors.latitude = 'Latitude must be between -90 and 90.'
  else if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) errors.longitude = 'Longitude must be between -180 and 180.'
  return errors
}

export function validateNewShop(data) {
  const errors = {}
  if (clean(data.shopName).length < 2) errors.shopName = 'Enter the shop name (e.g. China Mall).'
  if (clean(data.town).length < 2) errors.town = 'Enter the city or town (e.g. Ashaiman).'
  if (clean(data.area).length < 2) errors.area = 'Enter the area (e.g. Spintex Road).'
  return { ...errors, ...validateCoordinates(data.latitude, data.longitude) }
}

const MAX_FIELD_LENGTH = 200
const text = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_FIELD_LENGTH) : '')
const nonEmpty = (errors) => Object.fromEntries(Object.entries(errors).filter(([, message]) => message))

/**
 * Check a registration request and tidy its fields. New shops never carry
 * coordinates from here: only HR can confirm where a shop is.
 * @returns {{ errors: object } | { value: object }}
 */
export function parseRegistration(body) {
  const input = body && typeof body === 'object' ? body : {}
  const data = {
    companyId: text(input.companyId),
    firstName: text(input.firstName),
    middleName: text(input.middleName),
    lastName: text(input.lastName),
    phone: text(input.phone),
    email: text(input.email),
    address: text(input.address),
    emergencyContactName: text(input.emergencyContactName),
    emergencyContactPhone: text(input.emergencyContactPhone),
    paymentMethod: text(input.paymentMethod),
    position: text(input.position),
  }

  const errors = nonEmpty({
    ...validatePersonalInformation(data),
    position: validateJobPosition(data),
  })
  if (!data.companyId) errors.companyId = 'No company selected. Please go back and select your company.'
  if (!PAYMENT_METHODS.some((method) => method.id === data.paymentMethod)) {
    errors.paymentMethod = 'Choose how your salary is paid.'
  }
  if (input.biometricConsent !== true) {
    errors.biometricConsent = 'Biometric consent is required to register.'
  }

  let shopId = null
  let newShop = null
  if (requiresShop(data.position)) {
    if (input.shopMode === 'new') {
      const raw = input.newShop && typeof input.newShop === 'object' ? input.newShop : {}
      newShop = {
        shopName: clean(text(raw.shopName)),
        town: clean(text(raw.town)),
        area: clean(text(raw.area)),
        address: clean(text(raw.address)),
      }
      const shopErrors = validateNewShop(newShop)
      if (Object.keys(shopErrors).length) errors.shop = Object.values(shopErrors)[0]
    } else {
      shopId = text(input.assignedShopId) || null
      if (!shopId) errors.shop = 'An allocated shop is required for this position. Select one, or add a new shop.'
    }
  }

  if (Object.keys(errors).length) return { errors }
  const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')
  return { value: { ...data, fullName, shopId, newShop } }
}

/** The details HR can change after registration. */
export function validateEmployeeDetails(values, todayKey = accraTodayKey()) {
  const errors = {}
  if (!values.joinedOn) errors.joinedOn = 'Enter the date the employee joined the company.'
  else if (!isDateKey(values.joinedOn)) errors.joinedOn = 'Enter a valid date.'
  else if (values.joinedOn > todayKey) errors.joinedOn = 'The joining date cannot be in the future.'
  else if (values.joinedOn < '1950-01-01') errors.joinedOn = 'Check the year.'
  const name = (values.emergencyContactName ?? '').trim()
  const phone = (values.emergencyContactPhone ?? '').trim()
  const phoneError = validateOptionalPhone(phone, 'Emergency contact phone')
  if (phoneError) errors.emergencyContactPhone = phoneError
  if (phone && !name) errors.emergencyContactName = 'Enter the emergency contact’s name.'
  if (name && name.length < 2) errors.emergencyContactName = 'Enter the full name.'
  return errors
}

/**
 * The last day a leaving employee worked. Days after it are no longer
 * attendance days, so they never count as absences.
 */
export function validateLeavingDate(leftOn, employmentStart, todayKey = accraTodayKey()) {
  if (!leftOn) return { leftOn: 'Enter the last day the employee worked.' }
  if (!isDateKey(leftOn)) return { leftOn: 'Enter a valid date.' }
  if (leftOn > todayKey) return { leftOn: 'The last working day cannot be in the future. Deactivate the employee once they have left.' }
  if (employmentStart && leftOn < employmentStart) return { leftOn: 'The last working day cannot be before the employee started.' }
  return {}
}
