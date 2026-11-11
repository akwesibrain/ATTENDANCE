import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACTIONS,
  getAvailableActions,
  getRemainingAttempts,
  isMarkedAbsent,
  lookupEmployee,
  recordAttendance,
} from '../services/attendanceService'
import { evaluateAction } from '../constants/attendancePolicy'
import { categoryForPosition, categoryLabel } from '../constants/employeeCategories'
import { mockListShops } from '../services/shopsService'
import { VISIT_RESULT, validateVisitOutlet } from '../services/fieldVisitsService'
import '../styles/registration.css'
import { captureVideoFrame } from '../utils/imageCompression'

const STEP = {
  staffId: 0,
  scan: 1,
  success: 2,
  choose: 3,
  visit: 4,
}

const EMPTY_VISIT = { mode: 'directory', shopId: '', name: '', town: '' }

/** Simulated face-scan duration (ms) before the mock verification resolves. */
const SCAN_DURATION_MS = 2600

/**
 * Attendance check-in / check-out (frontend, mock-backed).
 *
 * Flow: enter Staff ID -> live face scan -> verified result.
 * The live scanner captures a fresh photo and the mock service "verifies" it
 * against the enrolled image. Real biometric matching is a backend
 * responsibility — this only simulates the interaction.
 *
 * STRICT RULE: an employee completes at most one check-in and one check-out
 * per day. After a successful verification the flow ends; there is no way to
 * record another event until the next required action (check-out, or the next
 * day's check-in).
 */
