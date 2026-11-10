/**
 * ============================================================================
 * AUDIT LOG (mock) — one read-only view over every module's history
 * ============================================================================
 * Sources:
 *   - Recorded actions: settings changes and exports (auditStore, append-only).
 *   - Module histories, which are themselves append-only: HR user activity,
 *     attendance corrections, historical import batches, employee
 *     registrations, shop and shift assignment changes.
 *   - Demonstration seed events, labelled origin "seed", for kinds of action
 *     this prototype has no screen for yet.
 *
 * There is no edit or delete function. Visibility follows company access:
 * an event is visible only if the user may see every company it concerns;
 * system-wide events need access to all companies (Super Administrators).
 * In production the audit log must be written and protected by the backend.
 * ============================================================================
 */

import { COMPANIES } from '../constants/companies'
import { authorisedCompanies, can, listHrUsers } from './permissionsService'
import { readRecordedAuditEvents } from './auditStore'
import { readJson } from './mockStore'
import { listAttendanceRoster, mockListAllCorrections } from './attendanceRecordsService'
import { readBatches } from './historicalImportStore'
import { mockListEmployees } from './registrationService'
import { mockGetShop } from './shopsService'
import { mockGetShift } from './shiftsService'

export const AUDIT_CATEGORIES = [
  'Employee Management',
  'Attendance',
  'Shifts & Shops',
  'Sales Rep Monitoring',
  'Notifications & Exceptions',
  'Historical Import',
  'HR Users & Permissions',
  'System Settings',
]

function hashId(key) {
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `AUD-${(h >>> 0).toString(36).toUpperCase().padStart(7, '0')}`
}

function ev(key, fields) {
  return {
    eventId: hashId(key),
    origin: 'action',
    previous: null,
    next: null,
    companyIds: [],
    affected: '',
    description: '',
    actorRole: '',
    ...fields,
  }
}

const roleOf = (name) => listHrUsers().find((u) => u.name === name)?.role ?? ''

function hrUserEvents() {
  const map = {
    'User created': 'HR user created',
    'Role changed': 'Role changed',
    'Permissions changed': 'Permission changed',
    'Company access changed': 'Company access changed',
    'Account activated': 'Account activated',
    'Account deactivated': 'Account deactivated',
    'Details updated': 'HR user details edited',
    'Invitation sent (demo)': 'Invitation sent (demo)',
    'Invitation re-sent (demo)': 'Invitation re-sent (demo)',
    'Invitation accepted (demo)': 'Invitation accepted (demo)',
    'Invitation expired (demo)': 'Invitation expired (demo)',
    'Signed in (demo)': 'Signed in (demo)',
  }
  return listHrUsers().flatMap((u) => u.activity.map((a) => ev(`hr:${a.id}`, {
    origin: a.seed ? 'seed' : 'action',
    source: 'HR Users & Permissions',
    at: a.at,
    action: map[a.action] ?? a.action,
    category: 'HR Users & Permissions',
    actorName: a.by,
    actorRole: a.by === u.name ? u.role : a.by === 'System' ? 'System' : roleOf(a.by),
    companyIds: u.companyIds,
    affected: `${u.name} (${u.email})`,
    description: a.note || '',
    previous: a.previous ?? null,
    next: a.next ?? null,
  })))
}

function correctionEvents(rosterById) {
  return mockListAllCorrections().map((c) => {
    const emp = rosterById.get(c.employeeId)
    const created = c.action === 'Manual record created' || c.action === 'Manual entry created'
    const manual = c.entryMethod === 'manual-entry'
    const action = c.action === 'Manual entry replaced existing record'
      ? 'Attendance record replaced (manual entry)'
      : created
        ? manual ? 'Attendance record created (manual entry)' : 'Attendance record created'
        : 'Attendance record corrected'
    return ev(`cor:${c.id}`, {
      source: manual ? 'Attendance — Manual Entry' : 'Attendance',
      at: c.changedAt,
      action,
      category: 'Attendance',
      actorName: c.changedBy,
      actorRole: c.changedByRole,
      companyIds: emp ? [emp.companyId] : [],
      affected: `${emp?.fullName ?? c.employeeId} (${c.employeeId}) · ${c.date}`,
      description: [c.reason, c.remarks].filter(Boolean).join('. '),
      previous: { clockIn: c.previous.clockIn, clockOut: c.previous.clockOut, status: c.previous.status },
      next: { clockIn: c.next.clockIn, clockOut: c.next.clockOut },
    })
  })
}

