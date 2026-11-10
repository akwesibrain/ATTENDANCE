import { useEffect, useState } from 'react'
import { initials } from './labels'
import { GEOFENCE_RADIUS_M } from '../../services/shopsService'
import { assignShop } from '../../services/shopAssignmentService'
import { setShopLocation } from '../../services/shopsService'
import ShopLocationPicker from '../shops/ShopLocationPicker'

function AssignModal({ shop, reps, onClose, onAssigned }) {
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const handleAssign = async () => {
    if (!selected || saving) return
    setSaving(true)
    const result = await assignShop(selected, shop.shopId)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
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
        aria-label={`Assign a representative to ${shop.shopName}`}
        style={{ maxWidth: 480 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3>Assign representative</h3>
            <p>{shop.shopName}</p>
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
            {error && <p className="at-form-alert" role="alert">{error}</p>}
          <div>
            <label className="sm-detail-label" htmlFor="assign-rep" style={{ display: 'block', marginBottom: 6 }}>
              Sales representative
            </label>
            <select
              id="assign-rep"
              className="sm-select"
              style={{ width: '100%', minHeight: 42, border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)', padding: '9px 12px', fontFamily: 'inherit', fontSize: 14 }}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a representative…</option>
              {reps.map((rep) => (
                <option key={rep.employeeId} value={rep.employeeId}>
                  {rep.fullName} ({rep.employeeId})
                  {rep.assignedShopId === shop.shopId ? ' — currently assigned' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="sm-alert-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAssign}
              disabled={!selected}
            >
              Assign to this shop
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

/**
 * Assigned shop management. The geofence radius is fixed at 150 metres.
 * Location is shown as a clean information panel — no map dependency.
 */
/** Set or change a shop's GPS location (lookup + map confirmation). */
function LocationModal({ shop, onClose, onSaved }) {
  const [loc, setLoc] = useState(shop.latitude != null ? { latitude: shop.latitude, longitude: shop.longitude, locationSource: shop.locationSource ?? 'manual', locationLabel: shop.locationLabel ?? null } : null)
  const [error, setError] = useState('')
  const changed = loc && (loc.latitude !== shop.latitude || loc.longitude !== shop.longitude)

  useEffect(() => {
    const onEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const save = async () => {
    const r = await setShopLocation(shop.shopId, loc)
    if (r.errors) { setError(Object.values(r.errors)[0]); return }
    onSaved()
    onClose()
  }

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-label={`Set location for ${shop.shopName}`} style={{ maxWidth: 640 }}>
        <div className="sm-modal-head">
          <div>
            <h3>{shop.latitude == null ? 'Set shop location' : 'Change shop location'}</h3>
            <p>{shop.shopName}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="sm-modal-body">
          <ShopLocationPicker shop={{ shopName: shop.baseName ?? shop.shopName, town: shop.town, area: shop.area, address: shop.address }} value={loc} onChange={setLoc} />
          <p className="at-sub" style={{ margin: 0 }}>Saved to the Shop Directory. GPS checks use this point and the {shop.geofenceRadius} m geofence. The previous location is kept in the audit log.</p>
          {error && <p className="at-form-alert" role="alert">{error}</p>}
          <div className="sm-alert-actions">
            <button type="button" className="btn btn-primary" onClick={save} disabled={!changed}>Save location</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ShopsPanel({ shops, reps, onChanged, onViewShop, canAssign = true }) {
  const [assigning, setAssigning] = useState(null)
  const [locating, setLocating] = useState(null)

  const repsFor = (shopId) => reps.filter((r) => r.assignedShopId === shopId)

  return (
    <>
      <div className="sm-shop-grid">
        {shops.map((shop) => {
          const assigned = repsFor(shop.shopId)
          return (
            <div className="sm-shop-card" key={shop.shopId}>
              <div className="sm-shop-head">
                <div>
                  <h4 className="sm-shop-name">{shop.shopName}</h4>
                  <p className="sm-shop-address">{shop.addressLine}</p>
                </div>
                <span className="sm-shop-status">{shop.status}</span>
              </div>

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
                    Geofence radius: <strong>{shop.geofenceRadius ?? GEOFENCE_RADIUS_M} metres</strong>.
                    Verification passes only inside this ring.
                  </span>
                </div>
              </div>

              <div>
                <span className="sm-detail-label">
                  Assigned representatives ({assigned.length})
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {assigned.length === 0 && (
                    <span className="sm-muted">No representatives assigned.</span>
                  )}
                  {assigned.map((rep) => (
                    <span key={rep.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
                      <span className="sm-avatar sm-avatar-fallback" style={{ width: 26, height: 26, fontSize: 10.5 }}>
                        {initials(rep.fullName)}
                      </span>
                      {rep.fullName}
                    </span>
                  ))}
                </div>
              </div>

              <div className="sm-alert-actions">
                {canAssign && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setAssigning(shop)}
                  >
                    Assign representative
                  </button>
                )}
                {canAssign && (
                  <button type="button" className="btn btn-secondary" onClick={() => setLocating(shop)}>
                    {shop.latitude == null ? 'Set location' : 'Change location'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => onViewShop(shop)}
                >
                  View location
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {locating && <LocationModal shop={locating} onClose={() => setLocating(null)} onSaved={onChanged} />}

      {assigning && (
        <AssignModal
          shop={assigning}
          reps={reps}
          onClose={() => setAssigning(null)}
          onAssigned={onChanged}
        />
      )}
    </>
  )
}
