import { useCallback, useEffect, useRef, useState } from 'react'
import { getVisitsToday, recordVisit, trackingSession } from '../services/visitService'
import { describeFace, preloadFaceModels } from '../services/faceRecognition'
import { captureFrame } from '../utils/captureFrame'
import '../styles/registration.css'

const OTHER = '__other__'
const CLOCKED_OUT = 'You have clocked out. Visits can only be recorded while you are clocked in.'

/** The phone's location, or null if it is refused or takes too long. */
function currentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  })
}

function distanceText(m) {
  if (m == null) return null
  return m < 1000 ? `${Math.round(m / 10) * 10 || m} m` : `${(m / 1000).toFixed(1)} km`
}

/**
 * A Sales Representative or Supervisor records an outlet visit on the phone
 * they clocked in with: choose the outlet, scan the face, save.
 */
export default function RecordVisit() {
  const [session] = useState(() => trackingSession())
  const [today, setToday] = useState(null)
  const [choice, setChoice] = useState('')
  const [outlet, setOutlet] = useState({ name: '', town: '' })
  const [closed, setClosed] = useState(session ? '' : 'Clock in first. Visits can only be recorded while you are clocked in.')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  const load = useCallback(() => {
    getVisitsToday()
      .then((data) => { setToday(data); setChoice((c) => c || data.shops.find((s) => !s.visited)?.shopId || data.shops[0]?.shopId || OTHER) })
      .catch((failure) => {
        if (failure.data?.code === 'session_closed' || failure.data?.code === 'invalid_token') setClosed(CLOCKED_OUT)
        else setError(failure.message)
      })
  }, [])

  useEffect(() => {
    if (!session) return undefined
    preloadFaceModels()
    load()
    return stopCamera
  }, [session, load, stopCamera])

  const startCamera = async () => {
    setError('')
    setSaved(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      streamRef.current = stream
      setCameraOn(true)
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
    } catch {
      setError('Allow the camera for this site, then try again.')
    }
  }

  const save = async () => {
    const video = videoRef.current
    if (busy || !video?.videoWidth) return
    if (choice === OTHER && (outlet.name.trim().length < 2 || outlet.town.trim().length < 2)) {
      setError('Enter the outlet name and the town or area.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const faceImage = captureFrame(video)
      const [faceDescriptor, location] = await Promise.all([describeFace(faceImage), currentLocation()])
      const body = choice === OTHER ? { outlet, location, faceImage, faceDescriptor } : { shopId: choice, location, faceImage, faceDescriptor }
      const { visit } = await recordVisit(body)
      const place = choice === OTHER ? outlet.name.trim() : today?.shops.find((s) => s.shopId === choice)?.shopName ?? 'the outlet'
      setSaved({ place, distance: distanceText(visit.distanceM), noLocation: visit.status === 'location-unavailable' })
      stopCamera()
      load()
    } catch (failure) {
      if (failure.data?.code === 'session_closed' || failure.data?.code === 'invalid_token') { setClosed(CLOCKED_OUT); stopCamera() }
      else setError(failure.message)
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
          <p className="step-eyebrow">Field visits</p>
          <h2 className="step-title">Record a visit</h2>

          {closed && <p className="step-description" role="alert">{closed}</p>}
          {!closed && !today && !error && <p className="step-description" role="status">Loading your shops…</p>}

          {!closed && today && (
            <>
              <p className="step-description">Choose the outlet you are at, then scan your face. Your location is saved as a distance from the shop.</p>
              <fieldset className="form-grid" style={{ border: 0, padding: 0 }}>
                <legend className="form-label">Outlet</legend>
                {today.shops.map((shop) => (
                  <label key={shop.shopId} className="form-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <input type="radio" name="outlet" value={shop.shopId} checked={choice === shop.shopId} onChange={() => setChoice(shop.shopId)} />
                    <span>{shop.shopName}{shop.visited ? ' ✓ visited' : ''}{shop.hasLocation ? '' : ' · no location yet'}</span>
                  </label>
                ))}
                <label className="form-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="outlet" value={OTHER} checked={choice === OTHER} onChange={() => setChoice(OTHER)} />
                  <span>Other outlet</span>
                </label>
              </fieldset>
              {choice === OTHER && (
                <div className="form-grid">
                  <div className="form-field">
                    <label className="form-label" htmlFor="rv-name">Outlet name</label>
                    <input id="rv-name" className="form-input" value={outlet.name} onChange={(e) => setOutlet({ ...outlet, name: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="rv-town">Town or area</label>
                    <input id="rv-town" className="form-input" value={outlet.town} onChange={(e) => setOutlet({ ...outlet, town: e.target.value })} />
                  </div>
                </div>
              )}

              {cameraOn && (
                <div className="scanner-frame">
                  <video ref={videoRef} playsInline muted autoPlay />
                </div>
              )}

              {saved && (
                <p className="form-success" role="status">
                  Visit recorded at {saved.place}{saved.noLocation ? ' — location not available' : saved.distance ? ` — ${saved.distance} from the shop` : ''}.
                </p>
              )}
              {error && <div className="submit-error" role="alert"><span>{error}</span></div>}
              {today.attemptsLeft < 5 && today.attemptsLeft > 0 && <p className="step-description">{today.attemptsLeft} face scan attempts left today.</p>}

              <div className="step-actions">
                {!cameraOn
                  ? <button type="button" className="btn btn-primary" onClick={startCamera} disabled={today.attemptsLeft === 0}>Scan face and save</button>
                  : <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save visit'}</button>}
                {!cameraOn && <a className="btn btn-secondary" href="/shop-location">Set a shop's location</a>}
              </div>
            </>
          )}
          {!closed && error && !today && <div className="submit-error" role="alert"><span>{error}</span></div>}
        </section>
      </div>
    </main>
  )
}
