/**
 * HR notifications. The server raises them from attendance, SMS and assignment
 * data, and keeps an append-only history of every action.
 */

import { OPEN_STATUSES, SEVERITIES } from '../constants/notificationTypes'
import { accraDateKey } from '../utils/accraTime'
import { api, submit } from './backend/client'
import { refresh, rows } from './backend/cache'
import { canViewCompany } from '../constants/hrUser'

const TABLES = ['notifications', 'notification_history', 'audit_events', 'monitoring_alert_reviews']

let lastSyncedAt = null

function historyFromRow(row) {
  return { id: row.id, at: row.at, action: row.action, by: row.by, note: row.note, isComment: row.is_comment }
}

function fromRow(row, history) {
  return {
    id: row.id,
    sourceKey: row.source_key,
    type: row.type,
    category: row.category,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    description: row.description,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    companyId: row.company_id,
    companyName: row.company_name,
    position: row.position,
    relatedDate: row.related_date,
    smsEventId: row.sms_event_id,
    salesExceptionId: row.sales_exception_id,
    correctionId: row.correction_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    createdAt: row.created_at,
    read: row.read,
    status: row.status,
    assignedTo: row.assigned_to,
    resolution: row.resolution,
    dismissal: row.dismissal,
    conditionClearedAt: row.condition_cleared_at,
    salesSyncedAt: row.sales_synced_at,
    history,
  }
}

function allNotifications() {
  const history = new Map()
  rows('notification_history').forEach((row) => {
    history.set(row.notification_id, [...(history.get(row.notification_id) ?? []), historyFromRow(row)])
  })
  return rows('notifications').map((row) => fromRow(row, history.get(row.id) ?? []))
}

function sortNotifications(a, b) {
  return b.occurredAt.localeCompare(a.occurredAt) || SEVERITIES[a.severity].rank - SEVERITIES[b.severity].rank
}

/** Run detection on the server now, then show the result. */
export async function syncNotifications() {
  const before = rows('notifications').length
  await api('/hr/notifications/sync', { method: 'POST', body: {} })
  await refresh(...TABLES)
  lastSyncedAt = new Date().toISOString()
  return { added: rows('notifications').length - before, total: rows('notifications').length, syncedAt: lastSyncedAt }
}

export function getLastSyncedAt() {
  return lastSyncedAt
}

export function listNotifications(user) {
  if (!user) return []
  return allNotifications().filter((n) => canViewCompany(user, n.companyId)).sort(sortNotifications)
}

export function getNotification(id, user) {
  return listNotifications(user).find((n) => n.id === id) ?? null
}

export function isOpen(n) {
  return OPEN_STATUSES.includes(n.status)
}

export function requiresHrAttention(n) {
  return isOpen(n) && (n.severity === 'critical' || n.severity === 'high')
}

export function summariseNotifications(list) {
  return {
    total: list.length,
    unread: list.filter((n) => !n.read).length,
    critical: list.filter((n) => n.severity === 'critical' && isOpen(n)).length,
    pending: list.filter((n) => n.kind === 'exception' && isOpen(n)).length,
    resolved: list.filter((n) => n.kind === 'exception' && n.status === 'resolved').length,
    attention: list.filter(requiresHrAttention).length,
  }
}

export function unreadCount(user) {
  return listNotifications(user).filter((n) => !n.read).length
}

export function notificationDateKey(n) {
  return accraDateKey(new Date(n.occurredAt))
}

async function act(id, body) {
  const result = await submit(`/hr/notifications/${encodeURIComponent(id)}`, { method: 'POST', body })
  if (result.error) return { error: result.error }
  await refresh(...TABLES)
  return { ok: true }
}

export const setNotificationRead = (id, read) => act(id, { action: read ? 'read' : 'unread' })
export const assignNotification = (id, assigneeId) => act(id, { action: 'assign', assigneeId })
export const addNotificationComment = (id, text) => act(id, { action: 'comment', text })
export const startNotificationReview = (id, note = '') => act(id, { action: 'review', note })
export const resolveNotification = (id, { actionTaken, notes }) => act(id, { action: 'resolve', actionTaken, notes })
export const dismissNotification = (id, { reason }) => act(id, { action: 'dismiss', reason })
export const reopenNotification = (id, reason) => act(id, { action: 'reopen', reason })

export async function markAllNotificationsRead(ids) {
  const result = await submit('/hr/notifications/mark-read', { method: 'POST', body: { ids } })
  if (result.error) return { error: result.error, count: 0 }
  await refresh(...TABLES)
  return { count: result.count }
}
