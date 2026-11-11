import { useEffect, useMemo, useState } from 'react'
import { validateAllocatedShop, validateJobPosition } from '../../utils/registrationValidation'
import { requiresShop } from '../../services/shopAssignmentService'
import { loadPublicShops, searchShops } from '../../services/shopsService'
import { EMPTY_NEW_SHOP, MAX_SHOPS, backendShopFields, selectedShopCount, validateShopCount } from '../../utils/shopSelection'
import '../../styles/registration-extra.css'

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
 * Field positions (Sales Representative, Merchandiser) choose the shops they
 * work at: at least 1 and up to MAX_SHOPS (1 plus 6 more). They tick shops in
 * the company's list (search by name, town or area) and/or add shops that
 * are not in it yet; new shops are saved to this company. Other positions do
 * not need a shop.
 */
export default function JobPosition({ data, onChange, showErrors, onSubmit }) {
  const error = validateJobPosition(data)
  const showError = Boolean(error) && showErrors

  const needsShop = requiresShop(data.position)
  const [shopSearch, setShopSearch] = useState('')
  const [shopsLoaded, setShopsLoaded] = useState(0)
  const [shopsError, setShopsError] = useState('')
  useEffect(() => {
    if (!needsShop) return undefined
    let active = true
    setShopsError('')
    loadPublicShops(data.companyId)
      .then(() => { if (active) setShopsLoaded((n) => n + 1) })
      .catch((failure) => { if (active) setShopsError(failure.message) })
    return () => { active = false }
  }, [needsShop, data.companyId])
  const filteredShops = useMemo(
    () => (needsShop ? searchShops(data.companyId, shopSearch) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needsShop, data.companyId, shopSearch, shopsLoaded],
  )
  const chosenIds = data.assignedShopIds ?? []
  const newShops = data.newShops ?? []
  const count = selectedShopCount(data)
  const full = count >= MAX_SHOPS
  const shopError = validateAllocatedShop(data) || validateShopCount(data)
  const showShopError = Boolean(shopError) && showErrors

  // Every change keeps the fields the backend reads today pointing at the
  // first shop (see utils/shopSelection).
  const applyShops = (ids, added) => {
    onChange('assignedShopIds', ids)
    onChange('newShops', added)
    const legacy = backendShopFields(ids, added)
    onChange('shopMode', legacy.shopMode)
    onChange('assignedShopId', legacy.assignedShopId)
    onChange('newShop', legacy.newShop)
  }
  const toggleExisting = (shopId) => {
    if (chosenIds.includes(shopId)) applyShops(chosenIds.filter((id) => id !== shopId), newShops)
    else if (!full) applyShops([...chosenIds, shopId], newShops)
  }
  const addNewShop = () => {
    if (full) return
    const first = newShops.length === 0 && chosenIds.length === 0 && shopSearch.trim() ? shopSearch.trim() : ''
    applyShops(chosenIds, [...newShops, { ...EMPTY_NEW_SHOP, shopName: first }])
  }
  const setNewShop = (index, field, value) => applyShops(chosenIds, newShops.map((sh, i) => (i === index ? { ...sh, [field]: value } : sh)))
  const removeNewShop = (index) => applyShops(chosenIds, newShops.filter((_, i) => i !== index))

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
            Shops you work at <span className="required-tag">{count} of {MAX_SHOPS}</span>
          </legend>
          <p className="shop-help">
            Choose the shop you work at. If you work at more than one, you can add up to {MAX_SHOPS - 1} more
            ({MAX_SHOPS} in total). Tick shops from the list, or add a shop that is not in it.
          </p>
          {shopsError && <p className="field-error" role="alert">{shopsError}</p>}

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
          <div className="shop-options" role="group" aria-label="Shops you work at">
            {filteredShops.length === 0 && (
              <p className="shop-options-empty">
                {shopSearch.trim() ? <>No shops match &ldquo;{shopSearch}&rdquo;.</> : 'The shop list is empty.'} You can add the shop below.
              </p>
            )}
            {filteredShops.map((shop) => {
              const selected = chosenIds.includes(shop.shopId)
              const disabled = !selected && full
              return (
                <button
                  key={shop.shopId}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  aria-disabled={disabled}
                  className={`shop-option${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                  onClick={() => toggleExisting(shop.shopId)}
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
                    <span className="shop-option-address">{[shop.area, shop.town].filter(Boolean).join(', ') || shop.address || '—'}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {newShops.map((sh, i) => (
            <div key={i} className="shop-new">
              <p className="shop-new-title">New shop {newShops.length > 1 ? i + 1 : ''}</p>
              <div className="shop-new-grid">
                <div className="form-field">
                  <label className="form-label" htmlFor={`new-shop-name-${i}`}>Shop name</label>
                  <input id={`new-shop-name-${i}`} className="form-input" value={sh.shopName} placeholder="e.g. China Mall, Shoprite, Melcom" autoComplete="off" onChange={(e) => setNewShop(i, 'shopName', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor={`new-shop-town-${i}`}>City or town</label>
                  <input id={`new-shop-town-${i}`} className="form-input" value={sh.town} placeholder="e.g. Accra, Kumasi, Ashaiman" autoComplete="off" onChange={(e) => setNewShop(i, 'town', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor={`new-shop-area-${i}`}>Area</label>
                  <input id={`new-shop-area-${i}`} className="form-input" value={sh.area ?? ''} placeholder="e.g. Spintex Road" autoComplete="off" onChange={(e) => setNewShop(i, 'area', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor={`new-shop-address-${i}`}>Full address <span className="optional-tag">(optional)</span></label>
                  <input id={`new-shop-address-${i}`} className="form-input" value={sh.address} placeholder="e.g. Opposite the Ashaiman main station" autoComplete="off" onChange={(e) => setNewShop(i, 'address', e.target.value)} />
                </div>
              </div>
              <button type="button" className="shop-add-link" onClick={() => removeNewShop(i)}>Remove this shop</button>
            </div>
          ))}

          {!full ? (
            <button type="button" className="shop-add-link" onClick={addNewShop}>
              {count === 0 ? '+ My shop is not in the list — add it' : `+ Add another shop (${MAX_SHOPS - count} more allowed)`}
            </button>
          ) : (
            <p className="shop-help">You have chosen the maximum of {MAX_SHOPS} shops.</p>
          )}
          {newShops.length > 0 && (
            <p className="shop-help">New shops are saved to this company&apos;s shop list. HR confirms their locations on the map.</p>
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