export default function AttendanceCheckIn({ onBack }) {
  const [step, setStep] = useState(STEP.staffId)
  const [staffId, setStaffId] = useState('')
  const [employee, setEmployee] = useState(null)
  const [nextAction, setNextAction] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [mismatch, setMismatch] = useState(false)
  const [markedAbsent, setMarkedAbsent] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(null)
  const [actions, setActions] = useState([])
  const [visit, setVisit] = useState(EMPTY_VISIT)
  const [visitError, setVisitError] = useState('')
  // The phone's real location for an outlet visit. Never invented: if it
  // cannot be read, the visit is recorded as "no location".
  const [locating, setLocating] = useState({ status: 'idle', coords: null, message: '' })

  // Camera / scanner state
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraState, setCameraState] = useState('idle') // idle|requesting|active|scanning|error
  const [cameraError, setCameraError] = useState(null)

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    stopStream()
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error')
      setCameraError('unavailable')
      return
    }
    setCameraState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraState('active')
    } catch (err) {
      stopStream()
      setCameraState('error')
      setCameraError(
        err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
          ? 'denied'
          : 'unavailable',
      )
    }
  }, [stopStream])

  // Run the camera only while on the scan step.
  useEffect(() => {
    if (step === STEP.scan && cameraState === 'idle') {
      startCamera()
    }
    if (step !== STEP.scan) {
      stopStream()
    }
    return stopStream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const handleLookup = async () => {
    if (!staffId.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const found = await lookupEmployee(staffId)
      // ANTI-CHEAT: an employee auto-marked absent today is blocked entirely.
      if (isMarkedAbsent(found.staffId)) {
        setError(
          `${found.fullName} has been marked ABSENT for today after too many failed face-verification attempts. Please contact HR.`,
        )
        setLoading(false)
        return
      }
      const available = getAvailableActions(found.staffId)
      if (!available.length) {
        setError('You have already completed check-in and check-out for today.')
        setLoading(false)
        return
      }
      setEmployee(found)
      setActions(available)
      setAttemptsLeft(getRemainingAttempts(found.staffId))
      setMarkedAbsent(false)
      setMismatch(false)
      if (available.length === 1) {
        if (!chooseAction(available[0])) setEmployee(null)
      } else {
        setStep(STEP.choose)
      }
    } catch (err) {
      setError(err?.message ?? 'Unable to find that Staff ID.')
    } finally {
      setLoading(false)
    }
  }

  // Pick what to scan for. Clock-in/out keep their time windows; break and
  // visit scans happen during the working day.
  const chooseAction = (action) => {
    if (action === 'check-in' || action === 'check-out') {
      const window = evaluateAction(action)
      if (!window.allowed) {
        setError(window.message)
        return false
      }
    }
    setError(null)
    setNextAction(action)
    if (action === 'visit') {
      setVisit(EMPTY_VISIT)
      setVisitError('')
      readLocation()
      setStep(STEP.visit)
    } else {
      setStep(STEP.scan)
    }
    return true
  }

  const readLocation = () => {
    if (!navigator.geolocation) {
      setLocating({ status: 'error', coords: null, message: 'This phone cannot share its location.' })
      return
    }
    setLocating({ status: 'locating', coords: null, message: '' })
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocating({ status: 'ok', coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }, message: '' }),
      (err) => setLocating({ status: 'error', coords: null, message: err?.code === 1 ? 'Location permission was denied.' : 'Location is not available right now.' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const visitOutlet = () => (visit.mode === 'directory'
    ? (visit.shopId ? { shopId: visit.shopId } : null)
    : { shopId: null, name: visit.name, town: visit.town })

  const continueVisit = () => {
    const problem = validateVisitOutlet(visitOutlet())
    if (problem) { setVisitError(problem); return }
    setVisitError('')
    setStep(STEP.scan)
  }

  // Capture a frame and run the simulated verification.
  const handleScan = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || loading) return

    const captured = captureVideoFrame(video)

    setCameraState('scanning')
    setError(null)
    setMismatch(false)
    setLoading(true)
    try {
      // Simulate the scan/verification delay, then record via the mock service.
      await new Promise((resolve) => setTimeout(resolve, SCAN_DURATION_MS))
      const event = await recordAttendance({
        staffId: employee.staffId,
        faceImage: captured,
        action: nextAction,
        visit: nextAction === 'visit'
          ? { outlet: visitOutlet(), location: locating.coords, locationError: locating.status === 'ok' ? null : (locating.message || 'Location not provided') }
          : null,
      })
      stopStream()
      setResult(event)
      setStep(STEP.success)
    } catch (err) {
      setCameraState('active')
      const message = err?.message ?? 'Verification failed. Please try again.'
      setError(message)
      // Surface an identity mismatch prominently so it cannot be missed.
      setMismatch(/face does not match/i.test(message))
      // Refresh the anti-cheat state: remaining attempts, and whether this
      // scan pushed the employee over the limit into an ABSENT mark.
      const nowAbsent = isMarkedAbsent(employee.staffId)
      setMarkedAbsent(nowAbsent)
      setAttemptsLeft(getRemainingAttempts(employee.staffId))
    } finally {
      setLoading(false)
    }
  }

  const actionLabel = ACTIONS[nextAction]?.label ?? 'Check In'
  const category = categoryForPosition(employee?.position)
  const directoryShops = employee ? mockListShops(employee.companyId) : []

  return (
    <main className="registration-page">
      <div className="registration-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">
            WA
          </span>
          Workforce Attendance
        </header>

        {step === STEP.staffId && (
          <section className="card">
            <p className="step-eyebrow">Attendance</p>
            <h2 className="step-title">Enter your Staff ID</h2>
            <p className="step-description">
              Enter the Staff ID you received at registration, then verify your
              face to check in or out.
            </p>

            <div className="form-field">
              <label className="form-label" htmlFor="field-staffId">
                Staff ID
              </label>
              <input
                id="field-staffId"
                className={`form-input ${error ? 'has-error' : ''}`}
                type="text"
                value={staffId}
                placeholder="e.g. BFL-0001"
                autoComplete="off"
                onChange={(e) => setStaffId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              />
              {error && (
                <span className="field-error" role="alert">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {error}
                </span>
              )}
            </div>

            <div className="step-actions">
              <button type="button" className="btn btn-secondary" onClick={onBack}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleLookup}
                disabled={!staffId.trim() || loading}
              >
                {loading ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    Checking…
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </div>
          </section>
        )}

        {step === STEP.choose && employee && (
          <section className="card">
            <p className="step-eyebrow">Attendance — {categoryLabel(category, { single: true })}</p>
            <h2 className="step-title">What are you scanning for?</h2>
            <p className="step-description">
              {employee.fullName} ({employee.staffId}). Choose one, then verify your face.
            </p>
            <div className="home-actions">
              {actions.map((a) => (
                <button key={a} type="button" className="home-option" onClick={() => chooseAction(a)}>
                  <span className="home-option-text">
                    <span className="home-option-title">{ACTIONS[a].label}</span>
                    <span className="home-option-desc">
                      {a === 'break-start' && 'Leaving for your break. Scan again when you come back.'}
                      {a === 'break-end' && 'Returning from your break.'}
                      {a === 'visit' && 'You have arrived at an outlet. Your location is checked against the outlet.'}
                      {a === 'check-out' && 'Finishing work for the day.'}
                      {a === 'check-in' && 'Starting work for the day.'}
                    </span>
                  </span>
                  <span className="home-option-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
            {error && <div className="submit-error" role="alert" style={{ marginTop: 16 }}><span>{error}</span></div>}
            <div className="step-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setError(null); setStep(STEP.staffId) }}>Back</button>
            </div>
          </section>
        )}

        {step === STEP.visit && employee && (
          <section className="card">
            <p className="step-eyebrow">Outlet visit — {categoryLabel(category, { single: true })}</p>
            <h2 className="step-title">Which outlet are you at?</h2>
            <p className="step-description">
              {category === 'supervisor'
                ? 'Choose the outlet from the list. If it is not listed, enter it yourself.'
                : 'Enter the mini-market you are visiting, or choose it from the list if it is there.'}
            </p>
            <div className="visit-mode" role="radiogroup" aria-label="How to choose the outlet">
              <label className={`visit-mode-option${visit.mode === 'directory' ? ' is-selected' : ''}`}>
                <input type="radio" name="visit-mode" checked={visit.mode === 'directory'} onChange={() => setVisit((v) => ({ ...v, mode: 'directory' }))} />
                From the outlet list
              </label>
              <label className={`visit-mode-option${visit.mode === 'other' ? ' is-selected' : ''}`}>
                <input type="radio" name="visit-mode" checked={visit.mode === 'other'} onChange={() => setVisit((v) => ({ ...v, mode: 'other' }))} />
                Enter another outlet
              </label>
            </div>
            {visit.mode === 'directory' ? (
              <div className="form-field">
                <label className="form-label" htmlFor="visit-shop">Outlet</label>
                <select id="visit-shop" className="form-input" value={visit.shopId} onChange={(e) => setVisit((v) => ({ ...v, shopId: e.target.value }))}>
                  <option value="">Choose an outlet…</option>
                  {directoryShops.map((sh) => <option key={sh.shopId} value={sh.shopId}>{sh.shopName}</option>)}
                </select>
              </div>
            ) : (
              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label" htmlFor="visit-name">Outlet name</label>
                  <input id="visit-name" className="form-input" value={visit.name} placeholder="e.g. Adom Mini Mart" onChange={(e) => setVisit((v) => ({ ...v, name: e.target.value }))} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="visit-town">Town or area</label>
                  <input id="visit-town" className="form-input" value={visit.town} placeholder="e.g. Madina" onChange={(e) => setVisit((v) => ({ ...v, town: e.target.value }))} />
                </div>
              </div>
            )}
            <div className={`visit-location is-${locating.status}`} role="status">
              {locating.status === 'locating' && 'Reading your location…'}
              {locating.status === 'ok' && `Location found (accurate to about ${Math.round(locating.coords.accuracy)} m).`}
              {locating.status === 'error' && `${locating.message} The visit will be recorded without a location.`}
              {locating.status !== 'locating' && (
                <button type="button" className="btn btn-outline visit-location-retry" onClick={readLocation}>
                  {locating.status === 'ok' ? 'Read again' : 'Try again'}
                </button>
              )}
            </div>
            {visitError && <span className="field-error" role="alert">{visitError}</span>}
            <div className="step-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStep(actions.length > 1 ? STEP.choose : STEP.staffId)}>Back</button>
              <button type="button" className="btn btn-primary" onClick={continueVisit} disabled={locating.status === 'locating'}>Continue to face scan</button>
            </div>
          </section>
        )}

        {step === STEP.scan && employee && markedAbsent && (
          <section className="card">
            <div className="face-mismatch" role="alert" style={{ marginTop: 0 }}>
              <span className="face-mismatch-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <div>
                <h3>Marked ABSENT for today</h3>
                <p>
                  <strong>{employee.fullName}</strong> ({employee.staffId}) has
                  been marked <strong>ABSENT</strong> after too many failed
                  face-verification attempts. This looks like an attempt to
                  cheat the system. Please contact HR.
                </p>
              </div>
            </div>
            <div className="step-actions">
              <button type="button" className="btn btn-primary" onClick={onBack}>
                Done
              </button>
            </div>
          </section>
        )}

        {step === STEP.scan && employee && !markedAbsent && (
          <section className="card">
            <p className="step-eyebrow">Attendance — {actionLabel}</p>
            <h2 className="step-title">Scan your face</h2>
            <p className="step-description">
              Center your face in the frame and hold still. We&apos;ll verify
              you to {actionLabel.toLowerCase()}.
            </p>

            {attemptsLeft !== null && attemptsLeft < 5 && (
              <div className="attempts-notice" role="note">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>
                  <strong>{attemptsLeft}</strong> verification attempt
                  {attemptsLeft === 1 ? '' : 's'} left. After 5 failed attempts
                  this Staff ID is marked <strong>ABSENT</strong>.
                </span>
              </div>
            )}

            {nextAction === 'check-in' && evaluateAction('check-in').status === 'late' && (
              <div className="late-notice" role="note">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>
                  It&apos;s past 9:00 AM — this check-in will be recorded as
                  <strong> late coming</strong>.
                </span>
              </div>
            )}

            {cameraState === 'error' ? (
              <div className="camera-error" role="alert">
                <span className="error-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="1" y="5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M23 7l-7 5 7 5V7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 2l20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <h3>{cameraError === 'denied' ? 'Camera permission denied' : 'Camera unavailable'}</h3>
                <p>
                  {cameraError === 'denied'
                    ? 'Face verification is required for attendance. Please allow camera access and try again.'
                    : 'We could not access a camera on this device.'}
                </p>
                <button type="button" className="btn btn-outline" onClick={startCamera}>
                  Try Again
                </button>
              </div>
            ) : (
              <div className={`scanner-frame ${cameraState === 'scanning' ? 'is-scanning' : ''}`}>
                <video ref={videoRef} playsInline muted autoPlay />
                {cameraState === 'requesting' && (
                  <div className="camera-placeholder">
                    <span className="btn-spinner" aria-hidden="true" />
                    Requesting camera permission…
                  </div>
                )}
                {(cameraState === 'active' || cameraState === 'scanning') && (
                  <>
                    <div className="scanner-corners" aria-hidden="true" />
                    {cameraState === 'scanning' && (
                      <>
                        <div className="scan-line" aria-hidden="true" />
                        <div className="scan-status" role="status">
                          <span className="btn-spinner" aria-hidden="true" />
                          Verifying your face…
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {mismatch && (
              <div className="face-mismatch" role="alert">
                <span className="face-mismatch-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <div>
                  <h3>Face does not match this Staff ID</h3>
                  <p>
                    The scanned face does not match the photo registered to{' '}
                    <strong>{employee.staffId}</strong>. You can only check in
                    or out with your own registered face.
                  </p>
                </div>
              </div>
            )}

            {error && cameraState !== 'error' && !mismatch && (
              <div className="submit-error" role="alert" style={{ marginTop: 16 }}>
                <span>{error}</span>
              </div>
            )}

            <div className="step-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setMismatch(false)
                  setError(null)
                  setStep(nextAction === 'visit' ? STEP.visit : actions.length > 1 ? STEP.choose : STEP.staffId)
                }}
                disabled={loading}
              >
                Back
              </button>
              {cameraState === 'active' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleScan}
                  disabled={loading}
                >
                  Scan &amp; {actionLabel}
                </button>
              )}
            </div>
          </section>
        )}

        {step === STEP.success && result && employee && (
          <section className="card success-card">
            <div className="success-icon" aria-hidden="true">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="step-title">
              {ACTIONS[result.type]?.past ?? 'Recorded'}
            </h2>
            <p className="step-description" style={{ marginBottom: 0 }}>
              {result.type === 'check-in' && 'Face verified. Have a great day at work.'}
              {result.type === 'check-out' && 'Face verified. Thank you, see you next time.'}
              {result.type === 'break-start' && 'Face verified. Enjoy your break — scan "Back from break" when you return.'}
              {result.type === 'break-end' && 'Face verified. Welcome back.'}
              {result.type === 'visit' && `Face verified. Visit recorded: ${VISIT_RESULT[result.verification?.status]?.label ?? ''}${result.verification?.distance != null ? ` (${result.verification.distance} m from the outlet)` : ''}.`}
            </p>

            <div className="verified-employee">
              <img
                className="verified-photo"
                src={employee.faceImage}
                alt={`${employee.fullName} registered`}
              />
              <div className="success-details" style={{ margin: 0, flex: 1 }}>
                <div className="success-row">
                  <span className="review-label">Employee</span>
                  <span className="review-value">{employee.fullName}</span>
                </div>
                <div className="success-row">
                  <span className="review-label">Staff ID</span>
                  <span className="review-value staff-id-value">{employee.staffId}</span>
                </div>
                <div className="success-row">
                  <span className="review-label">Company</span>
                  <span className="review-value">{employee.companyName}</span>
                </div>
                <div className="success-row">
                  <span className="review-label">Position</span>
                  <span className="review-value">{employee.position}</span>
                </div>
                <div className="success-row">
                  <span className="review-label">Time</span>
                  <span className="review-value">{new Date(result.time).toLocaleString()}</span>
                </div>
                {(result.type === 'check-in' || result.type === 'check-out') && <div className="success-row">
                  <span className="review-label">Status</span>
                  {result.status === 'late' ? (
                    <span className="status-badge status-late">LATE</span>
                  ) : (
                    <span className="status-badge">ON TIME</span>
                  )}
                </div>}
              </div>
            </div>

            <p className="success-message">
              {result.type === 'check-in' && (result.status === 'late'
                ? 'You are checked in and marked as late coming (after 9:00 AM). You can check out between 5:00 and 7:00 PM.'
                : 'You are checked in. You can check out between 5:00 and 7:00 PM.')}
              {result.type === 'check-out' && 'You are checked out. Your attendance for today is complete.'}
              {result.type === 'break-start' && 'Your break time is not counted as working time.'}
              {result.type === 'break-end' && 'You can take another break if your company allows it, or clock out at the end of the day.'}
              {result.type === 'visit' && 'Record a new visit at each outlet you go to. Clock out at the end of the day.'}
            </p>

            <div className="success-actions">
              <button type="button" className="btn btn-primary" onClick={onBack}>
                Done
              </button>
            </div>

            <p className="mock-banner">
              Demo environment — attendance recorded by the mock service, not a
              production backend.
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