function importEvents() {
  const map = {
    'Batch created': 'Import batch created',
    'Submitted for review': 'Batch submitted',
    'Record approved': 'Record approved',
    'Record rejected': 'Record rejected',
    'Approved all eligible records': 'Records approved (all eligible)',
    'Batch rejected': 'Batch rejected',
    'Returned for changes': 'Batch returned for changes',
    'Review completed': 'Batch review completed',
    'Draft saved': 'Draft saved',
    'Batch details updated': 'Batch details edited',
    'Record decision undone': 'Record decision undone',
  }
  return Object.values(readBatches()).flatMap((b) => b.history.map((h) => ev(`imp:${b.batchId}:${h.id}`, {
    source: 'Historical Import',
    at: h.at,
    action: map[h.action] ?? h.action,
    category: 'Historical Import',
    actorName: h.by,
    actorRole: h.byRole,
    companyIds: [b.companyId],
    affected: `Batch "${b.name}"`,
    description: h.note || '',
  })))
}

function employeeEvents(rosterById) {
  const events = mockListEmployees().map((e) => ev(`emp:${e.staffId}`, {
    source: 'Employees',
    at: e.registeredAt,
    action: 'Employee created',
    category: 'Employee Management',
    actorName: 'Employee self-registration',
    actorRole: 'Employee',
    companyIds: [e.companyId],
    affected: `${e.fullName} (${e.staffId})`,
    description: `${e.position}, registered through the employee portal.`,
    next: { position: e.position, company: e.companyName },
  }))
  const shopHistory = readJson('mock-shop-assignments:history', {})
  Object.entries(shopHistory).forEach(([employeeId, list]) => {
    const emp = rosterById.get(employeeId)
    list.forEach((h, i) => events.push(ev(`shop:${employeeId}:${i}:${h.assignedAt}`, {
      source: 'Employees',
      at: h.assignedAt,
      action: 'Employee shop assignment changed',
      category: 'Shifts & Shops',
      actorName: h.assignedBy ?? (i === 0 && !h.previousShopId ? 'Employee self-registration' : 'Not recorded'),
      actorRole: h.assignedBy ? h.assignedByRole ?? '' : i === 0 && !h.previousShopId ? 'Employee' : 'Recorded before actors were captured',
      companyIds: emp ? [emp.companyId] : [],
      affected: `${emp?.fullName ?? employeeId} (${employeeId})`,
      description: `Effective ${String(h.effectiveDate).slice(0, 10)}.`,
      previous: { shop: h.previousShopId ? mockGetShop(h.previousShopId)?.shopName ?? h.previousShopId : 'None' },
      next: { shop: mockGetShop(h.shopId)?.shopName ?? h.shopId },
    })))
  })
  const shiftHistory = readJson('mock-shift-assignments:history', {})
  Object.entries(shiftHistory).forEach(([employeeId, list]) => {
    const emp = rosterById.get(employeeId)
    list.forEach((h, i) => events.push(ev(`shift:${employeeId}:${i}:${h.assignedAt}`, {
      source: 'Shifts',
      at: h.assignedAt,
      action: 'Employee shift assignment changed',
      category: 'Shifts & Shops',
      actorName: h.assignedBy ?? 'Not recorded',
      actorRole: h.assignedBy ? h.assignedByRole ?? '' : 'Recorded before actors were captured',
      companyIds: emp ? [emp.companyId] : [],
      affected: `${emp?.fullName ?? employeeId} (${employeeId})`,
      description: `Effective ${String(h.effectiveDate).slice(0, 10)}.`,
      previous: { shift: h.previousShiftId ? mockGetShift(h.previousShiftId)?.name ?? h.previousShiftId : 'None' },
      next: { shift: mockGetShift(h.shiftId)?.name ?? h.shiftId },
    })))
  })
  return events
}

/** HR actions on notifications (their own append-only history). */
function notificationEvents() {
  const store = readJson('mock-notifications:items', {})
  return Object.values(store).flatMap((n) => n.history
    // System entries and reviews pulled from Sales Monitoring (audited there) are skipped.
    .filter((h) => h.by !== 'System' && h.by !== 'HR (Sales Rep Monitoring)')
    .map((h) => ev(`ntf:${n.id}:${h.id}`, {
      source: 'Notifications & Exceptions',
      at: h.at,
      action: `Notification: ${h.action}`,
      category: 'Notifications & Exceptions',
      actorName: h.by,
      actorRole: roleOf(h.by),
      companyIds: n.companyId ? [n.companyId] : [],
      affected: `${n.title} · ${n.employeeName}${n.employeeId ? ` (${n.employeeId})` : ''}`,
      description: h.note || '',
    })))
}

