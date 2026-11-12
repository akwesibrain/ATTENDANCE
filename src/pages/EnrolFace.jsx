import { useEffect, useState } from 'react'
import FaceEnrollment from '../components/registration/FaceEnrollment'
import { getEnrolment, submitEnrolment } from '../services/onboardingService'
import { LINK_UNUSABLE } from '../../supabase/functions/_shared/rules/onboarding.js'
import '../styles/registration.css'

/**
 * The page a face setup link opens. HR added this employee without a face;
 * here they scan it on their own phone, once.
 */
export default function EnrolFace({ token }) {
  const [employee, setEmployee] = useState(null)
  const [closed, setClosed] = useState('')
  const [face, setFace] = useState({ image: null, descriptor: null })
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    getEnrolment(token)
      .then(setEmployee)
      .catch((failure) => setClosed(failure.status === 404 ? LINK_UNUSABLE : failure.message))
  }, [token])

  const ready = Boolean(face.image && face.descriptor && consent)

  const submit = async () => {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      const result = await submitEnrolment(token, { faceImage: face.image, faceDescriptor: face.descriptor, biometricConsent: true })
      if (result.errors) {
        if (result.error === LINK_UNUSABLE) setClosed(LINK_UNUSABLE)
        else setError(result.error)
        return
      }
      setDone(result)
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
          {closed && (
            <>
              <h2 className="step-title">Link closed</h2>
              <p className="step-description">{closed}</p>
            </>
          )}

          {!closed && !employee && <p className="step-description" role="status">Opening your face setup…</p>}

          {done && (
            <>
              <h2 className="step-title">Your face is set up</h2>
              <p className="step-description">You can now check in with Staff ID <strong>{done.staffId}</strong>.</p>
            </>
          )}

          {employee && !closed && !done && (
            <>
              <p className="step-eyebrow">{employee.companyName} · Staff ID {employee.staffId}</p>
              <h2 className="step-title">Set up your face, {employee.fullName.split(' ')[0]}</h2>
              <p className="step-description">
                HR added you. Scan your face once so you can check in and out with your Staff ID.
              </p>

              <FaceEnrollment
                faceImage={face.image}
                onCapture={(image, descriptor = null) => setFace({ image, descriptor })}
              />

              <label className="confirm-check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I accept the biometric privacy notice and consent to my face photo being used for attendance
                  identity verification, including storage and processing on our servers, which may be outside Ghana.
                </span>
              </label>

              {error && <div className="submit-error" role="alert" style={{ marginTop: 16 }}><span>{error}</span></div>}

              <div className="step-actions">
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !ready}>
                  {busy ? 'Saving…' : 'Save my face'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
