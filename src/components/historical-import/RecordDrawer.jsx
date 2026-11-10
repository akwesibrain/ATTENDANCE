import { useEffect, useMemo, useState } from 'react'
import { MATCH_METHOD, NOTEBOOK_STATUS } from '../../constants/historicalImportLabels'
import {
  confidenceFor,
  matchFor,
  scoreCandidate,
  searchEmployees,
} from '../../services/historicalImportService'
import { formatAccraDate, formatAccraDateTime } from '../../utils/accraTime'
import { FlagList, RecordStatusBadge } from './ImportBadges'

function Detail({ label, children }) {
  return (
    <div className="sm-detail">
      <span className="sm-detail-label">{label}</span>
      <span className="sm-detail-value">{children ?? '—'}</span>
    </div>
  )
}

function timeText(time, unreadable, asWritten) {
  if (unreadable) return `Unknown — unreadable${asWritten ? ` ("${asWritten}")` : ''}`
  if (!time) return 'Unknown — not written'
  return `${time}${asWritten ? ` (written "${asWritten}")` : ''}`
}

const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Possible match', low: 'Weak match' }

function CandidateRow({ employee, score, reasons, batchCompanyId, onSelect, actionLabel }) {
  const level = confidenceFor(score)
  const otherCompany = employee.companyId !== batchCompanyId
  return (
    <li className="hi-candidate">
      <div className="hi-candidate-main">
        <span className="at-emp-name">{employee.fullName}</span>
        <span className="at-sub">
          <span className="sm-mono">{employee.employeeId}</span> · {employee.position} · {employee.companyName}
          {employee.phone ? ` · ${employee.phone}` : ''}
        </span>
        {reasons?.length > 0 && <span className="at-sub">{reasons.join(' · ')}</span>}
        {otherCompany && <span className="hi-flag hi-flag-error">Different company from this batch</span>}
      </div>
      <div className="hi-candidate-side">
        {score != null && <span className={`hi-score hi-score-${level}`}>{CONFIDENCE_LABEL[level]} · {score}</span>}
        {onSelect && (
          <button type="button" className="sm-actions-btn" onClick={onSelect}>{actionLabel}</button>
        )}
      </div>
    </li>
  )
}

/**
 * Record review drawer: the notebook values exactly as entered, data-quality
 * flags, employee matching (suggestions + manual search) and — for reviewers —
 * approve / reject with a required reason.
 */
