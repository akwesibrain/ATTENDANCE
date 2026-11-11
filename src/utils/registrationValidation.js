/**
 * Step-level validation for the registration flow (business logic,
 * kept separate from the UI components).
 */
import { findDuplicateShop, validateNewShop } from '../services/shopsService'
import {
  validateOptionalEmail,
  validateOptionalPhone,
  validatePhone,
  validateRequired,
} from './validation'

export const POSITIONS = [
  'Warehouse Worker',
  'Sales Representative',
  'Merchandiser',
  'Supervisor',
  'Sales Manager',
  'Finance Officer',
  'Accountant',
  'Driver',
  'Storekeeper',
  'Operations Officer',
  'Administrative Officer',
  'Other',
]

export function validatePersonalInformation(data) {
  return {
    firstName: validateRequired(data.firstName, 'First name'),
    lastName: validateRequired(data.lastName, 'Last name'),
    phone: validatePhone(data.phone),
    email: validateOptionalEmail(data.email),
    emergencyContactPhone: validateOptionalPhone(
      data.emergencyContactPhone,
      'Emergency contact phone',
    ),
  }
}

export function isPersonalInformationValid(data) {
  return (
    Object.values(validatePersonalInformation(data)).every((e) => e === '') &&
    Boolean(data.paymentMethod)
  )
}

/**
 * Privileged titles employees may not self-assign through registration.
 * Elevated access is granted separately by company administration.
 */
const PRIVILEGED_PATTERN =
  /\b(admin|administrator|hr|human resources|manager|superintendent|director|chief|head of)\b/i

export function isPrivilegedPosition(position) {
  return PRIVILEGED_PATTERN.test(position.trim())
}

export function validateJobPosition(data) {
  const position = data.position?.trim() ?? ''
  if (!position) return 'Please enter your job position to continue.'
  if (position.length < 2) return 'Job position must be at least 2 characters.'
  if (isPrivilegedPosition(position)) {
    return 'Administrator, HR and manager roles cannot be self-assigned. Enter your operational job title, or contact HR if you believe this is a mistake.'
  }
  return ''
}

/** Whether a position needs an allocated shop (Merchandisers only). */
export function isFieldPosition(position) {
  const p = position?.trim().toLowerCase() ?? ''
  return p === 'merchandiser'
}

/**
 * Allocated-shop validation for field positions: either an existing shop is
 * selected, or a valid new shop (name + town) that does not already exist.
 * @returns {string} '' when valid.
 */
export function validateAllocatedShop(data) {
  if (!isFieldPosition(data.position)) return ''
  if (data.shopMode === 'new') {
    const errors = validateNewShop(data.newShop ?? {})
    if (Object.keys(errors).length) return Object.values(errors)[0]
    const dup = findDuplicateShop(data.companyId, data.newShop.shopName, data.newShop.town, data.newShop.area)
    if (dup) return `${dup.shopName} already exists. Select it from the list instead.`
    return ''
  }
  return data.assignedShopId ? '' : 'An allocated shop is required for this position. Select one, or add a new shop.'
}

export function isJobPositionValid(data) {
  if (validateJobPosition(data) !== '') return false
  return validateAllocatedShop(data) === ''
}
