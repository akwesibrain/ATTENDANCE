import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getNextAction,
  lookupEmployee,
  recordAttendance,
} from '../services/attendanceService'
import { evaluateAction } from '../constants/attendancePolicy'
import '../styles/registration.css'

const STEP = {
  staffId: 0,
  scan: 1,
  success: 2,
}

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
      const action = getNextAction(found.staffId)
      if (action === null) {
        setError('You have already completed check-in and check-out for today.')
        setLoading(false)
        return
      }
      // Enforce the time window before proceeding to the scanner.
      const window = evaluateAction(action)
      if (!window.allowed) {
        setError(window.message)
        setLoading(false)
        return
      }
      setEmployee(found)
      setNextAction(action)
      setStep(STEP.scan)
    } catch (err) {
      setError(err?.message ?? 'Unable to find that Staff ID.')
    } finally {
      setLoading(false)
    }
  }

  // Capture a frame and run the simulated verification.
  const handleScan = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || loading) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const captured = canvas.toDataURL('image/jpeg', 0.9)

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
    } finally {
      setLoading(false)
    }
  }

  const actionLabel = nextAction === 'check-in' ? 'Check In' : 'Check Out'

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

        {step === STEP.scan && employee && (
          <section className="card">
            <p className="step-eyebrow">Attendance — {actionLabel}</p>
            <h2 className="step-title">Scan your face</h2>
            <p className="step-description">
              Center your face in the frame and hold still. We&apos;ll verify
              you to {actionLabel.toLowerCase()}.
            </p>

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
                  setStep(STEP.staffId)
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
              {result.type === 'check-in' ? 'Checked In' : 'Checked Out'}
            </h2>
            <p className="step-description" style={{ marginBottom: 0 }}>
              {result.type === 'check-in'
                ? 'Face verified. Have a great day at work.'
                : 'Face verified. Thank you, see you next time.'}
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
                <div className="success-row">
                  <span className="review-label">Status</span>
                  {result.status === 'late' ? (
                    <span className="status-badge status-late">LATE</span>
                  ) : (
                    <span className="status-badge">ON TIME</span>
                  )}
                </div>
              </div>
            </div>

            <p className="success-message">
              {result.type === 'check-in'
                ? result.status === 'late'
                  ? 'You are checked in and marked as late coming (after 9:00 AM). You can check out between 5:00 and 7:00 PM.'
                  : 'You are checked in. You can check out between 5:00 and 7:00 PM.'
                : 'You are checked out. Your attendance for today is complete.'}
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
