/**
 * ============================================================================
 * MOCK HR USERS & PERMISSIONS SERVICE — NOT PRODUCTION SECURITY
 * ============================================================================
 * One place that answers "may this HR user do X in module Y for company Z?".
 * Every module calls these checks before showing data or actions, and the
 * mock services call them again before changing data, so access does not
 * depend only on hidden navigation links.
 *
 * IMPORTANT: this is a frontend prototype. Anything in the browser can be
 * changed by the person using it. In production every restriction here must
 * be enforced by the backend on every protected API and data operation.
 * There is no real authentication, no passwords, no MFA and no email.
 * ============================================================================
 */

import { COMPANIES } from '../constants/companies'
import { AUDIT_KEY, SETTINGS_KEY, readJson, writeJson } from './mockStore'

const USERS_KEY = 'mock-hr-users:v5'
const SESSION_KEY = 'mock-hr-session'
const INVITE_DAYS = 7

/* --------------------------------------------------------------------------
 * Modules, levels and roles
 * ------------------------------------------------------------------------ */

export const LEVELS = ['view', 'create', 'edit', 'approve', 'export', 'manage']
export const LEVEL_LABELS = { view: 'View', create: 'Create', edit: 'Edit', approve: 'Approve', export: 'Export', manage: 'Manage' }

/** Each module lists only the levels that make sense for it. */
export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', levels: ['view'] },
  { id: 'employees', label: 'Employees', levels: ['view', 'create', 'edit', 'export'] },
  { id: 'attendance', label: 'Attendance', levels: ['view', 'export'] },
  { id: 'attendance-corrections', label: 'Attendance corrections', levels: ['view', 'create', 'edit'] },
  { id: 'sales-monitoring', label: 'Sales Rep Monitoring', levels: ['view', 'edit', 'export'] },
  { id: 'shops', label: 'Shop Directory', levels: ['view', 'create', 'edit'] },
  { id: 'reports', label: 'Reports & Analytics', levels: ['view', 'export'] },
  { id: 'notifications', label: 'Notifications & Exceptions', levels: ['view', 'edit', 'manage'] },
  { id: 'settings', label: 'Settings', levels: ['view', 'edit', 'manage'] },
  { id: 'audit-logs', label: 'Audit Logs', levels: ['view', 'export'] },
]

const ALL = Object.fromEntries(MODULES.map((m) => [m.id, m.levels.slice()]))

/**
 * There is one HR account: the HR Manager, who looks after both companies
 * with full access. There are no other roles or HR users.
 */
export const ROLES = {
  'hr-manager': {
    label: 'HR Manager',
    scope: 'all',
    description: 'The only HR account. Full access to Box For Less and Double A; each company’s records stay separate.',
    ceiling: ALL,
  },
}

export function roleDefaults(roleId) {
  const role = ROLES[roleId]
  const merged = { ...(role?.ceiling ?? {}), ...(role?.defaults ?? {}) }
  return Object.fromEntries(Object.entries(merged).filter(([, l]) => l.length).map(([m, l]) => [m, l.slice()]))
}

/**
 * Check a permission set against its role. Returns a list of problems
 * (empty when safe).
 */
export function validateGrants(roleId, grants) {
  const role = ROLES[roleId]
  if (!role) return ['Choose a role.']
  const problems = []
  const has = (m, l) => (grants[m] ?? []).includes(l)
  Object.entries(grants).forEach(([m, levels]) => {
    const mod = MODULES.find((x) => x.id === m)
    if (!mod) { problems.push(`Unknown module "${m}".`); return }
    levels.forEach((l) => {
      if (!mod.levels.includes(l)) problems.push(`${mod.label} has no ${LEVEL_LABELS[l] ?? l} level.`)
      else if (!(role.ceiling[m] ?? []).includes(l)) problems.push(`${role.label}s cannot have ${LEVEL_LABELS[l]} on ${mod.label}.`)
    })
    if (levels.length && !levels.includes('view')) problems.push(`${mod.label}: ${levels.map((l) => LEVEL_LABELS[l]).join(', ')} needs View as well.`)
  })
  if (!has('dashboard', 'view')) problems.push('Every HR user needs to view the Dashboard.')
  if ((grants['attendance-corrections'] ?? []).length && !has('attendance', 'view')) problems.push('Attendance corrections need Attendance view.')
  if (has('reports', 'export') && !has('attendance', 'view')) problems.push('Exporting reports needs Attendance view.')
  if ((has('hr-users', 'create') || has('hr-users', 'edit') || has('hr-users', 'manage')) && !has('audit-logs', 'view')) {
    problems.push('Anyone who can change HR users must be able to view the Audit Logs.')
  }
  return problems
}

