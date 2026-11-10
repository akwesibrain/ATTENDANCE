import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/backend/client'
import { describeFace, preloadFaceModels } from '../services/faceRecognition'
import { captureFrame } from '../utils/captureFrame'
import '../styles/registration.css'

const POSITION_TIMEOUT_MS = 15000

const RESULT_TEXT = {
  verified: { title: 'Check complete', body: 'Thank you. This attendance check has been recorded.' },
  'outside-shop': { title: 'Check recorded', body: 'Your location was outside your assigned shop. HR will review this check.' },
  'gps-unavailable': { title: 'Check recorded', body: 'Your location could not be read. HR will review this check.' },
  'failed-face': { title: 'Check recorded', body: 'Your face did not match your registered photo. HR will review this check.' },
}

/** The device's position, or nothing if it is refused or unavailable. */
function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({})
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: POSITION_TIMEOUT_MS },
    )
  })
}

/** The page an SMS link opens: one face scan and one location reading. */
export default function VerifyCheck({ token }) {
  const [check, setCheck] = useState(null)
  const [closed, setClosed] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    api(`/verify/${encodeURIComponent(token)}`).then(setCheck).catch((failure) => setClosed(failure.message))
  }, [token])

  const faceRequired = check?.faceRequired
  useEffect(() => {
    if (!faceRequired || result) return undefined
    preloadFaceModels()
    let active = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(async (stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setCameraReady(true)
      })
      .catch(() => setError('Please allow camera access and reload this page.'))
    return () => {
      active = false
      stopCamera()
    }
  }, [faceRequired, result, stopCamera])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const faceImage = faceRequired ? captureFrame(videoRef.current) : undefined
      const faceDescriptor = faceImage ? await describeFace(faceImage) : undefined
      const position = check.gpsRequired ? await currentPosition() : {}
      const response = await api(`/verify/${encodeURIComponent(token)}`, { method: 'POST', body: { faceImage, faceDescriptor, ...position } })
      stopCamera()
      setResult(response.result)
    } catch (failure) {
      if (failure.status === 410) setClosed(failure.message)
      else setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const message = result && RESULT_TEXT[result]
  return (
    <main className="registration-page">
      <div className="registration-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">WA</span>
          Workforce Attendance
        </header>
        <section className="card">
          {closed && (
            <>
              <h2 className="step-title">Link closed</h2>
              <p className="step-description">{closed}</p>
            </>
          )}
          {!closed && !check && <p className="step-description" role="status">Opening your check…</p>}
          {message && (
            <>
              <h2 className="step-title">{message.title}</h2>
              <p className="step-description">{message.body}</p>
            </>
          )}
          {check && !closed && !message && (
            <>
              <p className="step-eyebrow">Attendance check {check.verificationNumber} of 3</p>
              <h2 className="step-title">{check.fullName}</h2>
              <p className="step-description">
                {faceRequired ? 'Center your face in the frame. ' : ''}
                {check.gpsRequired ? 'Your location will be read once, for this check only.' : ''}
              </p>
              {faceRequired && (
                <div className="scanner-frame">
                  <video ref={videoRef} playsInline muted autoPlay />
                </div>
              )}
              {error && <div className="submit-error" role="alert" style={{ marginTop: 16 }}><span>{error}</span></div>}
              <div className="step-actions">
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || (faceRequired && !cameraReady)}>
                  {busy ? 'Checking…' : 'Complete check'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
