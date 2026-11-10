/**
 * ============================================================================
 * MOCK HISTORICAL ATTENDANCE IMPORT SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * HR transcribes paper notebook attendance into batches. Each batch goes:
 *
 *   draft → submitted → (reviewer) approved / partially approved / rejected
 *                    ↘ returned for changes → draft again
 *
 * Rules:
 *   - Only dates before digital attendance went live, never future dates.
 *   - Nothing is guessed: missing or unreadable times stay Unknown, and a
 *     missing notebook entry never becomes an absence.
 *   - Employees are never created from notebook names. A record links to an
 *     existing employee only automatically when the employee ID AND the name
 *     agree; every other link must be confirmed by HR.
 *   - Employees from other companies the user cannot see are never shown.
 *   - A reviewer cannot review a batch they submitted.
 *   - Approved records become "Historical – Manually Recorded" attendance.
 *     Their original values are never changed; later corrections go through
 *     Attendance, which keeps the original alongside the correction history.
 *   - No OCR: HR types what the notebook says. The attachment is kept as a
 *     local reference only and is not uploaded anywhere.
 *
 * Replace with real API calls once the backend contract is defined.
 * ============================================================================
 */

import { getCompanyById } from '../constants/companies'
import {
  canImportHistorical,
  canReviewHistorical,
  canViewCompany,
} from '../constants/hrUser'
import { FLAG_LABELS, NOTEBOOK_STATUS } from '../constants/historicalImportLabels'
import { listAttendanceRoster } from './attendanceRecordsService'
import { approvedHistoricalIndex, readBatches, writeBatches } from './historicalImportStore'
import { DIGITAL_GO_LIVE_DATE, periodForDateKey } from '../utils/attendanceRules'
import { accraMidnightMs, accraTodayKey, addDaysToKey, formatAccraDate } from '../utils/accraTime'

export const MAX_BATCH_DAYS = 93
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

