import { useEffect, useState } from 'react'
import { getSessionUser } from '../../services/permissionsService'
import {
  LEAVE_STATUS,
  LEAVE_TYPES,
  leaveWorkingDays,
  listLeavesFor,
  mockCancelLeave,
  mockEndLeaveEarly,
  mockRecordLeave,
  validateLeave,
} from '../../services/leaveService'
import { accraTodayKey, addDaysToKey, formatAccraDate, formatAccraDateTime } from '../../utils/accraTime'

const EMPTY = { leaveType: 'Annual leave', startDate: '', endDate: '', notes: '' }

/**
 * Record an employee's leave, and see / adjust their leave history.
 * Leave recorded here is approved straight away; those working days show as
 * "On leave" everywhere and are never counted as absences.
 */
export default function LeaveModal({ employee, onClose, onChanged }) {
  const today = accraTodayKey()
  const employeeId = employee.staffId ?? employee.employeeId
  const [form, setForm] = useState({ ...EMPTY, startDate: today })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState(false)
  const [flash, setFlash] = useState('')
  const [action, setAction] = useState(null) // { kind: 'end'|'cancel', leave, endDate, reason, error }
  const [version, setVersion] = useState(0)
  const history = listLeavesFor(employeeId)
  void version

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (k, v) => {
    const next = { ...form, [k]: v }
    if (k === 'startDate' && next.endDate && next.endDate < v) next.endDate = v
    setForm(next)
    if (touched) setErrors(validateLeave({ ...next, employeeId }))
  }
  const days = form.startDate && form.endDate && form.endDate >= form.startDate ? leaveWorkingDays(employee.companyId, form.startDate, form.endDate) : null
  const refresh = (message) => { setFlash(message); setVersion((v) => v + 1); onChanged?.() }

  const record = (e) => {
    e.preventDefault()
    setTouched(true)
    const r = mockRecordLeave({ ...employee, employeeId }, form, getSessionUser())
    if (r.errors) { setErrors(r.errors); setFlash(''); return }
    setErrors({})
    setTouched(false)
    setForm({ ...EMPTY, startDate: today })
    refresh(`${r.leave.leaveType} recorded: ${formatAccraDate(r.leave.startDate)} to ${formatAccraDate(r.leave.endDate)}.`)
  }

  const applyAction = () => {
    const user = getSessionUser()
    const r = action.kind === 'end'
      ? mockEndLeaveEarly(action.leave.leaveId, action.endDate, action.reason, user, employee)
      : mockCancelLeave(action.leave.leaveId, action.reason, user, employee)
    if (r.error) { setAction({ ...action, error: r.error }); return }
    setAction(null)
    refresh(action.kind === 'end' ? `Leave now ends on ${formatAccraDate(r.leave.endDate)}.` : 'Leave cancelled. Those days count as normal working days again.')
  }

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-labelledby="lv-title" style={{ maxWidth: 640 }}>
        <div className="sm-modal-head">
          <div>
            <h3 id="lv-title">Leave</h3>
            <p>{employee.fullName} · {employeeId}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="sm-modal-body">
          {flash && <div className="at-flash" role="status"><span>{flash}</span></div>}

          <form className="sm-section" onSubmit={record} noValidate>
            <h4 className="sm-section-title">Record leave</h4>
            {errors.form && <p className="at-form-alert lv-pad" role="alert">{errors.form}</p>}
            <div className="ed-fields">
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="lv-type">Type of leave</label>
                <select id="lv-type" className="sh-form-select" value={form.leaveType} onChange={(e) => set('leaveType', e.target.value)}>
                  {LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                {errors.leaveType && <span className="ed-error" role="alert">{errors.leaveType}</span>}
              </div>
              <div className="ed-tenure" aria-live="polite">
                <span className="sm-detail-label">Working days on leave</span>
                <strong>{days == null ? '—' : `${days} day${days === 1 ? '' : 's'}`}</strong>
                <span className="ed-hint">Weekends and holidays are not counted.</span>
              </div>
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="lv-start">First day</label>
                <input id="lv-start" type="date" className="sh-form-input" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} aria-invalid={Boolean(errors.startDate)} />
                {errors.startDate && <span className="ed-error" role="alert">{errors.startDate}</span>}
              </div>
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="lv-end">Last day</label>
                <input id="lv-end" type="date" className="sh-form-input" min={form.startDate || undefined} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} aria-invalid={Boolean(errors.endDate)} />
                {errors.endDate && <span className="ed-error" role="alert">{errors.endDate}</span>}
              </div>
              <div className="sh-form-field is-full lv-full">
                <label className="sh-form-label" htmlFor="lv-notes">Notes <span className="optional-tag">(optional)</span></label>
                <input id="lv-notes" className="sh-form-input" maxLength={300} value={form.notes} placeholder="e.g. Medical certificate received" onChange={(e) => set('notes', e.target.value)} />
                {errors.notes && <span className="ed-error" role="alert">{errors.notes}</span>}
              </div>
            </div>
            <div className="lv-actions">
              <button type="submit" className="btn btn-primary">Record leave</button>
            </div>
          </form>

          <section className="sm-section">
            <h4 className="sm-section-title">Leave history</h4>
            {history.length === 0 ? (
              <p className="sm-empty lv-pad">No leave recorded for this employee.</p>
            ) : (
              <ul className="lv-list">
                {history.map((l) => {
                  const st = l.status === 'approved' && l.startDate <= today && l.endDate >= today ? { label: 'On leave now', tone: 'ok' } : l.status === 'approved' && l.startDate > today ? { label: 'Upcoming', tone: 'pending' } : l.status === 'approved' && l.endDate < today ? { label: 'Taken', tone: 'muted' } : LEAVE_STATUS[l.status]
                  const n = leaveWorkingDays(l.companyId, l.startDate, l.endDate)
                  const canEnd = l.status === 'approved' && l.endDate >= today && l.startDate < l.endDate
                  return (
                    <li key={l.leaveId} className={`lv-item${l.status === 'cancelled' ? ' is-cancelled' : ''}`}>
                      <div className="lv-item-main">
                        <strong>{l.leaveType}</strong>
                        <span className={`at-badge at-tone-${st.tone}`}>{st.label}</span>
                      </div>
                      <span className="lv-dates">{formatAccraDate(l.startDate)} – {formatAccraDate(l.endDate)} · {n} working day{n === 1 ? '' : 's'}</span>
                      {l.notes && <span className="lv-note">{l.notes}</span>}
                      <span className="lv-meta">
                        {(l.history ?? []).map((h) => `${h.action} by ${h.by} · ${formatAccraDateTime(h.at)}${h.note && h.action !== 'Recorded' ? ` — ${h.note}` : ''}`).join(' · ')}
                      </span>
                      {l.status !== 'cancelled' && (
                        <div className="lv-item-actions">
                          {canEnd && <button type="button" className="sm-actions-btn" onClick={() => setAction({ kind: 'end', leave: l, endDate: l.startDate > today ? l.startDate : today, reason: '', error: '' })}>End early</button>}
                          <button type="button" className="sm-actions-btn" onClick={() => setAction({ kind: 'cancel', leave: l, reason: '', error: '' })}>Cancel leave</button>
                        </div>
                      )}
                      {action?.leave.leaveId === l.leaveId && (
                        <div className="lv-confirm" role="group" aria-label={action.kind === 'end' ? 'End leave early' : 'Cancel leave'}>
                          {action.kind === 'end' && (
                            <label className="sh-form-label">New last day
                              <input type="date" className="sh-form-input" min={l.startDate} max={addDaysToKey(l.endDate, -1)} value={action.endDate} onChange={(e) => setAction({ ...action, endDate: e.target.value })} />
                            </label>
                          )}
                          <label className="sh-form-label">Reason
                            <input className="sh-form-input" value={action.reason} placeholder={action.kind === 'end' ? 'e.g. Returned to work early' : 'e.g. Recorded for the wrong dates'} onChange={(e) => setAction({ ...action, reason: e.target.value })} />
                          </label>
                          {action.kind === 'cancel' && <p className="ed-hint">The record is kept as Cancelled. Any of those days without attendance will count as absent again.</p>}
                          {action.error && <span className="ed-error" role="alert">{action.error}</span>}
                          <div className="lv-actions">
                            <button type="button" className="btn btn-primary" onClick={applyAction}>{action.kind === 'end' ? 'Save new end date' : 'Cancel this leave'}</button>
                            <button type="button" className="btn btn-secondary" onClick={() => setAction(null)}>Back</button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <div className="sm-alert-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