/* --------------------------------------------------------------------------
 * Users store (seeded)
 * ------------------------------------------------------------------------ */

const BOTH = COMPANIES.map((c) => c.id)
const daysAgo = (n, hour = 9) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

function activity(action, by, note = '', at = new Date().toISOString(), extra = {}) {
  return { id: uid('ACT'), at, action, by, note, ...extra }
}

function seedUser(id, name, email, roleId, companyIds, { status = 'active', createdDaysAgo = 60, lastLogin = 1, invitation } = {}) {
  const createdAt = daysAgo(createdDaysAgo)
  const inv = invitation ?? { status: 'accepted', sentAt: createdAt, expiresAt: daysAgo(createdDaysAgo - INVITE_DAYS), acceptedAt: daysAgo(createdDaysAgo - 1) }
  const log = [activity('Account created', 'System', `${ROLES[roleId].label}`, createdAt)]
  const lastLoginAt = status === 'active' && lastLogin != null ? daysAgo(lastLogin, 8) : null
  if (lastLoginAt) log.push(activity('Signed in (demo)', name, '', lastLoginAt))
  // Mark seeded history so the audit log can tell it apart from real demo actions.
  log.forEach((a) => { a.seed = true })
  return {
    id,
    name,
    initials: name.split(' ').map((p) => p[0]).slice(0, 2).join(''),
    email,
    roleId,
    role: ROLES[roleId].label,
    companyIds,
    grants: roleDefaults(roleId),
    customised: false,
    status,
    invitation: inv,
    createdAt,
    createdBy: 'System',
    lastLoginAt,
    activity: log,
  }
}

function seedUsers() {
  // The single HR account, responsible for both Box For Less and Double A.
  const john = seedUser('hr-john-mensah', 'John Mensah', 'john.mensah@example.com', 'hr-manager', BOTH, { createdDaysAgo: 110 })
  return { [john.id]: john }
}

/**
 * HR users that existed in earlier versions of this demo. When the single-user
 * store is first created, their accounts and the records about them are
 * removed from browser storage (audit entries they made or that are about
 * them, notification assignments and their notification history entries).
 */
const REMOVED_HR_USERS = [
  { id: 'hr-grace-ansah', name: 'Grace Ansah' },
  { id: 'hr-akosua-nyarko', name: 'Akosua Nyarko' },
  { id: 'hr-kofi-asare', name: 'Kofi Asare' },
  { id: 'hr-yaw-ofori', name: 'Yaw Ofori' },
  { id: 'hr-ama-sarpong', name: 'Ama Sarpong' },
]