const uid = (prefix) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`

const actor = (user) => ({ id: user.id, name: user.name, role: user.role })

function historyEntry(action, user, note = '') {
  return { id: uid('H'), at: new Date().toISOString(), action, by: user ? user.name : 'System', byRole: user?.role ?? '', note }
}

export function isValidDateKey(key) {
  if (!DATE.test(key ?? '')) return false
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function daysInclusive(start, end) {
  return Math.round((accraMidnightMs(end) - accraMidnightMs(start)) / 86400000) + 1
}

/** The attendance periods (26th–25th) a date range touches. */
export function periodsForRange(start, end) {
  if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return []
  const periods = []
  let cursor = start
  while (cursor <= end) {
    const p = periodForDateKey(cursor)
    periods.push(p)
    const endKey = `${p.end.getFullYear()}-${String(p.end.getMonth() + 1).padStart(2, '0')}-${String(p.end.getDate()).padStart(2, '0')}`
    cursor = addDaysToKey(endKey, 1)
  }
  return periods
}

/** "September 2026 period" or "September – October 2026 periods". */
export function periodRangeLabel(start, end) {
  const periods = periodsForRange(start, end)
  if (periods.length === 0) return '—'
  if (periods.length === 1) return `${periods[0].label} period`
  return `${periods[0].label} – ${periods[periods.length - 1].label} periods`
}

const digits = (s) => (s ?? '').replace(/\D/g, '')

/* --------------------------------------------------------------------------
 * Batch validation and CRUD
 * ------------------------------------------------------------------------ */

export function validateBatch(data, user) {
  const errors = {}
  const today = accraTodayKey()
  if ((data.name ?? '').trim().length < 3) errors.name = 'Give the batch a name (at least 3 characters).'
  if (!data.companyId) errors.companyId = 'Choose the company.'
  else if (!canViewCompany(user, data.companyId)) errors.companyId = 'You are not authorised for this company.'
  if (!isValidDateKey(data.startDate)) errors.startDate = 'Enter a valid start date.'
  if (!isValidDateKey(data.endDate)) errors.endDate = 'Enter a valid end date.'
  if (!errors.startDate && !errors.endDate) {
    if (data.startDate > data.endDate) errors.endDate = 'The end date must be on or after the start date.'
    else if (data.endDate >= DIGITAL_GO_LIVE_DATE) {
      errors.endDate = `Historical imports cover dates before digital attendance started (${formatAccraDate(DIGITAL_GO_LIVE_DATE)}).`
    } else if (data.endDate > today) errors.endDate = 'The end date cannot be in the future.'
    else if (daysInclusive(data.startDate, data.endDate) > MAX_BATCH_DAYS) {
      errors.endDate = `A batch can cover at most ${MAX_BATCH_DAYS} days (about three attendance periods).`
    }
  }
  if ((data.sourceDescription ?? '').trim().length < 5) errors.sourceDescription = 'Describe the source (for example, which notebook and where it was kept).'
  if (!(data.notebookReference ?? '').trim()) errors.notebookReference = 'Enter the original notebook and page reference.'
  if (!data.attachment?.name) errors.attachment = 'Attach a photograph or scan of the notebook pages.'
  return errors
}

function cleanBatchDetails(data) {
  return {
    name: data.name.trim(),
    companyId: data.companyId,
    companyName: getCompanyById(data.companyId)?.name ?? '',
    startDate: data.startDate,
    endDate: data.endDate,
    sourceDescription: data.sourceDescription.trim(),
    notebookReference: data.notebookReference.trim(),
    attachment: data.attachment,
  }
}

function canEdit(batch) {
  return batch.status === 'draft' || batch.status === 'returned'
}

export function mockCreateBatch(data, user) {
  if (!canImportHistorical(user)) return { errors: { form: 'You are not authorised to import historical attendance.' } }
  const errors = validateBatch(data, user)
  if (Object.keys(errors).length) return { errors }
  const now = new Date().toISOString()
  const batch = {
    batchId: uid('HIB'),
    ...cleanBatchDetails(data),
    status: 'draft',
    records: [],
    createdBy: actor(user),
    createdAt: now,
    updatedAt: now,
    submittedBy: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    returnReason: null,
    history: [historyEntry('Batch created', user, `${data.startDate} to ${data.endDate}`)],
  }
  const all = readBatches()
  all[batch.batchId] = batch
  if (!writeBatches(all)) {
    return { errors: { attachment: 'The browser could not store this attachment. Choose a smaller file.' } }
  }
  return { batch }
}

export function mockUpdateBatchDetails(batchId, data, user) {
  const all = readBatches()
  const batch = all[batchId]
  if (!batch || !canViewCompany(user, batch.companyId)) return { errors: { form: 'Batch not found.' } }
  if (!canImportHistorical(user)) return { errors: { form: 'You are not authorised to edit import batches.' } }
  if (!canEdit(batch)) return { errors: { form: 'Only draft batches can be edited.' } }
  const errors = validateBatch(data, user)
  if (Object.keys(errors).length) return { errors }
  if (data.companyId !== batch.companyId && batch.records.some((r) => r.match)) {
    return { errors: { companyId: 'Clear the employee matches before changing the company.' } }
  }
  Object.assign(batch, cleanBatchDetails(data), { updatedAt: new Date().toISOString() })
  batch.history.push(historyEntry('Batch details updated', user))
  if (!writeBatches(all)) return { errors: { attachment: 'The browser could not store this attachment. Choose a smaller file.' } }
  return { batch }
}

/** Batches the user may see (their companies only), newest first. */
export function mockListBatches(user) {
  return Object.values(readBatches())
    .filter((b) => canViewCompany(user, b.companyId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function mockGetBatch(batchId, user) {
  const batch = readBatches()[batchId]
  if (!batch || !canViewCompany(user, batch.companyId)) return null
  return batch
}

/* --------------------------------------------------------------------------
 * Records
 * ------------------------------------------------------------------------ */

export function newRecord(defaults = {}) {
  return {
    recordId: uid('HIR'),
    rawName: '',
    rawEmployeeId: '',
    rawPhone: '',
    date: '',
    recordedStatus: 'present',
    arrivalTime: '',
    arrivalUnreadable: false,
    arrivalAsWritten: '',
    departureTime: '',
    departureUnreadable: false,
    departureAsWritten: '',
    remarks: '',
    pageReference: '',
    match: null,
    review: null,
    ...defaults,
  }
}

/** Blocking validation errors for one record (field -> message). */
export function validateRecord(rec, batch) {
  const errors = {}
  const today = accraTodayKey()
  if (!(rec.rawName ?? '').trim()) errors.rawName = 'Enter the name as written in the notebook.'
  if (!rec.date) errors.date = 'Enter the attendance date.'
  else if (!isValidDateKey(rec.date)) errors.date = 'This is not a valid date.'
  else if (rec.date < batch.startDate || rec.date > batch.endDate) {
    errors.date = `Outside this batch (${formatAccraDate(batch.startDate)} to ${formatAccraDate(batch.endDate)}).`
  } else if (rec.date >= DIGITAL_GO_LIVE_DATE) errors.date = 'Dates from digital go-live onwards cannot be imported.'
  else if (rec.date > today) errors.date = 'Future dates cannot be imported.'
  if (!NOTEBOOK_STATUS[rec.recordedStatus]) errors.recordedStatus = 'Choose what the notebook records.'

  for (const k of ['arrival', 'departure']) {
    const t = rec[`${k}Time`]
    if (t && !TIME.test(t)) errors[`${k}Time`] = 'Use a 24-hour time such as 08:15.'
    else if (t && rec[`${k}Unreadable`]) errors[`${k}Time`] = 'Leave the time empty when it is marked unreadable.'
  }
  if (rec.recordedStatus !== 'present' && (rec.arrivalTime || rec.departureTime || rec.arrivalUnreadable || rec.departureUnreadable)) {
    errors.recordedStatus = 'Only a Present entry can have arrival or departure times.'
  }
  if (!errors.arrivalTime && !errors.departureTime && rec.arrivalTime && rec.departureTime && rec.departureTime <= rec.arrivalTime) {
    errors.departureTime = 'Departure must be later than arrival.'
  }
  if (rec.rawPhone && digits(rec.rawPhone).length < 9) errors.rawPhone = 'This phone number looks incomplete.'
  return errors
}

/* --------------------------------------------------------------------------
 * Employee matching
 * ------------------------------------------------------------------------ */

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'madam', 'auntie', 'aunty', 'uncle', 'sister', 'brother', 'dr'])

export function nameTokens(name) {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((t) => t && !TITLES.has(t))
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

function tokenSimilarity(a, b) {
  if (a === b) return 1
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.6 : 0
  const d = levenshtein(a, b)
  const longest = Math.max(a.length, b.length)
  if (d === 1 && longest >= 4) return 0.85
  if (d === 2 && longest >= 6) return 0.7
  return 0
}

/** 0–80: how closely a notebook name resembles an employee's name. */
export function nameScore(raw, candidate) {
  const a = nameTokens(raw)
  const b = nameTokens(candidate)
  if (!a.length || !b.length) return 0
  if (a.slice().sort().join(' ') === b.slice().sort().join(' ')) return 80
  const best = a.map((t) => Math.max(...b.map((u) => tokenSimilarity(t, u))))
  const avg = best.reduce((s, x) => s + x, 0) / a.length
  const coverage = b.filter((u) => a.some((t) => tokenSimilarity(t, u) >= 0.6)).length / b.length
  return Math.round(70 * avg * (0.6 + 0.4 * coverage))
}

function phoneMatches(a, b) {
  const x = digits(a)
  const y = digits(b)
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9)
}

export function scoreCandidate(rec, emp) {
  const reasons = []
  const ns = nameScore(rec.rawName, emp.fullName)
  const rawId = (rec.rawEmployeeId ?? '').trim().toUpperCase()
  const idExact = Boolean(rawId) && rawId === emp.employeeId.toUpperCase()
  const phone = Boolean(rec.rawPhone) && phoneMatches(rec.rawPhone, emp.phone)
  let score = 0
  if (idExact) { score = Math.max(score, 95); reasons.push('Employee ID matches exactly') }
  if (phone) { score = Math.max(score, 85); reasons.push('Phone number matches') }
  if (ns > 0) {
    score = Math.max(score, ns)
    reasons.push(ns >= 80 ? 'Name matches' : ns >= 50 ? 'Name is similar' : 'Name partly similar')
  }
  const agreeing = [idExact, phone, ns >= 50].filter(Boolean).length
  if (agreeing >= 2) score = Math.min(100, score + 5 * (agreeing - 1))
  if ((idExact || phone) && rec.rawName?.trim() && ns < 30) {
    score = Math.min(score, 60)
    reasons.push('But the name does not resemble this employee')
  }
  return { score, nameScore: ns, idExact, phone, reasons }
}

export function confidenceFor(score) {
  if (score >= 90) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}

/** Suggested employees for a notebook record, best first. */
export function findCandidates(rec, roster, limit = 5) {
  return roster
    .map((employee) => ({ employee, ...scoreCandidate(rec, employee) }))
    .filter((c) => c.score >= 35)
    .sort((a, b) => b.score - a.score || a.employee.fullName.localeCompare(b.employee.fullName))
    .slice(0, limit)
}

/** Manual search by name, phone or employee ID. */
export function searchEmployees(query, roster, limit = 10) {
  const q = (query ?? '').trim().toLowerCase()
  if (q.length < 2) return []
  const qDigits = digits(q)
  return roster
    .filter((e) =>
      e.fullName.toLowerCase().includes(q) ||
      e.employeeId.toLowerCase().includes(q) ||
      (qDigits.length >= 4 && digits(e.phone).includes(qDigits)),
    )
    .slice(0, limit)
}

export function matchFor(emp, method, user, score = null) {
  return {
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    companyId: emp.companyId,
    companyName: emp.companyName,
    position: emp.position,
    phone: emp.phone ?? null,
    method,
    score,
    confirmedBy: user ? user.name : 'System',
    confirmedAt: new Date().toISOString(),
  }
}

/**
 * Link automatically only when certain: the notebook's employee ID matches an
 * employee of the batch company exactly AND the name agrees. Otherwise null.
 */
export function autoMatch(rec, roster, batch) {
  const id = (rec.rawEmployeeId ?? '').trim().toUpperCase()
  if (!id) return null
  const emp = roster.find((e) => e.employeeId.toUpperCase() === id)
  if (!emp || emp.companyId !== batch.companyId) return null
  if (nameScore(rec.rawName, emp.fullName) < 50) return null
  return matchFor(emp, 'auto-exact-id', null, scoreCandidate(rec, emp).score)
}

/* --------------------------------------------------------------------------
 * Data quality assessment
 * ------------------------------------------------------------------------ */

/** Employees the user may match against (authorised companies only). */
export function matchingRoster(user) {
  return listAttendanceRoster(null).filter((e) => canViewCompany(user, e.companyId))
}

function duplicateKey(rec) {
  if (!rec.date) return null
  if (rec.match?.employeeId) return `${rec.match.employeeId}:${rec.date}`
  const name = nameTokens(rec.rawName).sort().join(' ')
  return name ? `name:${name}:${rec.date}` : null
}

/** Context needed to assess a batch: roster + other batches + approved index. */
export function buildAssessmentContext(user, batchId) {
  const roster = matchingRoster(user)
  const elsewhere = new Map()
  Object.values(readBatches()).forEach((b) => {
    if (b.batchId === batchId || b.status === 'rejected') return
    b.records.forEach((r) => {
      if (r.review?.decision === 'rejected') return
      const key = duplicateKey(r)
      if (key && !elsewhere.has(key)) elsewhere.set(key, b.name)
    })
  })
  return { roster, elsewhere, approved: approvedHistoricalIndex() }
}

/**
 * Assess every record in a batch.
 * @returns {Map<string, { errors, flags, status, candidates, eligible }>}
 */
export function assessRecords(batch, records, ctx) {
  const counts = new Map()
  records.forEach((r) => {
    if (r.review?.decision === 'rejected') return
    const key = duplicateKey(r)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  })

  const result = new Map()
  records.forEach((r) => {
    const errors = validateRecord(r, batch)
    const flags = []
    const add = (code, level, detail) => flags.push({ code, level, label: FLAG_LABELS[code], detail })

    if (errors.rawName) add('missing-name', 'error', errors.rawName)
    if (errors.date) add('invalid-date', 'error', errors.date)
    if (errors.arrivalTime || errors.departureTime || errors.recordedStatus) {
      add('invalid-time', 'error', errors.arrivalTime ?? errors.departureTime ?? errors.recordedStatus)
    }
    if (r.recordedStatus === 'present') {
      if (!r.arrivalTime && !r.arrivalUnreadable) add('missing-arrival', 'warn', 'Recorded as Unknown.')
      if (!r.departureTime && !r.departureUnreadable) add('missing-departure', 'warn', 'Recorded as Unknown.')
      if (r.arrivalUnreadable || r.departureUnreadable) add('unreadable-time', 'warn', 'Recorded as Unknown.')
    }
    if (r.recordedStatus === 'unclear') add('unclear-entry', 'warn', 'The attendance status will be Unknown.')

    const key = duplicateKey(r)
    const rejected = r.review?.decision === 'rejected'
    if (key && !rejected) {
      if ((counts.get(key) ?? 0) > 1) add('duplicate', 'error', 'The same employee and date appear more than once in this batch.')
      else if (ctx.elsewhere.has(key)) add('duplicate', 'error', `Also entered in batch "${ctx.elsewhere.get(key)}".`)
      else if (ctx.approved.has(key) && ctx.approved.get(key).record.recordId !== r.recordId) {
        add('duplicate', 'error', `Already approved in batch "${ctx.approved.get(key).batch.name}".`)
      }
    }

    let candidates = []
    if (r.match) {
      if (r.match.companyId !== batch.companyId) {
        add('different-company', 'error', `${r.match.employeeName} belongs to ${r.match.companyName}, not ${batch.companyName}.`)
      }
      if (r.match.method === 'manual' && (r.match.score ?? 0) < 50) {
        add('uncertain-match', 'warn', 'The selected employee does not closely match the notebook name, ID or phone.')
      }
    } else if (!errors.rawName) {
      candidates = findCandidates(r, ctx.roster)
      if (candidates.length) add('suggested-match', 'warn', 'Confirm the correct employee or choose one manually.')
      else add('no-match', 'warn', 'No existing employee matches. HR must review; no employee will be created.')
    }

    const codes = new Set(flags.map((f) => f.code))
    let status
    if (r.review?.decision === 'rejected') status = 'rejected'
    else if (r.review?.decision === 'approved') status = 'approved'
    else if (Object.keys(errors).length) status = 'incomplete'
    else if (!r.match) status = candidates.length ? 'pending-review' : 'unmatched'
    else if (codes.has('duplicate') || codes.has('different-company') || codes.has('uncertain-match')) status = 'pending-review'
    else if (codes.has('missing-arrival') || codes.has('missing-departure') || codes.has('unreadable-time') || codes.has('unclear-entry')) status = 'incomplete'
    else status = 'matched'

    // Could be approved (ignores any decision already made).
    const eligible =
      Boolean(r.match) &&
      Object.keys(errors).length === 0 &&
      !codes.has('duplicate') &&
      !codes.has('different-company')

    result.set(r.recordId, { errors, flags, status, candidates, eligible })
  })
  return result
}

/** Convenience: assess a stored batch for a user. */
export function assessBatch(batch, user) {
  return assessRecords(batch, batch.records, buildAssessmentContext(user, batch.batchId))
}

/** Dashboard summary over the batches a user can see. */
export function summariseImports(batches, user) {
  const s = { total: 0, imported: 0, pending: 0, unmatched: 0, incomplete: 0, rejected: 0 }
  batches.forEach((batch) => {
    const assessed = assessBatch(batch, user)
    batch.records.forEach((r) => {
      const a = assessed.get(r.recordId)
      s.total += 1
      if (a.status === 'rejected') { s.rejected += 1; return }
      if (a.status === 'approved' && ['approved', 'partially-approved'].includes(batch.status)) s.imported += 1
      if (a.status === 'pending-review' || (batch.status === 'submitted' && !r.review)) s.pending += 1
      if (!r.match) s.unmatched += 1
      if (a.flags.some((f) => ['missing-arrival', 'missing-departure', 'unreadable-time', 'unclear-entry', 'invalid-date', 'invalid-time', 'missing-name'].includes(f.code))) {
        s.incomplete += 1
      }
    })
  })
  return s
}

/* --------------------------------------------------------------------------
 * Workflow
 * ------------------------------------------------------------------------ */

function load(batchId, user) {
  const all = readBatches()
  const batch = all[batchId]
  if (!batch || !canViewCompany(user, batch.companyId)) return { error: 'Batch not found.' }
  return { all, batch }
}

function sanitize(records) {
  return records.map((r) => ({ ...newRecord(), ...r }))
}

/** Save the working copy of a draft batch's records. */
export function mockSaveDraft(batchId, records, user, note = 'Draft saved') {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  if (!canImportHistorical(user)) return { error: 'You are not authorised to edit import batches.' }
  if (!canEdit(batch)) return { error: 'Only draft batches can be edited.' }
  batch.records = sanitize(records)
  batch.updatedAt = new Date().toISOString()
  batch.history.push(historyEntry(note, user, `${records.length} record${records.length === 1 ? '' : 's'}`))
  writeBatches(all)
  return { batch }
}

/** Submit a draft for review. Records with blocking errors must be fixed first. */
export function mockSubmitBatch(batchId, records, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  if (!canImportHistorical(user)) return { error: 'You are not authorised to submit import batches.' }
  if (!canEdit(batch)) return { error: 'This batch has already been submitted.' }
  if (records.length === 0) return { error: 'Add at least one record before submitting.' }
  const invalid = records.filter((r) => Object.keys(validateRecord(r, batch)).length > 0)
  if (invalid.length) return { error: `Fix ${invalid.length} record${invalid.length === 1 ? '' : 's'} with errors before submitting.` }
  const ctx = buildAssessmentContext(user, batchId)
  const dupes = [...assessRecords(batch, records, ctx).values()].filter((a) => a.flags.some((f) => f.code === 'duplicate' && f.detail.includes('this batch')))
  if (dupes.length) return { error: 'Remove the duplicate employee/date entries in this batch before submitting.' }
  batch.records = sanitize(records)
  batch.status = 'submitted'
  batch.submittedBy = actor(user)
  batch.submittedAt = new Date().toISOString()
  batch.updatedAt = batch.submittedAt
  batch.returnReason = null
  batch.history.push(historyEntry('Submitted for review', user, `${records.length} records`))
  writeBatches(all)
  return { batch }
}

function reviewGuard(batch, user) {
  if (!canReviewHistorical(user)) return 'Only an authorised reviewer can review import batches.'
  if (batch.status !== 'submitted') return 'This batch is not awaiting review.'
  if (batch.submittedBy?.id === user.id) return 'You submitted this batch, so another reviewer must review it.'
  return null
}

export function mockDecideRecord(batchId, recordId, decision, reason, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  const guard = reviewGuard(batch, user)
  if (guard) return { error: guard }
  const record = batch.records.find((r) => r.recordId === recordId)
  if (!record) return { error: 'Record not found.' }
  if (decision === 'approved') {
    // Assess as if undecided, so a previously rejected record is re-checked.
    const asUndecided = batch.records.map((r) => (r.recordId === recordId ? { ...r, review: null } : r))
    const a = assessRecords(batch, asUndecided, buildAssessmentContext(user, batchId)).get(recordId)
    if (!a.eligible) {
      return { error: 'This record cannot be approved: it needs a confirmed employee from this company, valid data and no duplicate.' }
    }
  } else if ((reason ?? '').trim().length < 5) {
    return { error: 'A rejection reason is required (at least 5 characters).' }
  }
  record.review = {
    decision,
    reason: decision === 'rejected' ? reason.trim() : (reason ?? '').trim(),
    by: user.name,
    byRole: user.role,
    at: new Date().toISOString(),
  }
  batch.history.push(historyEntry(decision === 'approved' ? 'Record approved' : 'Record rejected', user, `${record.rawName}, ${record.date}${decision === 'rejected' ? `: ${reason.trim()}` : ''}`))
  writeBatches(all)
  return { batch }
}

/** Undo a record decision while the batch review is still open. */
export function mockClearDecision(batchId, recordId, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  const guard = reviewGuard(batch, user)
  if (guard) return { error: guard }
  const record = batch.records.find((r) => r.recordId === recordId)
  if (!record?.review) return { error: 'No decision to undo.' }
  batch.history.push(historyEntry('Record decision undone', user, `${record.rawName}, ${record.date} (was ${record.review.decision})`))
  record.review = null
  writeBatches(all)
  return { batch }
}

export function mockApproveAllEligible(batchId, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  const guard = reviewGuard(batch, user)
  if (guard) return { error: guard }
  const assessed = assessRecords(batch, batch.records, buildAssessmentContext(user, batchId))
  let count = 0
  const at = new Date().toISOString()
  batch.records.forEach((r) => {
    if (!r.review && assessed.get(r.recordId).eligible) {
      r.review = { decision: 'approved', reason: '', by: user.name, byRole: user.role, at }
      count += 1
    }
  })
  if (count) batch.history.push(historyEntry('Approved all eligible records', user, `${count} record${count === 1 ? '' : 's'}`))
  writeBatches(all)
  return { batch, count }
}

/** Reject the entire batch: every record is rejected with the reason. */
export function mockRejectBatch(batchId, reason, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  const guard = reviewGuard(batch, user)
  if (guard) return { error: guard }
  if ((reason ?? '').trim().length < 5) return { error: 'A rejection reason is required (at least 5 characters).' }
  const at = new Date().toISOString()
  batch.records.forEach((r) => {
    r.review = { decision: 'rejected', reason: reason.trim(), by: user.name, byRole: user.role, at }
  })
  batch.status = 'rejected'
  batch.rejectionReason = reason.trim()
  batch.reviewedBy = actor(user)
  batch.reviewedAt = at
  batch.history.push(historyEntry('Batch rejected', user, reason.trim()))
  writeBatches(all)
  return { batch }
}

/** Send back to the importer for changes. Earlier decisions stay in history. */
export function mockReturnBatch(batchId, reason, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  const guard = reviewGuard(batch, user)
  if (guard) return { error: guard }
  if ((reason ?? '').trim().length < 5) return { error: 'Say what needs to change (at least 5 characters).' }
  batch.records.forEach((r) => { r.review = null })
  batch.status = 'returned'
  batch.returnReason = reason.trim()
  batch.history.push(historyEntry('Returned for changes', user, reason.trim()))
  writeBatches(all)
  return { batch }
}

/** Finish the review once every record has a decision. */
export function mockCompleteReview(batchId, user) {
  const { all, batch, error } = load(batchId, user)
  if (error) return { error }
  const guard = reviewGuard(batch, user)
  if (guard) return { error: guard }
  const undecided = batch.records.filter((r) => !r.review).length
  if (undecided) return { error: `Decide the remaining ${undecided} record${undecided === 1 ? '' : 's'} first.` }
  const approved = batch.records.filter((r) => r.review.decision === 'approved').length
  batch.status = approved === batch.records.length ? 'approved' : approved === 0 ? 'rejected' : 'partially-approved'
  if (batch.status === 'rejected') batch.rejectionReason = 'All records were rejected.'
  batch.reviewedBy = actor(user)
  batch.reviewedAt = new Date().toISOString()
  batch.history.push(historyEntry('Review completed', user, `${approved} approved, ${batch.records.length - approved} rejected`))
  writeBatches(all)
  return { batch }
}
