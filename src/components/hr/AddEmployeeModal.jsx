import { useEffect, useState } from 'react'
import PersonalInformation from '../registration/PersonalInformation'
import JobPosition from '../registration/JobPosition'
import FaceEnrollment from '../registration/FaceEnrollment'
import RegistrationProgress from '../registration/RegistrationProgress'
import { isJobPositionValid, isPersonalInformationValid } from '../../utils/registrationValidation'
import { createEmployeeByHr, enrolUrl } from '../../services/onboardingService'
import LinkResult from './LinkResult'
import '../../styles/registration.css'

const STEP = { personal: 0, position: 1, face: 2, done: 3 }
const PROGRESS_LABELS = ['Details', 'Job', 'Face']

const blankForm = (companyId) => ({
  companyId,
  firstName: '',
  middleName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  faceImage: null,
  faceDescriptor: null,
  position: '',
  assignedShopId: null,
  shopMode: 'existing',
  newShop: { shopName: '', town: '', area: '', address: '', latitude: '', longitude: '', locationSource: null, locationLabel: null },
  paymentMethod: '',
  confirmed: false,
})

/**
 * HR adds an employee for one company. The face is scanned now with the
 * employee present, or set up later by the employee through a one-time link.
 */
export default function AddEmployeeModal({ companyId, onClose, onCreated }) {
  const [step, setStep] = useState(STEP.personal)
  const [form, setForm] = useState(() => blankForm(companyId))
  const [faceMode, setFaceMode] = useState('link')
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const update = (name, value) => setForm((prev) => ({ ...prev, [name]: value }))

  const stepValid = {
    [STEP.personal]: isPersonalInformationValid(form),
    [STEP.position]: isJobPositionValid(form),
    [STEP.face]: faceMode === 'link' || Boolean(form.faceImage && form.faceDescriptor && form.confirmed),
  }

  const next = () => {
    if (!stepValid[step]) { setShowErrors(true); return }
    setShowErrors(false)
    setStep(step + 1)
  }

  const submit = async () => {
    if (busy || !stepValid[STEP.face]) { setShowErrors(true); return }
    setBusy(true)
    setError(null)
    const payload = faceMode === 'link' ? { ...form, faceImage: null, faceDescriptor: null } : form
    try {
      const created = await createEmployeeByHr(payload, { sendFaceLink: faceMode === 'link' })
      if (created.errors) { setError(created.error ?? 'Could not add the employee.'); return }
      setResult(created)
      setStep(STEP.done)
      onCreated?.(created)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="sm-modal add-emp-modal" role="dialog" aria-modal="true" aria-labelledby="add-emp-title">
        <div className="sm-modal-head">
          <div>
            <h3 id="add-emp-title">Add employee</h3>
            <p>{step === STEP.done ? 'Done' : 'They get a Staff ID straight away.'}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} disabled={busy} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="sm-modal-body">
          {step < STEP.done && <RegistrationProgress steps={PROGRESS_LABELS} currentStep={step} />}

          {step === STEP.personal && <PersonalInformation data={form} onChange={update} showErrors={showErrors} />}
          {step === STEP.position && <JobPosition data={form} onChange={update} showErrors={showErrors} onSubmit={next} />}

          {step === STEP.face && (
            <section className="add-emp-face">
              <fieldset className="add-emp-choice">
                <legend className="sh-form-label">How will their face be set up?</legend>
                <label className={`add-emp-option${faceMode === 'link' ? ' is-selected' : ''}`}>
                  <input type="radio" name="face-mode" value="link" checked={faceMode === 'link'} onChange={() => setFaceMode('link')} />
                  <span>
                    <strong>Send a setup link</strong>
                    <span className="ed-hint">They open it on their own phone within 7 days and scan their face. It is texted to {form.phone || 'their phone'} when SMS is on, and you can copy it too.</span>
                  </span>
                </label>
                <label className={`add-emp-option${faceMode === 'scan' ? ' is-selected' : ''}`}>
                  <input type="radio" name="face-mode" value="scan" checked={faceMode === 'scan'} onChange={() => setFaceMode('scan')} />
                  <span>
                    <strong>Scan now</strong>
                    <span className="ed-hint">The employee is here with you. Use this device’s camera.</span>
                  </span>
                </label>
              </fieldset>

              {faceMode === 'scan' && (
                <>
                  <FaceEnrollment
                    faceImage={form.faceImage}
                    onCapture={(image, descriptor = null) => { update('faceImage', image); update('faceDescriptor', descriptor) }}
                  />
                  <label className="confirm-check">
                    <input type="checkbox" checked={form.confirmed} onChange={(e) => update('confirmed', e.target.checked)} />
                    <span>
                      The employee has read the biometric privacy notice and consents to their face photo being used
                      for attendance identity verification, including storage and processing on our servers, which
                      may be outside Ghana.
                    </span>
                  </label>
                  {showErrors && !stepValid[STEP.face] && (
                    <p className="ed-error" role="alert">Capture the face and tick the consent box to continue.</p>
                  )}
                </>
              )}
            </section>
          )}

          {step === STEP.done && result && (
            <section className="add-emp-done">
              <p className="add-emp-staff-id">
                <span className="sm-detail-label">Staff ID</span>
                <strong>{result.staffId}</strong>
              </p>
              <p>{result.fullName} was added to {result.companyName}.</p>
              {result.link
                ? (
                  <>
                    <p className="ed-hint">Their face is not set up yet. They cannot check in until they use this link.</p>
                    <LinkResult url={enrolUrl(result.link.token)} {...result.link} />
                  </>
                )
                : <p className="ed-hint">Their face is set up. They can check in now.</p>}
            </section>
          )}

          {error && <p className="at-form-alert" role="alert">{error}</p>}
        </div>

        <div className="sm-alert-actions">
          {step === STEP.done ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
          ) : (
            <>
              {step > STEP.personal && (
                <button type="button" className="btn btn-secondary" onClick={() => { setShowErrors(false); setStep(step - 1) }} disabled={busy}>Back</button>
              )}
              {step < STEP.face
                ? <button type="button" className="btn btn-primary" onClick={next}>Continue</button>
                : (
                  <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                    {busy ? 'Adding…' : faceMode === 'link' ? 'Add and create link' : 'Add employee'}
                  </button>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
