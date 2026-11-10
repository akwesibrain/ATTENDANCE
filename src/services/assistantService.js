/**
 * ============================================================================
 * HR ASSISTANT (demo) — rule-based answers from the shared mock data
 * ============================================================================
 * Not an AI model. Questions are matched against a fixed set of topics and
 * answered by calculating from the same services every module uses, so the
 * numbers always agree with the pages.
 *
 * Rules:
 *   - Read-only: it never creates, edits or deletes anything.
 *   - Every answer is limited to what the signed-in user may see: the module
 *     permission is checked and only their companies are included.
 *   - Nothing is guessed: no data → it says so.
 *   - Future SMS verification times are never revealed.
 *   - A missed verification is never described as absence or misconduct.
 *
 * To use a real AI model later, call a backend endpoint from askAssistant()
 * (never put an API key in the browser) and keep the same response shape.
 * ============================================================================
 */

import { COMPANIES } from '../constants/companies'
import { ATTENDANCE_STATUS } from '../constants/attendanceLabels'
import { LEVEL_LABELS, MODULES, authorisedCompanies, can } from './permissionsService'
import { listAttendanceRecords, listAttendanceRoster, summariseAttendance } from './attendanceRecordsService'
import { mockListNotifications } from './notificationsService'
import { mockListAllShops } from './shopsService'
import { companyDisplayName, defaultHoursFor } from './settingsService'
import { elapsedPeriodDateKeys, periodForDateKey } from '../utils/attendanceRules'
import { accraTodayKey, addDaysToKey, formatAccraDate, formatAccraTime } from '../utils/accraTime'

export const SUGGESTIONS = [
  'Who is absent today?',
  'Who is late today?',
  'Attendance summary today',
  'Open exceptions',
  'Missed verifications this week',
  'How do I enter attendance manually?',
  'Current attendance period',
  'What can I do?',
]

const MAX_ITEMS = 12

