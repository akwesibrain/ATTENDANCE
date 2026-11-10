import { useEffect } from 'react'
import { initials } from './labels'
import { GEOFENCE_RADIUS_M } from '../../services/salesMonitoringService'

/**
 * Shop detail view — a clean location-information panel (no map dependency).
 */
export default function ShopModal({ shop, reps, companyName, onClose }) {
  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  if (!shop) return null
  const assigned = reps.filter((r) => r.assignedShopId === shop.shopId)

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
        aria-label={`Shop details for ${shop.shopName}`}
        style={{ maxWidth: 560 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3>{shop.shopName}</h3>
            <p>{shop.addressLine}</p>
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
            <h4 className="sm-section-title">Shop information</h4>
            <div className="sm-detail-grid">
              <div className="sm-detail">
                <span className="sm-detail-label">Shop name</span>
                <span className="sm-detail-value">{shop.shopName}</span>
              </div>
              <div className="sm-detail">
                <span className="sm-detail-label">Company</span>
                <span className="sm-detail-value">{companyName}</span>
              </div>
              <div className="sm-detail">
                <span className="sm-detail-label">Status</span>
                <span className="sm-detail-value">
                  <span className="sm-shop-status">{shop.status}</span>
                </span>
              </div>
              <div className="sm-detail">
                <span className="sm-detail-label">Geofence radius</span>
                <span className="sm-detail-value">{shop.geofenceRadius ?? GEOFENCE_RADIUS_M} metres</span>
              </div>
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Location</h4>
            <div style={{ padding: 14 }}>
              <div className="sm-location-panel">
                <div className="sm-location-row">
                  <span className="sm-detail-label">GPS latitude</span>
                  <span className="sm-location-value">{shop.latitude != null ? shop.latitude.toFixed(4) : 'Not set'}</span>
                </div>
                <div className="sm-location-row">
                  <span className="sm-detail-label">GPS longitude</span>
                  <span className="sm-location-value">{shop.longitude != null ? shop.longitude.toFixed(4) : 'Not set'}</span>
                </div>
                <div className="sm-geofence-visual">
                  <span className="sm-geofence-ring" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" stroke="currentColor" strokeWidth="2" />
                      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </span>
                  <span className="sm-geofence-text">
                    Representatives verify within a{' '}
                    <strong>{shop.geofenceRadius ?? GEOFENCE_RADIUS_M}-metre</strong>{' '}
                    radius of these coordinates.
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">
              Assigned representatives ({assigned.length})
            </h4>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {assigned.length === 0 && (
                <span className="sm-muted">No representatives assigned to this shop.</span>
              )}
              {assigned.map((rep) => (
                <span key={rep.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                  <span className="sm-avatar sm-avatar-fallback" style={{ width: 30, height: 30, fontSize: 11.5 }}>
                    {initials(rep.fullName)}
                  </span>
                  {rep.fullName}
                  <span className="sm-mono sm-muted">{rep.employeeId}</span>
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
