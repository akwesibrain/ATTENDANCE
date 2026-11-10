/**
 * Permission helpers used across the HR modules. They all delegate to the
 * shared mock permission service (services/permissionsService.js), so every
 * module applies the same role, permission and company-scope rules.
 *
 * Frontend prototype only: production must enforce the same rules on the
 * backend for every protected API and data operation.
 */
import {
  authorisedCompanies,
  can,
  canAccessCompany,
  getHrUser,
  getSessionUser,
  listHrUsers,
} from '../services/permissionsService'

export { can, canAccessCompany, authorisedCompanies, getHrUser, getSessionUser, listHrUsers }

/** Whether a user may create or correct attendance records. */
export function canCorrectAttendance(user = getSessionUser()) {
  return can(user, 'attendance-corrections', 'edit')
}

/** Whether a user may act on notifications (read state, assign, resolve…). */
export function canManageNotifications(user = getSessionUser()) {
  return can(user, 'notifications', 'edit')
}

/** Whether a user is authorised to see a company's data. */
export function canViewCompany(user, companyId) {
  return canAccessCompany(user, companyId)
}

/** Active HR users who can be assigned an exception for a company. */
export function hrUsersForCompany(companyId) {
  return listHrUsers().filter((u) => u.status === 'active' && canAccessCompany(u, companyId) && can(u, 'notifications', 'edit'))
}

/** Whether a user may create and submit historical import batches. */
export function canImportHistorical(user = getSessionUser()) {
  return can(user, 'historical-import', 'create')
}

/** Whether a user may approve or reject submitted historical import batches. */
export function canReviewHistorical(user = getSessionUser()) {
  return can(user, 'import-approval', 'approve')
}