export function purgeRemovedHrUsers() {
  const ids = new Set(REMOVED_HR_USERS.map((u) => u.id))
  const names = REMOVED_HR_USERS.map((u) => u.name)
  const mentions = (v) => typeof v === 'string' && names.some((n) => v.includes(n))
  try {
    ;['mock-hr-users:v1', 'mock-hr-users:v2', 'mock-hr-users:v3', 'mock-hr-users:v4'].forEach((k) => window.localStorage.removeItem(k))
  } catch { /* ignore */ }
  const session = getSession()
  if (session && ids.has(session.userId)) writeSession(null)
  const audit = readJson(AUDIT_KEY, null)
  if (Array.isArray(audit)) {
    writeJson(AUDIT_KEY, audit.filter((e) => !mentions(e.actorName) && !mentions(e.affected) && !mentions(e.description)))
  }
  const notes = readJson('mock-notifications:items', null)
  if (Array.isArray(notes)) {
    notes.forEach((n) => {
      if (n.assignedTo && ids.has(n.assignedTo.id)) n.assignedTo = null
      if (Array.isArray(n.history)) n.history = n.history.filter((h) => !mentions(h.by) && !mentions(h.note))
      ;['resolution', 'dismissal'].forEach((k) => { if (n[k] && mentions(n[k].by)) n[k] = { ...n[k], by: 'Former HR user', byRole: '' } })
    })
    writeJson('mock-notifications:items', notes)
  }
}

const KNOWN_MODULES = new Set(MODULES.map((m) => m.id))

/** Drop permissions for modules that no longer exist (e.g. Historical Import). */
function sanitise(users) {
  Object.values(users).forEach((u) => {
    u.grants = Object.fromEntries(Object.entries(u.grants ?? {}).filter(([m]) => KNOWN_MODULES.has(m)))
  })
  return users
}

function readUsers() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(USERS_KEY))
    if (stored && typeof stored === 'object') return sanitise(stored)
  } catch {
    // fall through to seed
  }
  const seeded = seedUsers()
  writeUsers(seeded)
  purgeRemovedHrUsers()
  return seeded
}

function writeUsers(users) {
  try {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(users))
  } catch {
    // Ignore — mock persistence only.
  }
}

/** Invitation status, with Expired computed from the expiry time. */
export function invitationStatus(user) {
  const inv = user.invitation
  if (!inv) return 'draft'
  if (inv.status === 'sent' && inv.expiresAt && inv.expiresAt < new Date().toISOString()) return 'expired'
  return inv.status
}

export function listHrUsers() {
  return Object.values(readUsers()).sort((a, b) => a.name.localeCompare(b.name))
}

export function getHrUser(id) {
  return readUsers()[id] ?? null
}

/* --------------------------------------------------------------------------
 * Checks (re-read the store, so a deactivated user loses access at once)
 * ------------------------------------------------------------------------ */

function current(user) {
  if (!user?.id) return null
  return readUsers()[user.id] ?? null
}

export function isActive(user) {
  return current(user)?.status === 'active'
}

/** May this user do `level` in `module`? Inactive users can do nothing. */
export function can(user, moduleId, level = 'view') {
  const u = current(user)
  if (!u || u.status !== 'active') return false
  return (u.grants[moduleId] ?? []).includes(level)
}

/** May this user see this company's records? */
export function canAccessCompany(user, companyId) {
  const u = current(user)
  if (!u || u.status !== 'active') return false
  return u.companyIds.includes(companyId)
}

/** Companies the user may see, in the standard order. */
export function authorisedCompanies(user) {
  return COMPANIES.filter((c) => canAccessCompany(user, c.id))
}

/**
 * Reduce a requested company filter to what the user may see. An empty value
 * means "all of the user's companies". Never widens access.
 */
export function scopeCompanyIds(user, requestedCompanyId) {
  const allowed = authorisedCompanies(user).map((c) => c.id)
  if (!requestedCompanyId) return allowed
  return allowed.includes(requestedCompanyId) ? [requestedCompanyId] : []
}

/* --------------------------------------------------------------------------
 * Demo session (no real authentication)
 * ------------------------------------------------------------------------ */

export function getSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY)) ?? null
  } catch {
    return null
  }
}

function writeSession(session) {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else window.localStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore.
  }
}

/** The signed-in demo user, or null (no session, expired, or account not active). */
/** Session length from Security settings (demo; read directly to avoid an import cycle). */
export function sessionTimeoutMinutes() {
  return Number(readJson(SETTINGS_KEY, {})?.security?.sessionTimeoutMinutes) || 60
}