const norm = (t) => (t ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
const has = (q, ...words) => words.some((w) => (w instanceof RegExp ? w.test(q) : q.includes(w)))
const nameOf = (id) => companyDisplayName(id, COMPANIES.find((c) => c.id === id)?.name ?? id)

function reply(text, extra = {}) {
  return { text, items: [], links: [], suggestions: [], ...extra }
}

function denied(moduleLabel) {
  return reply(`Your role doesn't include ${moduleLabel}, so I can't answer that.`)
}

/**
 * Companies the answer covers: the dashboard's current company (or all of the
 * user's companies), narrowed further if the question names a company.
 */
function resolveScope(q, user, companyId) {
  const allowed = authorisedCompanies(user).map((c) => c.id)
  const named = COMPANIES.filter((c) => q.includes(c.name.toLowerCase()) || q.includes(nameOf(c.id).toLowerCase()) || q.includes(c.initials.toLowerCase() + ' '))
  if (named.length) {
    const ok = named.filter((c) => allowed.includes(c.id)).map((c) => c.id)
    const blocked = named.filter((c) => !allowed.includes(c.id))
    return { ids: ok, blocked }
  }
  if (companyId && allowed.includes(companyId)) return { ids: [companyId], blocked: [] }
  return { ids: allowed, blocked: [] }
}

const scopeLabel = (ids) => (ids.length > 1 ? 'all your companies' : nameOf(ids[0]))

function todayRecords(ids) {
  const today = accraTodayKey()
  return listAttendanceRecords({ companyId: ids.length === 1 ? ids[0] : null, dates: [today] }).filter((r) => ids.includes(r.companyId))
}

function recordItem(r, ids, detail) {
  return {
    primary: `${r.fullName} (${r.employeeId})`,
    secondary: [ids.length > 1 ? nameOf(r.companyId) : null, r.position, detail].filter(Boolean).join(' · '),
  }
}

function capped(list) {
  return { items: list.slice(0, MAX_ITEMS), more: Math.max(0, list.length - MAX_ITEMS) }
}

function moreNote(more) {
  return more ? ` Showing the first ${MAX_ITEMS}; ${more} more on the page.` : ''
}

/* --------------------------------------------------------------------------
 * Topics
 * ------------------------------------------------------------------------ */

function attendanceToday(kind, ids) {
  const recs = todayRecords(ids)
  if (!recs.length) return reply(`There are no employees tracked for ${scopeLabel(ids)} today.`)
  const pick = {
    absent: { filter: (r) => r.status === 'absent', none: 'Nobody is absent so far today.', title: 'absent', detail: (r) => r.explicitAbsentReason ?? `no clock-in; working day ended ${formatAccraTime(r.expectedEnd)}` },
    late: { filter: (r) => r.isLate, none: 'Nobody has clocked in late today.', title: 'late', detail: (r) => `clocked in ${formatAccraTime(r.clockIn)} (${r.lateMinutes} min after start)` },
    atWork: { filter: (r) => r.atWork, none: 'Nobody is currently clocked in.', title: 'currently at work', detail: (r) => `since ${formatAccraTime(r.clockIn)}` },
    leave: { filter: (r) => r.status === 'on-leave', none: 'Nobody is on approved leave today.', title: 'on approved leave', detail: (r) => r.leave?.leaveType ?? 'leave recorded' },
    awaiting: { filter: (r) => r.status === 'awaiting', none: 'Everyone due so far has clocked in.', title: 'awaiting clock-in (day started, not yet absent)', detail: (r) => `day started ${formatAccraTime(r.expectedStart)}` },
  }[kind]
  const list = recs.filter(pick.filter).sort((a, b) => a.fullName.localeCompare(b.fullName))
  const note = kind === 'absent' ? ' Nobody is marked absent before the working day has ended, and approved leave is never absence.' : ''
  if (!list.length) return reply(`${pick.none} (${scopeLabel(ids)}, ${formatAccraDate(accraTodayKey())})${note}`, { links: [{ label: 'Open Attendance', nav: 'attendance' }] })
  const { items, more } = capped(list.map((r) => recordItem(r, ids, pick.detail(r))))
  return reply(`${list.length} ${list.length === 1 ? 'employee is' : 'employees are'} ${pick.title} today (${scopeLabel(ids)}).${note}${moreNote(more)}`, { items, links: [{ label: 'Open Attendance', nav: 'attendance' }] })
}

function summaryToday(ids) {
  const recs = todayRecords(ids)
  if (!recs.length) return reply(`There are no employees tracked for ${scopeLabel(ids)} today.`)
  const items = ids.map((id) => {
    const r = recs.filter((x) => x.companyId === id)
    const s = summariseAttendance(r)
    return { primary: nameOf(id), secondary: `${r.length} employees · ${s.present} present · ${s.absent} absent · ${s.late} late · ${s.atWork} at work · ${s.onLeave} on leave` }
  })
  const s = summariseAttendance(recs)
  return reply(`Today (${formatAccraDate(accraTodayKey())}): ${s.present} present, ${s.absent} absent, ${s.late} late, ${s.atWork} currently at work, ${s.onLeave} on leave, across ${scopeLabel(ids)}.`, { items: ids.length > 1 ? items : [], links: [{ label: 'Open Dashboard', nav: 'dashboard' }, { label: 'Open Attendance', nav: 'attendance' }] })
}

function incompleteThisPeriod(ids) {
  const today = accraTodayKey()
  const period = periodForDateKey(today)
  const recs = listAttendanceRecords({ companyId: ids.length === 1 ? ids[0] : null, dates: elapsedPeriodDateKeys(period, today) }).filter((r) => ids.includes(r.companyId) && r.status === 'incomplete')
  if (!recs.length) return reply(`There are no incomplete records in the ${period.label} period so far (${scopeLabel(ids)}).`)
  const { items, more } = capped(recs.map((r) => recordItem(r, ids, `${formatAccraDate(r.date, { day: 'numeric', month: 'short' })}: in ${formatAccraTime(r.clockIn)}, no clock-out`)))
  return reply(`${recs.length} incomplete ${recs.length === 1 ? 'record' : 'records'} in the ${period.label} period (clock-in without clock-out).${moreNote(more)}`, { items, links: [{ label: 'Open Attendance', nav: 'attendance' }] })
}

function periodInfo() {
  const today = accraTodayKey()
  const p = periodForDateKey(today)
  const opts = { day: 'numeric', month: 'long', year: 'numeric' }
  return reply(`The current attendance period is ${p.label}: ${p.start.toLocaleDateString([], opts)} to ${p.end.toLocaleDateString([], opts)}. Periods always run from the 26th of one month to the 25th of the next (Africa/Accra time), and future dates are never counted as absences.`)
}

function employeeLookup(emp, user) {
  const today = accraTodayKey()
  const period = periodForDateKey(today)
  const recs = listAttendanceRecords({ companyId: emp.companyId, dates: elapsedPeriodDateKeys(period, today) }).filter((r) => r.employeeId === emp.employeeId)
  const t = recs.find((r) => r.date === today)
  const workdays = recs.filter((r) => r.workday)
  const present = workdays.filter((r) => r.hasAttendance).length
  const absent = recs.filter((r) => r.status === 'absent').length
  const late = recs.filter((r) => r.isLate).length
  const leave = recs.filter((r) => r.status === 'on-leave').length
  const due = present + absent
  const todayText = t
    ? `${ATTENDANCE_STATUS[t.status]?.label ?? t.status}${t.clockIn ? `, clocked in ${formatAccraTime(t.clockIn)}` : ''}${t.clockOut ? `, out ${formatAccraTime(t.clockOut)}` : ''}`
    : 'no record today'
  const items = [
    { primary: 'Company and role', secondary: `${nameOf(emp.companyId)} · ${emp.position}` },
    { primary: 'Working hours', secondary: t ? `${t.schedule.startTime}–${t.schedule.endTime}` : 'Standard working hours' },
    { primary: 'Shop', secondary: t?.shop?.shopName ?? (emp.isFieldRole ? 'Not assigned' : 'Not applicable') },
    { primary: 'Today', secondary: todayText },
    { primary: `${period.label} period so far`, secondary: `${present} present · ${late} late · ${absent} absent · ${leave} on leave${due ? ` · ${((present / due) * 100).toFixed(1)}% attendance` : ''}` },
  ]
  return reply(`${emp.fullName} (${emp.employeeId})`, {
    items,
    links: can(user, 'attendance', 'view') ? [{ label: 'Open attendance history', nav: 'attendance', focus: { employeeId: emp.employeeId, companyId: emp.companyId, date: today } }] : [],
  })
}

function openExceptions(q, user, ids) {
  const open = mockListNotifications(user).filter((n) => ids.includes(n.companyId) && ['new', 'under-review'].includes(n.status))
  if (!open.length) return reply(`There are no open notifications or exceptions for ${scopeLabel(ids)}.`, { links: [{ label: 'Open Notifications', nav: 'notifications' }] })
  const rank = { critical: 0, high: 1, medium: 2, low: 3 }
  const wantCritical = has(q, 'critical', 'urgent', 'serious', 'high')
  const list = (wantCritical ? open.filter((n) => n.severity === 'critical' || n.severity === 'high') : open)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.occurredAt.localeCompare(a.occurredAt))
  const counts = ['critical', 'high', 'medium', 'low'].map((s) => `${open.filter((n) => n.severity === s).length} ${s}`).join(', ')
  const { items } = capped(list.map((n) => ({ primary: `${n.severity.toUpperCase()} · ${n.title}`, secondary: `${n.employeeName}${ids.length > 1 ? ` · ${n.companyName}` : ''} · ${n.status === 'new' ? 'New' : 'Under review'}${n.assignedTo ? ` · ${n.assignedTo.name}` : ''}` })))
  return reply(`${open.length} open (${counts}) for ${scopeLabel(ids)}.${wantCritical ? ` ${list.length} are Critical or High.` : ' Most serious first.'} Exceptions need HR review; none of them is an automatic absence or disciplinary decision.`, { items: items.slice(0, 8), links: [{ label: 'Open Notifications', nav: 'notifications' }] })
}