/** Demonstration seed events — clearly labelled, for actions with no screen yet. */
function seedEvents() {
  const seed = (key, f) => ev(`seed:${key}`, { origin: 'seed', source: 'Demo seed data', ...f })
  return [
    seed('emp-edit', { at: '2026-10-12T10:15:00.000Z', action: 'Employee profile edited', category: 'Employee Management', actorName: 'John Mensah', actorRole: 'HR Manager', companyIds: ['box-for-less'], affected: 'Ama Boateng (BFL-1002)', description: 'Phone number updated after the employee reported a new SIM.', previous: { phone: '+233 20 555 0000' }, next: { phone: '+233 20 555 8891' } }),
    seed('emp-deact', { at: '2026-10-08T14:00:00.000Z', action: 'Employee deactivated', category: 'Employee Management', actorName: 'John Mensah', actorRole: 'HR Manager', companyIds: ['double-a'], affected: 'Former employee DAA-0950 (demo)', description: 'Contract ended.', previous: { status: 'ACTIVE' }, next: { status: 'INACTIVE' } }),
    seed('emp-act', { at: '2026-10-09T09:00:00.000Z', action: 'Employee activated', category: 'Employee Management', actorName: 'John Mensah', actorRole: 'HR Manager', companyIds: ['box-for-less'], affected: 'Isaac Oppong (BFL-1005)', description: 'Onboarding completed.', previous: { status: 'PENDING' }, next: { status: 'ACTIVE' } }),
    seed('att-approve', { at: '2026-10-14T16:30:00.000Z', action: 'Attendance correction approved', category: 'Attendance', actorName: 'John Mensah', actorRole: 'HR Manager', companyIds: ['double-a'], affected: 'Kojo Owusu (DAA-1002) · 2026-10-14', description: 'Supervisor confirmed the arrival time.', previous: { approval: 'Pending' }, next: { approval: 'Approved' } }),
    seed('att-reject', { at: '2026-10-15T11:20:00.000Z', action: 'Attendance record rejected', category: 'Attendance', actorName: 'John Mensah', actorRole: 'HR Manager', companyIds: ['box-for-less'], affected: 'Daniel Mensah (BFL-1003) · 2026-10-15', description: 'Duplicate manual entry.', previous: { status: 'Pending review' }, next: { status: 'Rejected' } }),
  ]
}

/** Every audit event the user may see, newest first. */
export function listAuditEvents(user) {
  if (!can(user, 'audit-logs', 'view')) return []
  const allowed = authorisedCompanies(user).map((c) => c.id)
  const seesAll = COMPANIES.every((c) => allowed.includes(c.id))
  const rosterById = new Map(listAttendanceRoster(null).map((e) => [e.employeeId, e]))
  const all = [
    ...readRecordedAuditEvents(),
    ...hrUserEvents(),
    ...correctionEvents(rosterById),
    ...importEvents(),
    ...employeeEvents(rosterById),
    ...notificationEvents(),
    ...seedEvents(),
  ]
  return all
    .filter((e) => (e.companyIds.length ? e.companyIds.every((c) => allowed.includes(c)) : seesAll))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

export function companyLabel(companyIds) {
  if (!companyIds?.length) return 'System (all companies)'
  return companyIds.map((id) => COMPANIES.find((c) => c.id === id)?.name ?? id).join(' & ')
}

export function auditToCsv(events) {
  const header = ['Event ID', 'Date & time (UTC/Accra)', 'Action', 'Category', 'User responsible', 'User role', 'Company', 'Affected record', 'Description', 'Previous value', 'New value', 'Origin', 'Source']
  const rows = events.map((e) => [e.eventId, e.at, e.action, e.category, e.actorName, e.actorRole, companyLabel(e.companyIds), e.affected, e.description, e.previous ? JSON.stringify(e.previous) : '', e.next ? JSON.stringify(e.next) : '', e.origin === 'seed' ? 'Demo seed data' : 'Recorded mock action', e.source])
  return [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}
