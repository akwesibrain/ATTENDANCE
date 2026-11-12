import { useEffect } from 'react'
import { LEAVE_STATUS, listLeavesFor } from '../../services/leaveView'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'

/**
 * An employee's leave, read from the backend. Read-only for now: the backend
 * has no endpoint to record, end or cancel leave yet, so this window says so
 * instead of pretending to save.
 */
export default function LeaveModal({ employee, onClose }) {
  const today = accraTodayKey()
  const employeeId = employee.staffId ?? employee.employeeId
  const history = listLeavesFor(employeeId)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
          <p className="at-form-alert lv-pad" role="note">
            Recording leave is not available yet — it needs a backend endpoint. Approved leave saved in the system is shown below and is never counted as absence.
          </p>

          <section className="sm-section">
            <h4 className="sm-section-title">Leave history</h4>
            {history.length === 0 ? (
              <p className="sm-empty lv-pad">No leave recorded for this employee.</p>
            ) : (
              <ul className="lv-list">
                {history.map((l) => {
                  const st = l.status === 'approved' && l.startDate <= today && l.endDate >= today ? { label: 'On leave now', tone: 'ok' }
                    : l.status === 'approved' && l.startDate > today ? { label: 'Upcoming', tone: 'pending' }
                      : l.status === 'approved' && l.endDate < today ? { label: 'Taken', tone: 'muted' }
                        : LEAVE_STATUS[l.status] ?? { label: l.status, tone: 'muted' }
                  return (
                    <li key={l.leaveId} className="lv-item">
                      <div className="lv-item-main">
                        <strong>{l.leaveType}</strong>
                        <span className={`at-badge at-tone-${st.tone}`}>{st.label}</span>
                      </div>
                      <span className="lv-dates">{formatAccraDate(l.startDate)} – {formatAccraDate(l.endDate)}</span>
                      {l.approvedBy && <span className="lv-meta">Approved by {l.approvedBy}</span>}
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
