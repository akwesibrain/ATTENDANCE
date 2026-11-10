import { useEffect, useState } from 'react'
import { ALERT_STATUS_LABELS, formatDateTime } from './labels'
import { mockUpdateAlert } from '../../services/salesMonitoringService'

function AlertModal({ alert, onClose, onSave, canReview }) {
  const [note, setNote] = useState(alert.resolutionNote ?? '')

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const save = (status) => {
    mockUpdateAlert(alert.exceptionId, { status, resolutionNote: note })
    onSave()
    onClose()
  }

  return (
    <div
      className="sm-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Alert: ${alert.typeLabel}`}
        style={{ maxWidth: 560 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3>{alert.typeLabel}</h3>
            <p>
              {alert.employeeName} · {alert.shopName}
            </p>
          </div>
          <button
            type="button"
            className="sm-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sm-modal-body">
          <section className="sm-section">
            <h4 className="sm-section-title">Alert details</h4>
            <div className="sm-detail-grid">
              <div className="sm-detail">
                <span className="sm-detail-label">Employee</span>
                <span className="sm-detail-value">{alert.employeeName}</span>
              </div>
              <div className="sm-detail">
                <span className="sm-detail-label">Assigned shop</span>
                <span className="sm-detail-value">{alert.shopName}</span>
              </div>
              <div className="sm-detail">
                <span className="sm-detail-label">Event time</span>
                <span className="sm-detail-value">{formatDateTime(alert.createdAt)}</span>
              </div>
              <div className="sm-detail">
                <span className="sm-detail-label">Severity</span>
                <span className="sm-detail-value">
                  <span className={`sm-severity sm-severity-${alert.severity}`}>
                    {alert.severity}
                  </span>
                </span>
              </div>
            </div>
          </section>

          {canReview ? (
            <>
          <div>
            <label className="sm-detail-label" htmlFor="alert-note" style={{ display: 'block', marginBottom: 6 }}>
              Investigation note
            </label>
            <textarea
              id="alert-note"
              className="sm-alert-note"
              placeholder="Record what was found and any action taken…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="sm-alert-actions">
            {alert.status !== 'under-review' && alert.status !== 'resolved' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => save('under-review')}
              >
                Mark under review
              </button>
            )}
            {alert.status !== 'resolved' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => save('resolved')}
              >
                Resolve alert
              </button>
            )}
            {alert.status === 'resolved' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => save('under-review')}
              >
                Reopen for review
              </button>
            )}
          </div>
            </>
          ) : (
            <p className="sm-muted" style={{ margin: 0 }}>You can view this alert but not change its review status.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Alerts and exceptions for the selected company and date.
 * Alerts inform HR; they never mark anyone absent or apply discipline
 * automatically — every one requires management review.
 */
export default function AlertsPanel({ alerts, onRefresh, canReview = true }) {
  const [selected, setSelected] = useState(null)

  if (alerts.length === 0) {
    return (
      <p className="sm-empty">
        No alerts for this date. All verification activity is within expectations.
      </p>
    )
  }

  return (
    <>
      <div className="sm-table-wrap">
        <table className="sm-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Assigned Shop</th>
              <th>Alert Type</th>
              <th>Event Time</th>
              <th>Severity</th>
              <th>Review Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.exceptionId}>
                <td style={{ fontWeight: 600 }}>{alert.employeeName}</td>
                <td>{alert.shopName}</td>
                <td>{alert.typeLabel}</td>
                <td className="sm-mono">{formatDateTime(alert.createdAt)}</td>
                <td>
                  <span className={`sm-severity sm-severity-${alert.severity}`}>
                    {alert.severity}
                  </span>
                </td>
                <td>
                  <span className={`sm-alert-status sm-alert-${alert.status}`}>
                    {ALERT_STATUS_LABELS[alert.status]}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="sm-actions-btn"
                    onClick={() => setSelected(alert)}
                  >
                    {canReview ? 'Review' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <AlertModal
          alert={selected}
          onClose={() => setSelected(null)}
          onSave={onRefresh}
          canReview={canReview}
        />
      )}
    </>
  )
}
