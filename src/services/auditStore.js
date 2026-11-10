/**
 * Append-only store for audit events recorded directly by mock services
 * (settings changes, data exports). There is deliberately no update or delete
 * function. In production the audit log must be written and protected by the
 * backend; anything in browser storage can be altered by the user.
 */
import { AUDIT_KEY, readJson, writeJson } from './mockStore'

/**
 * @param {object} e { action, category, actor: {name, role}, companyIds: [],
 *   affected, description, previous, next }
 */
export function recordAuditEvent(e) {
  const events = readJson(AUDIT_KEY, [])
  const event = {
    eventId: `AUD-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    at: new Date().toISOString(),
    origin: 'action',
    source: e.source ?? 'Settings',
    action: e.action,
    category: e.category,
    actorName: e.actor?.name ?? 'System',
    actorRole: e.actor?.role ?? '',
    companyIds: e.companyIds ?? [],
    affected: e.affected ?? '',
    description: e.description ?? '',
    previous: e.previous ?? null,
    next: e.next ?? null,
  }
  events.push(event)
  writeJson(AUDIT_KEY, events)
  return event
}

export function readRecordedAuditEvents() {
  return readJson(AUDIT_KEY, []).slice()
}