function verifications(ids) {
  const today = accraTodayKey()
  const dates = []
  for (let i = 6; i >= 0; i -= 1) dates.push(addDaysToKey(today, -i))
  const recs = listAttendanceRecords({ companyId: ids.length === 1 ? ids[0] : null, dates }).filter((r) => ids.includes(r.companyId))
  const now = Date.now()
  const events = recs.flatMap((r) => r.smsEvents.filter((e) => Date.parse(e.dispatchedAt) < now).map((e) => ({ r, e })))
  if (!events.length) return reply(`No SMS verification checks have been recorded in the last 7 days for ${scopeLabel(ids)}.`)
  const count = (res) => events.filter((x) => x.e.result === res).length
  const missed = events.filter((x) => x.e.result === 'missed')
  const byEmp = new Map()
  missed.forEach(({ r }) => byEmp.set(r.employeeId, { r, n: (byEmp.get(r.employeeId)?.n ?? 0) + 1 }))
  const { items } = capped([...byEmp.values()].sort((a, b) => b.n - a.n).map(({ r, n }) => recordItem(r, ids, `${n} missed in 7 days`)))
  return reply(`Last 7 days (${scopeLabel(ids)}): ${events.length} checks happened — ${count('verified')} verified, ${missed.length} missed, ${count('failed-face')} failed face, ${count('outside-shop')} outside the geofence, ${count('gps-unavailable')} GPS unavailable, ${count('sms-failed')} SMS delivery failures. A missed check is an exception for review, not an absence or misconduct.`, { items, links: [{ label: 'Open Sales Rep Monitoring', nav: 'sales-monitoring' }] })
}

