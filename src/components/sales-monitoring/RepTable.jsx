import { useEffect, useRef, useState } from 'react'
import { REP_STATUS, formatTime, initials } from './labels'

function ActionsMenu({ rep, onViewDetails, onViewHistory, onViewShop }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onEscape = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const choose = (fn) => () => {
    setOpen(false)
    fn(rep)
  }

  return (
    <div className="sm-actions" ref={ref}>
      <button
        type="button"
        className="sm-actions-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Actions
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="sm-menu" role="menu">
          <button type="button" role="menuitem" className="sm-menu-item" onClick={choose(onViewDetails)}>
            View Details
          </button>
          <button type="button" role="menuitem" className="sm-menu-item" onClick={choose(onViewHistory)}>
            View Verification History
          </button>
          <button type="button" role="menuitem" className="sm-menu-item" onClick={choose(onViewShop)}>
            View Assigned Shop
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Sales representative monitoring table.
 * Shows only actual, past verification activity — never future schedules.
 */
export default function RepTable({ reps, onViewDetails, onViewHistory, onViewShop }) {
  if (reps.length === 0) {
    return (
      <p className="sm-empty">
        No sales representatives match the selected filters.
      </p>
    )
  }

  return (
    <div className="sm-table-wrap">
      <table className="sm-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Employee ID</th>
            <th>Phone Number</th>
            <th>Assigned Shop</th>
            <th>Current Attendance Status</th>
            <th>Last Verification</th>
            <th>Verification Progress</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reps.map((rep) => {
            const status = REP_STATUS[rep.day.status]
            return (
              <tr key={rep.employeeId}>
                <td>
                  <button
                    type="button"
                    className="sm-rep-cell sm-rep-link"
                    onClick={() => onViewDetails(rep)}
                  >
                    {rep.profileImage ? (
                      <img className="sm-avatar" src={rep.profileImage} alt="" />
                    ) : (
                      <span className="sm-avatar sm-avatar-fallback">
                        {initials(rep.fullName)}
                      </span>
                    )}
                    {rep.fullName}
                  </button>
                </td>
                <td className="sm-mono">{rep.employeeId}</td>
                <td>{rep.phoneNumber}</td>
                <td>{rep.shop?.shopName ?? '—'}</td>
                <td>
                  <span className={`sm-status ${status.className}`}>{status.label}</span>
                </td>
                <td>
                  {rep.day.lastVerification ? (
                    <span className="sm-mono">
                      {formatTime(rep.day.lastVerification.dispatchedAt)}
                    </span>
                  ) : (
                    <span className="sm-muted">—</span>
                  )}
                </td>
                <td>
                  <span className="sm-progress">
                    <span className="sm-progress-track" aria-hidden="true">
                      <span
                        className={`sm-progress-fill${rep.day.completedCount === 3 ? ' is-complete' : ''}`}
                        style={{ width: `${(rep.day.completedCount / 3) * 100}%` }}
                      />
                    </span>
                    {rep.day.progress}
                  </span>
                </td>
                <td>
                  <ActionsMenu
                    rep={rep}
                    onViewDetails={onViewDetails}
                    onViewHistory={onViewHistory}
                    onViewShop={onViewShop}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
