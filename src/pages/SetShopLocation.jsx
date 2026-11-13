import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_CAPTURE_ACCURACY_M } from '../../supabase/functions/_shared/rules/tracking.js'
import { getShopLocations, proposeShopLocation, trackingSession } from '../services/visitService'
import '../styles/registration.css'

const CLOCKED_OUT = 'You have clocked out. A shop location can only be set while you are clocked in.'
const READING_SECONDS = 20

function shopState(shop) {
  if (shop.pending) return 'Your suggestion is waiting for HR'
  return shop.hasLocation ? 'Location set' : 'No location yet'
}

/**
 * A Supervisor, Sales Representative or Merchandiser standing at one of their
 * shops suggests its location from the phone's GPS. HR confirms it before it
 * is used.
 */
export default function SetShopLocation() {
  const [session] = useState(() => trackingSession())
  const [shops, setShops] = useState(null)
  const [choice, setChoice] = useState('')
  const [closed, setClosed] = useState(session ? '' : 'Clock in first. A shop location can only be set while you are clocked in.')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  // reading: null | { status: 'reading' | 'done', best: { latitude, longitude, accuracy } | null, problem?: string }
  const [reading, setReading] = useState(null)
  const watchRef = useRef(null)
  const timerRef = useRef(null)

  const stopReading = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    if (timerRef.current != null) clearTimeout(timerRef.current)
    watchRef.current = null
    timerRef.current = null
  }, [])

  const failed = useCallback((failure) => {
    if (failure.data?.code === 'session_closed' || failure.data?.code === 'invalid_token') setClosed(CLOCKED_OUT)
    else setError(failure.message)
  }, [])

  const load = useCallback(() => {
    getShopLocations()
      .then((data) => {
        setShops(data.shops)
        setChoice((c) => c || data.shops.find((s) => !s.hasLocation && !s.pending)?.shopId || data.shops[0]?.shopId || '')
      })
      .catch(failed)
  }, [failed])

  useEffect(() => {
    if (!session) return undefined
    load()
    return stopReading
  }, [session, load, stopReading])

  const startReading = () => {
    setError('')
    setSaved('')
    if (!navigator.geolocation) {
      setError('This phone cannot share its location.')
      return
    }
    stopReading()
    setReading({ status: 'reading', best: null })
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
        if (!Number.isFinite(fix.accuracy)) return
        setReading((r) => (r && (!r.best || fix.accuracy < r.best.accuracy) ? { ...r, best: fix } : r))
      },
      (err) => {
        stopReading()
        setReading({
          status: 'done',
          best: null,
          problem: err?.code === 1
            ? 'Location permission is blocked. Allow location for this site in your browser settings.'
            : 'Location is not available. Turn on Location (GPS) on this phone.',
        })
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: READING_SECONDS * 1000 },
    )
    timerRef.current = setTimeout(() => {
      stopReading()
      setReading((r) => (r ? { ...r, status: 'done' } : r))
    }, READING_SECONDS * 1000)
  }

  const accuracy = reading?.best ? Math.round(reading.best.accuracy) : null
  const goodEnough = accuracy != null && accuracy <= MAX_CAPTURE_ACCURACY_M

  const save = async () => {
    if (busy || !goodEnough || !choice) return
    setBusy(true)
    setError('')
    stopReading()
    try {
      await proposeShopLocation({ shopId: choice, location: reading.best })
      const name = shops?.find((s) => s.shopId === choice)?.shopName ?? 'the shop'
      setSaved(`Location for ${name} sent to HR (accurate to ${accuracy} m). It is used once HR confirms it.`)
      setReading(null)
      load()
    } catch (failure) {
      failed(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="registration-page">
      <div className="registration-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">WA</span>
          Workforce Attendance
        </header>
        <section className="card">
          <p className="step-eyebrow">Your shops</p>
          <h2 className="step-title">Set a shop's location</h2>

          {closed && <p className="step-description" role="alert">{closed}</p>}
          {!closed && !shops && !error && <p className="step-description" role="status">Loading your shops…</p>}
          {!closed && shops?.length === 0 && <p className="step-description">You have no shops on your list yet. Ask HR to add them.</p>}

          {!closed && shops?.length > 0 && (
            <>
              <p className="step-description">Stand at the shop entrance. This saves the shop's location for HR to confirm.</p>
              <fieldset className="form-grid" style={{ border: 0, padding: 0 }}>
                <legend className="form-label">Shop you are standing at</legend>
                {shops.map((shop) => (
                  <label key={shop.shopId} className="form-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <input
                      type="radio"
                      name="shop"
                      value={shop.shopId}
                      checked={choice === shop.shopId}
                      onChange={() => { setChoice(shop.shopId); stopReading(); setReading(null); setSaved('') }}
                    />
                    <span>{shop.shopName} · {shopState(shop)}</span>
                  </label>
                ))}
              </fieldset>

              {reading && (
                <p className="step-description" role="status" aria-live="polite">
                  {reading.problem
                    ?? (accuracy == null
                      ? (reading.status === 'reading' ? 'Finding your location…' : 'No location was found. Move into the open and try again.')
                      : `Accuracy: ${accuracy} m${reading.status === 'reading' ? ' · still improving…' : ''}${goodEnough ? '' : ` · needs ${MAX_CAPTURE_ACCURACY_M} m or better. Move outside or away from tall buildings and try again.`}`)}
                </p>
              )}

              {saved && <p className="form-success" role="status">{saved}</p>}
              {error && <div className="submit-error" role="alert"><span>{error}</span></div>}

              <div className="step-actions">
                {goodEnough
                  ? <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Sending…' : 'Send this location to HR'}</button>
                  : <button type="button" className="btn btn-primary" onClick={startReading} disabled={reading?.status === 'reading' || !choice}>{reading?.status === 'reading' ? 'Reading GPS…' : reading ? 'Try again' : 'Set location here'}</button>}
                <a className="btn btn-secondary" href={session?.canRecordVisits ? '/visit' : '/attendance'}>Back</a>
              </div>
            </>
          )}
          {!closed && error && !shops && <div className="submit-error" role="alert"><span>{error}</span></div>}
        </section>
      </div>
    </main>
  )
}