function shops(ids) {
  const roster = listAttendanceRoster(null).filter((e) => ids.includes(e.companyId))
  const list = mockListAllShops().filter((s) => ids.includes(s.companyId))
  const needing = roster.filter((e) => e.isFieldRole && !e.shopId)
  const items = list.map((s) => ({ primary: s.shopName, secondary: `${s.latitude == null ? 'location not set' : 'location set'} · ${roster.filter((e) => e.shopId === s.shopId).length} assigned · ${s.geofenceRadius} m geofence` }))
  return reply(`${list.length} shops for ${scopeLabel(ids)}. ${needing.length ? `${needing.length} field ${needing.length === 1 ? 'employee needs' : 'employees need'} a shop assignment: ${needing.map((e) => e.fullName).join(', ')}.` : 'Every field employee has a shop.'}`, { items, links: [{ label: 'Open Sales Rep Monitoring', nav: 'sales-monitoring' }] })
}

function myAccess(user) {
  const companies = authorisedCompanies(user).map((c) => nameOf(c.id)).join(' and ')
  const items = MODULES.filter((m) => can(user, m.id, 'view')).map((m) => ({ primary: m.label, secondary: m.levels.filter((l) => can(user, m.id, l)).map((l) => LEVEL_LABELS[l]).join(', ') }))
  return reply(`You are signed in as ${user.name}, ${user.role}, with access to ${companies}. Here is what your permissions allow:`, { items })
}

