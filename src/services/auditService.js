/** The audit log. The server writes it and nobody can change it. */

import { COMPANIES } from '../constants/companies'
import { authorisedCompanies, can } from './permissionsService'
import { rows } from './backend/cache'

export const AUDIT_CATEGORIES = [
  'Employee Management',
  'Attendance',
  'Shifts & Shops',
  'Sales Rep Monitoring',
  'Notifications & Exceptions',
  'HR Users & Permissions',
  'System Settings',
]

function fromRow(row) {
  return {
    eventId: row.event_id,
    at: row.at,
    origin: row.origin,
    source: row.source,
    action: row.action,
    category: row.category,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    companyIds: row.company_ids,
    affected: row.affected,
    description: row.description,
    previous: row.previous,
    next: row.next,
  }
}

/** Newest first. An event is visible only if the user may see every company it concerns. */
export function listAuditEvents(user) {
  if (!can(user, 'audit-logs', 'view')) return []
  const allowed = authorisedCompanies(user).map((c) => c.id)
  const seesAll = COMPANIES.every((c) => allowed.includes(c.id))
  return rows('audit_events')
    .map(fromRow)
    .filter((e) => (e.companyIds.length ? e.companyIds.every((c) => allowed.includes(c)) : seesAll))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

export function companyLabel(companyIds) {
  if (!companyIds?.length) return 'System (all companies)'
  return companyIds.map((id) => COMPANIES.find((c) => c.id === id)?.name ?? id).join(' & ')
}

export function auditToCsv(events) {
  const header = ['Event ID', 'Date & time (UTC/Accra)', 'Action', 'Category', 'User responsible', 'User role', 'Company', 'Affected record', 'Description', 'Previous value', 'New value', 'Source']
  const rowsOut = events.map((e) => [e.eventId, e.at, e.action, e.category, e.actorName, e.actorRole, companyLabel(e.companyIds), e.affected, e.description, e.previous ? JSON.stringify(e.previous) : '', e.next ? JSON.stringify(e.next) : '', e.source])
  return [header, ...rowsOut].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}