export function getSessionUser() {
  const s = getSession()
  if (!s || s.expired) return null
  if (s.signedInAt && Date.now() - Date.parse(s.signedInAt) > sessionTimeoutMinutes() * 60000) {
    writeSession({ ...s, expired: true })
    return null
  }
  const u = readUsers()[s.userId]
  return u && u.status === 'active' ? u : null
}

/** Demo sign-in: pick an active user. No password; not authentication. */
export function demoSignIn(userId) {
  const users = readUsers()
  const u = users[userId]
  if (!u) return { error: 'User not found.' }
  if (u.status === 'inactive') return { error: 'This account is deactivated.' }
  if (u.status !== 'active') return { error: 'This user has not accepted their invitation yet.' }
  u.lastLoginAt = new Date().toISOString()
  u.activity.push(activity('Signed in (demo)', u.name))
  writeUsers(users)
  writeSession({ userId, signedInAt: u.lastLoginAt, expired: false })
  return { user: u }
}

export function demoExpireSession() {
  const s = getSession()
  if (s) writeSession({ ...s, expired: true })
}

export function demoSignOut() {
  writeSession(null)
}

/* --------------------------------------------------------------------------
 * Administration (Super Administrator only, enforced here)
 * ------------------------------------------------------------------------ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normaliseCompanies(roleId, companyIds) {
  const scope = ROLES[roleId]?.scope
  if (scope === 'all') return BOTH.slice()
  // Keep the standard company order and drop anything unknown or repeated.
  const chosen = BOTH.filter((c) => (companyIds ?? []).includes(c))
  return scope === 'multi' ? chosen : chosen.slice(0, 1)
}

export function validateUser(data, { users, editingId } = {}) {
  const errors = {}
  if ((data.name ?? '').trim().length < 3) errors.name = 'Enter the full name.'
  const email = (data.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) errors.email = 'Enter a valid email address.'
  else if (Object.values(users ?? readUsers()).some((u) => u.id !== editingId && u.email.toLowerCase() === email)) {
    errors.email = 'Another HR user already uses this email.'
  }
  if (!ROLES[data.roleId]) errors.roleId = 'Choose a role.'
  else if (ROLES[data.roleId].scope === 'single') {
    if ((data.companyIds ?? []).length !== 1) errors.companyIds = 'HR Officers are assigned exactly one company.'
    else if (!BOTH.includes(data.companyIds[0])) errors.companyIds = 'Choose a company.'
  } else if (ROLES[data.roleId].scope === 'multi') {
    const ids = data.companyIds ?? []
    if (!ids.length) errors.companyIds = 'Choose at least one company.'
    else if (ids.some((c) => !BOTH.includes(c))) errors.companyIds = 'Choose valid companies.'
  }
  const problems = ROLES[data.roleId] ? validateGrants(data.roleId, data.grants ?? {}) : []
  if (problems.length) errors.grants = problems
  return errors
}

function guardAdmin(actor, level) {
  if (!can(actor, 'hr-users', level)) return 'Only a Super Administrator can manage HR users.'
  return null
}

function activeSuperAdmins(users) {
  return Object.values(users).filter((u) => u.roleId === 'super-admin' && u.status === 'active')
}

function cleanGrants(grants) {
  return Object.fromEntries(Object.entries(grants).filter(([, l]) => l.length).map(([m, l]) => [m, LEVELS.filter((x) => l.includes(x))]))
}

function grantDiff(before, after) {
  const added = []
  const removed = []
  MODULES.forEach((m) => {
    const a = before[m.id] ?? []
    const b = after[m.id] ?? []
    b.filter((l) => !a.includes(l)).forEach((l) => added.push(`${m.label} → ${LEVEL_LABELS[l]}`))
    a.filter((l) => !b.includes(l)).forEach((l) => removed.push(`${m.label} → ${LEVEL_LABELS[l]}`))
  })
  return { added, removed }
}

export function describeGrantChange(before, after) {
  const { added, removed } = grantDiff(before, after)
  return [added.length ? `Added: ${added.join(', ')}` : '', removed.length ? `Removed: ${removed.join(', ')}` : ''].filter(Boolean).join(' · ')
}

function sameGrants(a, b) {
  return JSON.stringify(cleanGrants(a)) === JSON.stringify(cleanGrants(b))
}

export function mockCreateHrUser(data, actor) {
  const denied = guardAdmin(actor, 'create')
  if (denied) return { errors: { form: denied } }
  const users = readUsers()
  const input = { ...data, companyIds: normaliseCompanies(data.roleId, data.companyIds), grants: cleanGrants(data.grants ?? roleDefaults(data.roleId)) }
  const errors = validateUser(input, { users })
  if (Object.keys(errors).length) return { errors }
  const name = input.name.trim()
  const now = new Date().toISOString()
  const id = `hr-${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${Date.now().toString(36)}`
  const user = {
    id,
    name,
    initials: name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase(),
    email: input.email.trim().toLowerCase(),
    roleId: input.roleId,
    role: ROLES[input.roleId].label,
    companyIds: input.companyIds,
    grants: input.grants,
    customised: !sameGrants(input.grants, roleDefaults(input.roleId)),
    status: 'pending',
    invitation: { status: 'draft', sentAt: null, expiresAt: null, acceptedAt: null },
    createdAt: now,
    createdBy: actor.name,
    lastLoginAt: null,
    activity: [activity('User created', actor.name, `${ROLES[input.roleId].label} · ${input.companyIds.map((c) => COMPANIES.find((x) => x.id === c)?.name).join(' & ')}`)],
  }
  users[id] = user
  writeUsers(users)
  return { user }
}

export function mockUpdateHrUser(id, data, actor) {
  const denied = guardAdmin(actor, 'edit')
  if (denied) return { errors: { form: denied } }
  const users = readUsers()
  const user = users[id]
  if (!user) return { errors: { form: 'User not found.' } }
  const input = { ...data, companyIds: normaliseCompanies(data.roleId, data.companyIds), grants: cleanGrants(data.grants) }
  const errors = validateUser(input, { users, editingId: id })
  if (Object.keys(errors).length) return { errors }
  if (id === actor.id && input.roleId !== user.roleId) return { errors: { roleId: 'You cannot change your own role.' } }
  if (user.roleId === 'super-admin' && input.roleId !== 'super-admin' && user.status === 'active' && activeSuperAdmins(users).length <= 1) {
    return { errors: { roleId: 'This is the only active Super Administrator. Add another before changing this role.' } }
  }
  const log = []
  if (user.name !== input.name.trim() || user.email !== input.email.trim().toLowerCase()) {
    log.push(activity('Details updated', actor.name, `${user.name} <${user.email}> → ${input.name.trim()} <${input.email.trim().toLowerCase()}>`))
  }
  if (user.roleId !== input.roleId) log.push(activity('Role changed', actor.name, `${user.role} → ${ROLES[input.roleId].label}`, undefined, { previous: { role: user.role }, next: { role: ROLES[input.roleId].label } }))
  if (JSON.stringify(user.companyIds) !== JSON.stringify(input.companyIds)) {
    const names = (ids) => ids.map((c) => COMPANIES.find((x) => x.id === c)?.name).join(' & ')
    log.push(activity('Company access changed', actor.name, `${names(user.companyIds)} → ${names(input.companyIds)}`, undefined, { previous: { companies: names(user.companyIds) }, next: { companies: names(input.companyIds) } }))
  }
  if (!sameGrants(user.grants, input.grants)) log.push(activity('Permissions changed', actor.name, describeGrantChange(user.grants, input.grants), undefined, { previous: { grants: user.grants }, next: { grants: input.grants } }))
  if (!log.length) return { errors: { form: 'Nothing has changed.' } }
  Object.assign(user, {
    name: input.name.trim(),
    initials: input.name.trim().split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase(),
    email: input.email.trim().toLowerCase(),
    roleId: input.roleId,
    role: ROLES[input.roleId].label,
    companyIds: input.companyIds,
    grants: input.grants,
    customised: !sameGrants(input.grants, roleDefaults(input.roleId)),
  })
  user.activity.push(...log)
  writeUsers(users)
  return { user }
}

export function mockSetUserActive(id, active, reason, actor) {
  const denied = guardAdmin(actor, 'manage')
  if (denied) return { error: denied }
  const users = readUsers()
  const user = users[id]
  if (!user) return { error: 'User not found.' }
  if (id === actor.id) return { error: 'You cannot deactivate your own account.' }
  if ((reason ?? '').trim().length < 5) return { error: 'Give a reason (at least 5 characters).' }
  if (active) {
    if (user.status === 'active') return { error: 'Already active.' }
    if (invitationStatus(user) !== 'accepted') return { error: 'The user must accept their invitation before the account can be active.' }
    user.status = 'active'
    user.activity.push(activity('Account activated', actor.name, reason.trim(), undefined, { previous: { status: 'inactive' }, next: { status: 'active' } }))
  } else {
    if (user.status === 'inactive') return { error: 'Already inactive.' }
    if (user.roleId === 'super-admin' && activeSuperAdmins(users).length <= 1) return { error: 'You cannot deactivate the only active Super Administrator.' }
    user.status = 'inactive'
    user.activity.push(activity('Account deactivated', actor.name, reason.trim(), undefined, { previous: { status: 'active' }, next: { status: 'inactive' } }))
  }
  writeUsers(users)
  return { user }
}

/** Demo invitation: nothing is emailed. */
export function mockSendInvitation(id, actor) {
  const denied = guardAdmin(actor, 'create')
  if (denied) return { error: denied }
  const users = readUsers()
  const user = users[id]
  if (!user) return { error: 'User not found.' }
  const st = invitationStatus(user)
  if (st === 'accepted') return { error: 'This invitation has already been accepted.' }
  const now = new Date()
  user.invitation = { status: 'sent', sentAt: now.toISOString(), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString(), acceptedAt: null }
  user.activity.push(activity(st === 'draft' ? 'Invitation sent (demo)' : 'Invitation re-sent (demo)', actor.name, `Expires in ${INVITE_DAYS} days. No email was sent; demo only.`))
  writeUsers(users)
  return { user }
}