export default function RecordDrawer({
  batch,
  record,
  assessment,
  roster,
  mode,
  user,
  onMatch,
  onDecide,
  onClearDecision,
  onClose,
  error,
}) {
  const [query, setQuery] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const results = useMemo(() => searchEmployees(query, roster), [query, roster])
  const r = record
  const a = assessment
  const editing = mode === 'edit'
  const reviewing = mode === 'review'

  const select = (emp, method) => onMatch(r.recordId, matchFor(emp, method, user, scoreCandidate(r, emp).score))

  return (
    <div className="nt-drawer-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="nt-drawer" role="dialog" aria-modal="true" aria-labelledby="hi-drawer-title">
        <header className="nt-drawer-head">
          <div>
            <div className="nt-drawer-badges">
              <RecordStatusBadge status={a.status} />
              <span className="nt-category">{batch.companyName}</span>
            </div>
            <h3 id="hi-drawer-title">{r.rawName || 'Unnamed entry'}</h3>
            <p className="nt-muted">
              {r.date ? formatAccraDate(r.date) : 'No date'} · {batch.name}{r.pageReference ? ` · ${r.pageReference}` : ''}
            </p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className="nt-drawer-body">
          {a.flags.length > 0 && (
            <section aria-label="Data quality">
              <FlagList flags={a.flags} />
            </section>
          )}
          {error && <p className="at-form-alert" role="alert">{error}</p>}

          <section className="sm-section">
            <h4 className="sm-section-title">Notebook entry (as transcribed)</h4>
            <div className="sm-detail-grid">
              <Detail label="Name as written">{r.rawName || '—'}</Detail>
              <Detail label="Employee ID as written">{r.rawEmployeeId || 'Not written'}</Detail>
              <Detail label="Phone as written">{r.rawPhone || 'Not written'}</Detail>
              <Detail label="Date">{r.date ? formatAccraDate(r.date) : '—'}</Detail>
              <Detail label="Notebook status">{NOTEBOOK_STATUS[r.recordedStatus]}</Detail>
              <Detail label="Source page">{r.pageReference || '—'}</Detail>
              {r.recordedStatus === 'present' && (
                <>
                  <Detail label="Arrival">{timeText(r.arrivalTime, r.arrivalUnreadable, r.arrivalAsWritten)}</Detail>
                  <Detail label="Departure">{timeText(r.departureTime, r.departureUnreadable, r.departureAsWritten)}</Detail>
                </>
              )}
              <Detail label="Notebook remarks">{r.remarks || '—'}</Detail>
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Employee match</h4>
            <div className="at-section-pad">
              {r.match ? (
                <>
                  <ul className="hi-candidates">
                    <CandidateRow employee={{ employeeId: r.match.employeeId, fullName: r.match.employeeName, companyId: r.match.companyId, companyName: r.match.companyName, position: r.match.position, phone: r.match.phone }} score={r.match.score} batchCompanyId={batch.companyId} />
                  </ul>
                  <span className="at-sub">
                    {MATCH_METHOD[r.match.method]} · {r.match.confirmedBy} · {formatAccraDateTime(r.match.confirmedAt)}
                  </span>
                  {editing && (
                    <div>
                      <button type="button" className="sm-actions-btn" onClick={() => onMatch(r.recordId, null)}>Clear match</button>
                    </div>
                  )}
                </>
              ) : (
                <p className="hi-unmatched">
                  Not linked to an employee.{' '}
                  {a.candidates.length
                    ? 'Possible matches are listed below — confirm the right one.'
                    : 'No existing employee matches. This record is flagged for HR review; no employee will be created.'}
                </p>
              )}

              {editing && !r.match && a.candidates.length > 0 && (
                <>
                  <span className="sm-detail-label">Suggestions</span>
                  <ul className="hi-candidates">
                    {a.candidates.map((c) => (
                      <CandidateRow key={c.employee.employeeId} {...c} batchCompanyId={batch.companyId} actionLabel="Confirm" onSelect={() => select(c.employee, 'confirmed-suggestion')} />
                    ))}
                  </ul>
                </>
              )}

              {editing && (
                <>
                  <label className="sm-detail-label" htmlFor="hi-search">Search employees by name, phone or ID</label>
                  <input id="hi-search" type="search" className="sh-form-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="At least 2 characters" />
                  {query.trim().length >= 2 && (
                    results.length ? (
                      <ul className="hi-candidates">
                        {results.map((emp) => (
                          <CandidateRow key={emp.employeeId} employee={emp} score={scoreCandidate(r, emp).score} reasons={scoreCandidate(r, emp).reasons} batchCompanyId={batch.companyId} actionLabel={r.match?.employeeId === emp.employeeId ? 'Selected' : 'Select'} onSelect={r.match?.employeeId === emp.employeeId ? null : () => select(emp, 'manual')} />
                        ))}
                      </ul>
                    ) : (
                      <p className="at-sub">No employees found. Employees are never created from notebook names; add them through registration first.</p>
                    )
                  )}
                </>
              )}
            </div>
          </section>

          {r.review && (
            <div className={`nt-outcome ${r.review.decision === 'approved' ? 'nt-outcome-resolved' : 'nt-outcome-dismissed'}`}>
              <strong>{r.review.decision === 'approved' ? 'Approved' : 'Rejected'}</strong>
              {r.review.reason && <span>{r.review.reason}</span>}
              <span className="nt-muted">{r.review.by} ({r.review.byRole}) · {formatAccraDateTime(r.review.at)}</span>
            </div>
          )}

          {reviewing && (
            <section className="nt-actions-panel" aria-label="Review decision">
              {r.review ? (
                <div className="nt-action-row">
                  <button type="button" className="sm-actions-btn" onClick={() => onClearDecision(r.recordId)}>Undo decision</button>
                </div>
              ) : rejecting ? (
                <>
                  <label className="sh-form-label" htmlFor="hi-reject">Rejection reason (required)</label>
                  <textarea id="hi-reject" className="sm-alert-note" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                  <div className="nt-action-row">
                    <button type="button" className="sm-actions-btn nt-btn-danger" onClick={() => onDecide(r.recordId, 'rejected', rejectReason)}>Confirm reject</button>
                    <button type="button" className="sm-actions-btn" onClick={() => setRejecting(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="nt-action-row">
                  <button type="button" className="sm-actions-btn nt-btn-primary" disabled={!a.eligible} onClick={() => onDecide(r.recordId, 'approved', '')}>Approve record</button>
                  <button type="button" className="sm-actions-btn" onClick={() => setRejecting(true)}>Reject…</button>
                  {!a.eligible && (
                    <span className="at-sub">Approval needs a confirmed employee from {batch.companyName}, valid data and no duplicate.</span>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
