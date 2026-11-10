import { useMemo, useState } from 'react'
import { validateAllocatedShop, validateJobPosition } from '../../utils/registrationValidation'
import { requiresShop } from '../../services/shopAssignmentService'
import { findDuplicateShop, searchShops } from '../../services/shopsService'
import ShopLocationPicker from '../shops/ShopLocationPicker'

const ErrorIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
    <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

/**
 * Screen 5 — Job position.
 * The employee types their own position and presses Enter (or Continue).
 * Privileged roles (administrator, HR, supervisor, etc.) cannot be
 * self-assigned.
 *
 * Field positions (Sales Representative, Merchandiser) must have an allocated
 * shop: search the company's shops by name, town or address, or add a new
 * shop (e.g. China Mall, Ashaiman) which is saved to this company. Other
 * positions do not need a shop.
 */
export default function JobPosition({ data, onChange, showErrors, onSubmit }) {
  const error = validateJobPosition(data)
  const showError = Boolean(error) && showErrors

  const needsShop = requiresShop(data.position)
  const [shopSearch, setShopSearch] = useState('')
  const filteredShops = useMemo(
    () => (needsShop ? searchShops(data.companyId, shopSearch) : []),
    [needsShop, data.companyId, shopSearch],
  )
  const newShop = data.newShop ?? { shopName: '', town: '', area: '', address: '', latitude: '', longitude: '', locationSource: null, locationLabel: null }
  const isNew = data.shopMode === 'new'
  const duplicate = isNew && newShop.shopName.trim() && newShop.town.trim()
    ? findDuplicateShop(data.companyId, newShop.shopName, newShop.town, newShop.area ?? '')
    : null

  const shopError = validateAllocatedShop(data)
  const showShopError = Boolean(shopError) && showErrors

  const setNewShop = (field, value) => onChange('newShop', { ...newShop, [field]: value })
  const chooseExisting = (shopId) => {
    onChange('shopMode', 'existing')
    onChange('assignedShopId', shopId)
  }
  const startNew = () => {
    onChange('shopMode', 'new')
    onChange('assignedShopId', null)
    if (!newShop.shopName && shopSearch.trim()) onChange('newShop', { ...newShop, shopName: shopSearch.trim() })
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!error && !shopError && onSubmit) onSubmit()
    }
  }

  return (
    <section className="card">
      <p className="step-eyebrow">Step 3 of 4</p>
      <h2 className="step-title">Job position</h2>
      <p className="step-description">
        Type the job position you were hired for, then press Enter. Department
        and branch assignment will be completed by HR after registration.
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="field-position">
          Job position
        </label>
        <input
          id="field-position"
          className={`form-input ${showError ? 'has-error' : ''}`}
          type="text"
          value={data.position}
          placeholder="e.g. Warehouse Worker"
          autoComplete="off"
          aria-invalid={showError}
          aria-describedby={showError ? 'error-position' : undefined}
          onChange={(e) => onChange('position', e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {showError && (
          <span className="field-error" id="error-position" role="alert">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {error}
          </span>
        )}
      </div>

      {needsShop && (
        <fieldset className="form-field shop-fieldset">
          <legend className="form-label">
            Allocated shop <span className="required-tag">Required</span>
          </legend>
          <p className="shop-help">Sales Representatives and Merchandisers must be linked to the shop they work from.</p>

          {!isNew ? (
            <>
              <input
                id="field-shop-search"
                className="form-input"
                type="search"
                placeholder="Search by shop name, town or area…"
                value={shopSearch}
                onChange={(e) => setShopSearch(e.target.value)}
                aria-label="Search shops by name, town or location"
                autoComplete="off"
              />
              <div className="shop-options" role="radiogroup" aria-label="Allocated shop">
                {filteredShops.length === 0 && (
                  <p className="shop-options-empty">No shops match &ldquo;{shopSearch}&rdquo;. You can add it as a new shop below.</p>
                )}
                {filteredShops.map((shop) => {
                  const selected = data.assignedShopId === shop.shopId
                  return (
                    <button
                      key={shop.shopId}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`shop-option${selected ? ' is-selected' : ''}`}
                      onClick={() => chooseExisting(shop.shopId)}
                    >
                      <span className="shop-option-radio" aria-hidden="true">
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="shop-option-text">
                        <span className="shop-option-name">{shop.shopName}</span>
                        <span className="shop-option-address">{shop.latitude == null ? 'GPS location not set yet' : 'GPS location set'}{shop.address ? ` · ${shop.address}` : ''}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <button type="button" className="shop-add-link" onClick={startNew}>
                + Can&apos;t find the shop? Add a new allocated shop
              </button>
            </>
          ) : (
            <div className="shop-new">
              <div className="shop-new-grid">
                <div className="form-field">
                  <label className="form-label" htmlFor="new-shop-name">Shop name</label>
                  <input id="new-shop-name" className="form-input" value={newShop.shopName} placeholder="e.g. China Mall, Shoprite, Melcom" autoComplete="off" onChange={(e) => setNewShop('shopName', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-shop-town">City or town</label>
                  <input id="new-shop-town" className="form-input" value={newShop.town} placeholder="e.g. Accra, Kumasi, Ashaiman" autoComplete="off" onChange={(e) => setNewShop('town', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-shop-area">Area</label>
                  <input id="new-shop-area" className="form-input" value={newShop.area ?? ''} placeholder="e.g. Spintex Road" autoComplete="off" onChange={(e) => setNewShop('area', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="new-shop-address">Full address <span className="optional-tag">(optional)</span></label>
                  <input id="new-shop-address" className="form-input" value={newShop.address} placeholder="e.g. Opposite the Ashaiman main station" autoComplete="off" onChange={(e) => setNewShop('address', e.target.value)} />
                </div>
              </div>
              <ShopLocationPicker
                shop={{ shopName: newShop.shopName, town: newShop.town, area: newShop.area, address: newShop.address }}
                value={newShop.latitude !== '' && newShop.latitude != null ? { latitude: Number(newShop.latitude), longitude: Number(newShop.longitude), locationSource: newShop.locationSource, locationLabel: newShop.locationLabel } : null}
                onChange={(loc) => onChange('newShop', {
                  ...newShop,
                  latitude: loc ? loc.latitude : '',
                  longitude: loc ? loc.longitude : '',
                  locationSource: loc ? loc.locationSource : null,
                  locationLabel: loc ? loc.locationLabel : null,
                })}
              />
              <p className="shop-help">
                The shop is saved to this company&apos;s Shop Directory and linked to the employee profile. Its location is used for
                GPS checks against the 150-metre geofence; if it is not set now, HR can set it later in Sales Rep Monitoring →
                Assigned Shops.
              </p>
              {duplicate && (
                <p className="shop-duplicate" role="status">
                  {duplicate.shopName} already exists.{' '}
                  <button type="button" className="shop-add-link" onClick={() => chooseExisting(duplicate.shopId)}>Select it instead</button>
                </p>
              )}
              <button type="button" className="shop-add-link" onClick={() => onChange('shopMode', 'existing')}>
                &larr; Back to the shop list
              </button>
            </div>
          )}

          {showShopError && (
            <span className="field-error" role="alert">
              <ErrorIcon />
              {shopError}
            </span>
          )}
        </fieldset>
      )}

      <p className="role-note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>
          Administrator, HR and supervisor access cannot be self-assigned.
          Elevated access is granted separately by your company&apos;s
          administration.
        </span>
      </p>
    </section>
  )
}
