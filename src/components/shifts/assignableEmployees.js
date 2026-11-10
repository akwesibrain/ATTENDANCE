import { mockListEmployees } from '../../services/registrationService'
import { mockListSalesReps } from '../../services/salesMonitoringService'
import { mockGetActiveShiftAssignment } from '../../services/shiftAssignmentService'

/**
 * Everyone in a company who can be put on a shift: employees registered
 * through the app plus the demo's seeded field representatives. Deduplicated
 * by ID and sorted by name.
 *
 * `shiftId` is the shift the person effectively works: their active HR
 * assignment, or (for seeded reps) the seed shift monitoring falls back to.
 * @returns {{ employeeId: string, fullName: string, position: string, shiftId: string|null }[]}
 */
export function listAssignableEmployees(companyId) {
  const byId = new Map()
  mockListEmployees()
    .filter((e) => e.companyId === companyId)
    .forEach((e) => {
      byId.set(e.staffId, {
        employeeId: e.staffId,
        fullName: e.fullName,
        position: e.position,
        shiftId: mockGetActiveShiftAssignment(e.staffId)?.shiftId ?? null,
      })
    })
  mockListSalesReps(companyId).forEach((r) => {
    if (!byId.has(r.employeeId)) {
      byId.set(r.employeeId, {
        employeeId: r.employeeId,
        fullName: r.fullName,
        position: r.position,
        shiftId: r.shiftId ?? null,
      })
    }
  })
  return Array.from(byId.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  )
}
