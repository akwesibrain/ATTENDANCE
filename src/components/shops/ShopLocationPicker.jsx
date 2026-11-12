import { useState } from 'react'
import { locationServiceStatus, searchPlaces } from '../../services/geocodingService'
import { LOCATION_SOURCES, validateCoordinates } from '../../services/shopsService'
import ShopMap from './ShopMap'
import '../../styles/shops.css'

/**
 * Find and confirm a shop's GPS location.
 *   1. "Find location" asks the configured lookup service (if any).
 *   2. HR picks the right match when several are similar.
 *   3. HR checks the pin on the map, moves it if needed, and confirms.
 * Only a confirmed location is passed to onChange. Without a lookup service,
 * HR can still type coordinates. Nothing is ever generated.
 *
 * value: { latitude, longitude, locationSource, locationLabel } or null
 */
export default function ShopLocationPicker({ shop, value, onChange }) {
  const svc = locationServiceStatus()
  const [state, setState] = useState({ status: 'idle', results: [], message: '' })
  const [draft, setDraft] = useState(null) // unconfirmed { latitude, longitude, locationSource, locationLabel }
  const [manual, setManual] = useState({ open: !svc.configured, latitude: '', longitude: '' })
  const [manualError, setManualError] = useState('')
  const shown = draft ?? value

  const find = async () => {
    setState({ status: 'loading', results: [], message: '' })
    const r = await searchPlaces(shop)
    setState(r)
    if (r.status === 'ok' && r.results.length === 1) choose(r.results[0])
  }

  const choose = (res) => setDraft({ latitude: res.latitude, longitude: res.longitude, locationSource: 'geocoded', locationLabel: `${res.label} (${res.provider})` })
  const movePin = (lat, lng) => setDraft((d) => ({ latitude: lat, longitude: lng, locationSource: 'map-adjusted', locationLabel: d?.locationLabel ?? null }))
  const confirm = () => {
    onChange(draft)
    setDraft(null)
  }
  const applyManual = () => {
    const errs = validateCoordinates(manual.latitude, manual.longitude)
    if (manual.latitude === '' || manual.longitude === '') errs.latitude = 'Enter both latitude and longitude.'
    if (Object.keys(errs).length) { setManualError(Object.values(errs)[0]); return }
    setManualError('')
    setDraft({ latitude: Number(manual.latitude), longitude: Number(manual.longitude), locationSource: 'manual', locationLabel: null })
  }

  return (
    <div className="slp">
      <div className="slp-head">
        <span className="slp-title">GPS location</span>
        {value ? (
          <span className="slp-value">
            {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)} · {LOCATION_SOURCES[value.locationSource]}
            <button type="button" className="shop-add-link slp-inline" onClick={() => { onChange(null); setDraft(null) }}>Clear</button>
          </span>
        ) : <span className="slp-none">Not set</span>}
      </div>

      {svc.configured ? (
        <div className="slp-row">
          <button type="button" className="sm-actions-btn" onClick={find} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Searching…' : 'Find location automatically'}
          </button>
          <span className="slp-hint">Uses {svc.label} with the shop name, area and town.</span>
        </div>
      ) : (
        <p className="slp-off" role="note">
          Automatic location lookup is not configured, so no coordinates are filled in. It can be switched on in
          Settings → Merchandiser Monitoring → Location services. You can save the shop now and set its location later, or enter the
          coordinates below.
        </p>
      )}

      {state.status === 'invalid' && <p className="slp-msg">{state.message}</p>}
      {state.status === 'error' && <p className="slp-msg slp-err" role="alert">{state.message}</p>}
      {state.status === 'no-results' && <p className="slp-msg">No matching places were found for “{state.query}”. Check the spelling, or place the pin on the map yourself.</p>}
      {state.status === 'ok' && state.results.length > 1 && (
        <fieldset className="slp-results">
          <legend className="slp-hint">{state.results.length} possible matches — choose the right shop:</legend>
          {state.results.map((r) => (
            <label key={r.id} className={`slp-result${draft?.locationLabel?.startsWith(r.label) ? ' is-picked' : ''}`}>
              <input type="radio" name="slp-result" checked={Boolean(draft?.locationLabel?.startsWith(r.label))} onChange={() => choose(r)} />
              <span><strong>{r.label}</strong>{r.kind && <span className="slp-hint"> · {r.kind}</span>}</span>
            </label>
          ))}
        </fieldset>
      )}

      {(svc.tiles || shown) && (
        <ShopMap
          latitude={shown?.latitude ?? null}
          longitude={shown?.longitude ?? null}
          tileUrl={svc.tiles ? svc.tileUrl : null}
          attribution={svc.attribution}
          onPick={svc.tiles ? movePin : undefined}
          height={240}
          label={`${shop.shopName || 'Shop'} location`}
        />
      )}

      {draft && (
        <div className="slp-confirm" role="status">
          <span>
            Check the pin is on <strong>{shop.shopName || 'the shop'}</strong>: {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
            {draft.locationLabel ? ` — ${draft.locationLabel}` : ''}
          </span>
          <div className="slp-row">
            <button type="button" className="btn btn-primary at-btn" onClick={confirm}>Confirm this location</button>
            <button type="button" className="btn btn-secondary at-btn" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}

      <div className="slp-manual">
        <button type="button" className="shop-add-link" onClick={() => setManual((m) => ({ ...m, open: !m.open }))} aria-expanded={manual.open}>
          {manual.open ? '− Hide manual coordinates' : '+ Enter coordinates manually'}
        </button>
        {manual.open && (
          <div className="slp-row">
            <label className="slp-field">Latitude<input className="form-input" inputMode="decimal" value={manual.latitude} placeholder="e.g. 5.6944" onChange={(e) => setManual((m) => ({ ...m, latitude: e.target.value }))} /></label>
            <label className="slp-field">Longitude<input className="form-input" inputMode="decimal" value={manual.longitude} placeholder="e.g. -0.0329" onChange={(e) => setManual((m) => ({ ...m, longitude: e.target.value }))} /></label>
            <button type="button" className="sm-actions-btn" onClick={applyManual}>Use these coordinates</button>
          </div>
        )}
        {manualError && <p className="slp-msg slp-err" role="alert">{manualError}</p>}
      </div>
    </div>
  )
}