const HOW_TO = [
  { match: ['correct', 'fix attendance', 'edit attendance', 'manual attendance', 'record attendance'], module: 'attendance-corrections', level: 'edit', nav: 'attendance', text: 'Open Attendance, find the record and choose Correct (or Record attendance for a new entry). Enter the times, a reason and supporting remarks, then confirm. The previous values are always kept in the correction history.' },
  { match: ['assign shop', 'change shop', 'shop assignment'], module: 'employees', level: 'edit', nav: 'employees', text: 'Open Employees and use Assign shop on a field employee, or the Assigned Shops tab in Sales Rep Monitoring. The shop record stays the source of truth for location and geofence.' },
  { match: ['manual', 'notebook', 'enter attendance', 'bulk'], module: 'attendance-corrections', level: 'create', nav: 'attendance', text: 'Open Attendance → Manual Entry. Choose the company and employee, add the dates they actually attended (or tick dates from a range), enter each clock-in and clock-out, then save. Dates you do not tick are never touched or marked absent. A date that already has a record needs your review and a reason before it is replaced.' },
  { match: ['export', 'download', 'csv'], module: 'attendance', level: 'export', nav: 'attendance', text: 'Attendance, Reports, Audit Logs and Settings → Data Management each have CSV exports. Exports follow your filters and only include your companies.' },
  { match: ['resolve', 'dismiss', 'exception', 'review alert'], module: 'notifications', level: 'edit', nav: 'notifications', text: 'Open Notifications, choose Review on an item, then Start review, Resolve (action taken and notes required) or Dismiss (reason required). Nothing is deleted; every step is kept in the history.' },
]

/* --------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------ */

/**
 * Answer a question for the signed-in user.
 * @param {string} text
 * @param {{ user: object, companyId?: string }} ctx companyId '' = all of the user's companies
 * @returns {{ text: string, items: {primary: string, secondary: string}[], links: {label: string, nav: string, focus?: object}[], suggestions: string[] }}
 */
