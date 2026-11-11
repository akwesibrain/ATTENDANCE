/**
 * Step-level validation for the registration flow. The field rules are shared
 * with the server; the shop lookup here is only for the on-screen message.
 */
import { findDuplicateShop, validateNewShop } from '../services/shopsService'
import {
  isPrivilegedPosition,
  requiresShop as isFieldPosition,
  validateJobPosition,
  validatePersonalInformation,
} from '../../supabase/functions/_shared/rules/registration.js'

export { isFieldPosition, isPrivilegedPosition, validateJobPosition, validatePersonalInformation }

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

export function isPersonalInformationValid(data) {
  return (
    Object.values(validatePersonalInformation(data)).every((e) => e === '') &&
    Boolean(data.paymentMethod)
  )
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
