import { useEffect, useState } from 'react'
import { mockListShops } from '../../services/shopsService'
import {
  mockAssignShop,
  mockGetAssignmentHistory,
  mockGetAssignmentWithShop,
} from '../../services/shopAssignmentService'

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * HR action: assign or reassign a shop to a field employee. Records the change
 * in assignment history with an effective date; previous assignments are
 * preserved. Only shops from the employee's company are offered.
 */
export default function AssignShopModal({ employee, onClose, onAssigned }) {
  const [selected, setSelected] = useState('')
  const shops = mockListShops(employee.companyId)
  const current = mockGetAssignmentWithShop(employee.staffId)
  const history = mockGetAssignmentHistory(employee.staffId)

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const handleAssign = () => {
    if (!selected) return
    mockAssignShop(employee.staffId, selected)
    onAssigned()
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
        aria-label={`Assign a shop to ${employee.fullName}`}
        style={{ maxWidth: 520 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3>Assign shop</h3>
            <p>
              {employee.fullName} · {employee.staffId}
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
          {current && (
            <p className="sm-muted" style={{ margin: 0 }}>
              Currently assigned to <strong>{current.shopName}</strong> (effective{' '}
              {formatDateTime(current.effectiveDate)}).
            </p>
          )}

          <div>
            <label className="sm-detail-label" htmlFor="assign-shop-select" style={{ display: 'block', marginBottom: 6 }}>
              Assigned shop
            </label>
            <select
              id="assign-shop-select"
              className="sm-select"
              style={{ width: '100%', minHeight: 42, border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)', padding: '9px 12px', fontFamily: 'inherit', fontSize: 14 }}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a shop…</option>
              {shops.map((shop) => (
                <option key={shop.shopId} value={shop.shopId}>
                  {shop.shopName}
                  {current?.shopId === shop.shopId ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>

          {history.length > 0 && (
            <section className="sm-section">
              <h4 className="sm-section-title">Assignment history</h4>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((entry, i) => {
                  const shop = mockListShops(employee.companyId).find(
                    (s) => s.shopId === entry.shopId,
                  )
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                        {shop?.shopName ?? entry.shopId}
                      </span>
                      <span className="sm-muted">effective {formatDateTime(entry.effectiveDate)}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <div className="sm-alert-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAssign}
              disabled={!selected}
            >
              {current ? 'Reassign shop' : 'Assign shop'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
