/** Permission helpers used across the HR modules. */
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