/** Demo: simulate the invitee accepting. */
export function mockAcceptInvitation(id) {
  const users = readUsers()
  const user = users[id]
  if (!user) return { error: 'User not found.' }
  const st = invitationStatus(user)
  if (st !== 'sent') return { error: st === 'expired' ? 'This invitation has expired. Re-send it first.' : 'Send the invitation first.' }
  user.invitation = { ...user.invitation, status: 'accepted', acceptedAt: new Date().toISOString() }
  user.status = 'active'
  user.activity.push(activity('Invitation accepted (demo)', user.name), activity('Account activated', 'System', 'Invitation accepted.'))
  writeUsers(users)
  return { user }
}

/** Demo: move the invitation's expiry into the past. */
export function mockExpireInvitation(id, actor) {
  const denied = guardAdmin(actor, 'create')
  if (denied) return { error: denied }
  const users = readUsers()
  const user = users[id]
  if (!user || invitationStatus(user) !== 'sent') return { error: 'Only a sent invitation can expire.' }
  user.invitation = { ...user.invitation, expiresAt: new Date(Date.now() - 60000).toISOString() }
  user.activity.push(activity('Invitation expired (demo)', actor.name))
  writeUsers(users)
  return { user }
}

/** Every user's activity as one audit log, newest first (users the actor may see). */
export function mockAuditLog(actor) {
  if (!can(actor, 'audit-logs', 'view')) return []
  const companies = authorisedCompanies(actor).map((c) => c.id)
  return listHrUsers()
    .filter((u) => u.companyIds.some((c) => companies.includes(c)))
    .flatMap((u) => u.activity.map((a) => ({ ...a, userId: u.id, userName: u.name })))
    .sort((a, b) => b.at.localeCompare(a.at))
}
