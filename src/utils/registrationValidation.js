/**
 * Step-level validation for the registration flow (business logic,
 * kept separate from the UI components).
 */
import {
  validateOptionalEmail,
  validateOptionalPhone,
  validatePhone,
  validateRequired,
} from './validation'

export const POSITIONS = [
  'Warehouse Worker',
  'Sales Representative',
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
  return Object.values(validatePersonalInformation(data)).every((e) => e === '')
}

/**
 * Privileged titles employees may not self-assign through registration.
 * Elevated access is granted separately by company administration.
 */
const PRIVILEGED_PATTERN =
  /\b(admin|administrator|hr|human resources|supervisor|manager|superintendent|director|chief|head of)\b/i

export function isPrivilegedPosition(position) {
  return PRIVILEGED_PATTERN.test(position.trim())
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

export function isJobPositionValid(data) {
  return validateJobPosition(data) === ''
}