export function askAssistant(text, { user, companyId = '' }) {
  const q = norm(text)
  if (!user) return reply('Please sign in to use the HR Assistant.')
  if (!q) return reply('Ask me something, or pick one of the suggestions.', { suggestions: SUGGESTIONS })

  // Never reveal future SMS verification times.
  if (has(q, /\b(next|upcoming|future|scheduled|when will)\b.*\b(sms|verification|check)/, /\b(sms|verification|check)\b.*\b(schedule|next|upcoming|tomorrow|later today)/)) {
    return reply('I can’t share future SMS verification times. They are generated by a secure backend scheduler and are never shown in the HR portal. I can tell you about checks that have already happened — try “Missed verifications this week”.', { suggestions: ['Missed verifications this week'] })
  }

  if (has(q, /^(hi|hello|hey|good (morning|afternoon|evening))\b/, 'help', 'what can you do', 'how do you work')) {
    return reply(`Hello ${user.name.split(' ')[0]}. I answer questions from this system’s records — attendance today, lateness, absences, leave, exceptions, SMS verifications that have happened, imports, working hours and shops — only for the companies you can access. I can’t change anything.`, { suggestions: SUGGESTIONS })
  }

  if (has(q, 'my permission', 'what can i do', 'my access', 'my role', 'am i allowed')) return myAccess(user)

  const scope = resolveScope(q, user, companyId)
  if (scope.blocked.length && !scope.ids.length) {
    return reply(`You don’t have access to ${scope.blocked.map((c) => c.name).join(' or ')}, so I can’t show its records.`)
  }
  const ids = scope.ids
  if (!ids.length) return reply('Your account has no company access.')
  const blockedNote = scope.blocked.length ? ` (I left out ${scope.blocked.map((c) => c.name).join(', ')} — you don’t have access.)` : ''
  const withNote = (r) => (blockedNote ? { ...r, text: r.text + blockedNote } : r)

  if (has(q, 'period', 'pay cycle', 'attendance cycle', 'cut-off', 'cutoff', '26th')) return periodInfo()

  const how = has(q, 'how do i', 'how to', 'how can i', 'where do i', 'where can i') ? HOW_TO.find((h) => h.match.some((m) => q.includes(m))) : null
  if (how) {
    if (!can(user, how.module, how.level)) return reply(`${how.text} Note: your current permissions don’t include this action.`)
    return reply(how.text, { links: [{ label: 'Take me there', nav: how.nav }] })
  }

  // A specific employee (by ID or name) in the user's companies.
  const roster = listAttendanceRoster(null).filter((e) => ids.includes(e.companyId))
  const idMatch = q.match(/\b(bfl|daa)-\d{4}\b/)
  let emp = idMatch ? roster.find((e) => e.employeeId.toLowerCase() === idMatch[0]) : null
  if (!emp && idMatch) {
    const elsewhere = listAttendanceRoster(null).some((e) => e.employeeId.toLowerCase() === idMatch[0])
    return reply(elsewhere ? `${idMatch[0].toUpperCase()} isn’t in a company you can access.` : `I couldn’t find an employee with ID ${idMatch[0].toUpperCase()}.`)
  }
  if (!emp) {
    const matches = roster.filter((e) => {
      const parts = e.fullName.toLowerCase().split(' ')
      return q.includes(e.fullName.toLowerCase()) || (parts.length > 1 && q.includes(parts[0]) && q.includes(parts[parts.length - 1]))
    })
    if (matches.length === 1) emp = matches[0]
    else if (matches.length > 1) return reply('More than one employee matches. Which one?', { suggestions: matches.slice(0, 4).map((e) => `Attendance for ${e.employeeId}`) })
  }
  if (emp) {
    if (!can(user, 'attendance', 'view')) return denied('Attendance')
    return employeeLookup(emp, user)
  }

  const needs = (moduleId, label, fn) => (can(user, moduleId, 'view') ? withNote(fn()) : denied(label))

  if (has(q, 'absent', 'absence', 'not in', "didn't come", 'did not come', 'no show', 'missing today')) return needs('attendance', 'Attendance', () => attendanceToday('absent', ids))
  if (has(q, /\blate\b/, 'lateness', 'tardy')) return needs('attendance', 'Attendance', () => attendanceToday('late', ids))
  if (has(q, 'at work', 'on site', 'clocked in now', 'currently in', 'working now', 'who is in')) return needs('attendance', 'Attendance', () => attendanceToday('atWork', ids))
  if (has(q, 'leave', 'holiday', 'vacation')) return needs('attendance', 'Attendance', () => attendanceToday('leave', ids))
  if (has(q, 'awaiting clock', 'not clocked in', 'not yet clocked', 'yet to clock')) return needs('attendance', 'Attendance', () => attendanceToday('awaiting', ids))
  if (has(q, 'incomplete', 'clock-out', 'clock out', 'clockout')) return needs('attendance', 'Attendance', () => incompleteThisPeriod(ids))
  if (has(q, 'exception', 'notification', 'alert', 'critical', 'pending issue', 'open issue', 'urgent')) return needs('notifications', 'Notifications & Exceptions', () => openExceptions(q, user, ids))
  if (has(q, 'sms', 'verification', 'verify', 'geofence', 'gps', 'face')) return needs('sales-monitoring', 'Sales Rep Monitoring', () => verifications(ids))
  if (has(q, 'shift', 'working hours', 'work hours')) return reply(`There are no shifts. Every employee works the standard hours for their company: ${ids.map((id) => { const h = defaultHoursFor(id); return `${nameOf(id)} ${h.startTime}–${h.endTime}, late after ${h.lateAfter}` }).join('; ')}. Saturday and Sunday work is overtime.`)
  if (has(q, 'shop', 'store', 'branch')) return needs('shops', 'the Shop Directory', () => shops(ids))
  if (has(q, 'summary', 'overview', 'present', 'attendance', 'today', 'how many')) return needs('attendance', 'Attendance', () => summaryToday(ids))

  return reply('I’m not sure how to answer that. I can only answer questions about this system’s records. Try one of these:', { suggestions: SUGGESTIONS })
}
