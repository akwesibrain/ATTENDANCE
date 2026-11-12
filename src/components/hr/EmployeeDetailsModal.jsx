import { useEffect, useState } from 'react'
import { employeeJoinedOn, setEmployeeActive, updateEmployeeDetails, validateEmployeeDetails } from '../../services/registrationService'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'
import { formatTenure, tenureBetween } from '../../utils/tenure'
import { enrolUrl, sendFaceLink } from '../../services/onboardingService'
import LinkResult from './LinkResult'

/**
 * HR edits the date an employee joined the company and their emergency
 * contact, and deactivates leavers. Time with the company is calculated from
 * the joining date.
 */
export default function EmployeeDetailsModal({ employee, onClose, onSaved }) {
  const today = accraTodayKey()
  const [form, setForm] = useState({
    joinedOn: employeeJoinedOn(employee) ?? '',
    emergencyContactName: employee.emergencyContactName ?? '',
    emergencyContactPhone: employee.emergencyContactPhone ?? '',
  })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (k, v) => {
    const next = { ...form, [k]: v }
    setForm(next)
    if (touched) setErrors(validateEmployeeDetails(next, today))
  }
  const preview = tenureBetween(form.joinedOn, today)
  const active = employee.status === 'ACTIVE'
  const [leftOn, setLeftOn] = useState(today)
  const [statusError, setStatusError] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)

  const changeStatus = async () => {
    setStatusBusy(true)
    setStatusError(null)
    try {
      const result = await setEmployeeActive(employee.staffId, !active, active ? leftOn : null)
      if (result.errors) { setStatusError(result.errors.leftOn ?? result.errors.form ?? 'Could not change the status.'); return }
      onSaved(result.employee)
    } finally {
      setStatusBusy(false)
    }
  }

  const [faceLink, setFaceLink] = useState(null)
  const [faceLinkError, setFaceLinkError] = useState(null)
  const [faceLinkBusy, setFaceLinkBusy] = useState(false)

  const makeFaceLink = async () => {
    setFaceLinkBusy(true)
    setFaceLinkError(null)
    try {
      const result = await sendFaceLink(employee.staffId)
      if (result.errors) { setFaceLinkError(result.error ?? 'Could not create the link.'); return }
      setFaceLink(result)
    } finally {
      setFaceLinkBusy(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setTouched(true)
    const result = await updateEmployeeDetails(employee.staffId, form)
    if (result.errors) { setErrors(result.errors); return }
    onSaved(result.employee)
  }

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-labelledby="ed-title" style={{ maxWidth: 560 }}>
        <div className="sm-modal-head">
          <div>
            <h3 id="ed-title">Employee details</h3>
            <p>{employee.fullName} · {employee.staffId}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <form className="sm-modal-body" onSubmit={save} noValidate>
          {errors.form && <p className="at-form-alert" role="alert">{errors.form}</p>}
          <section className="sm-section">
            <h4 className="sm-section-title">Employment</h4>
            <div className="ed-fields">
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="ed-joined">Date joined the company</label>
                <input id="ed-joined" type="date" className="sh-form-input" max={today} value={form.joinedOn} onChange={(e) => set('joinedOn', e.target.value)} aria-invalid={Boolean(errors.joinedOn)} aria-describedby="ed-joined-hint" />
                {errors.joinedOn
                  ? <span className="ed-error" role="alert">{errors.joinedOn}</span>
                  : <span id="ed-joined-hint" className="ed-hint">{employee.joinedOn ? 'Set by HR.' : 'Currently the registration date. Change it to the real joining date.'}</span>}
              </div>
              <div className="ed-tenure" aria-live="polite">
                <span className="sm-detail-label">Time with the company</span>
                <strong>{preview ? formatTenure(preview) : '—'}</strong>
                {preview && <span className="ed-hint">{preview.totalDays.toLocaleString()} days in total</span>}
              </div>
            </div>
          </section>
          <section className="sm-section">
            <h4 className="sm-section-title">Emergency contact</h4>
            <div className="ed-fields">
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="ed-ec-name">Emergency contact name</label>
                <input id="ed-ec-name" className="sh-form-input" autoComplete="off" value={form.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} aria-invalid={Boolean(errors.emergencyContactName)} />
                {errors.emergencyContactName && <span className="ed-error" role="alert">{errors.emergencyContactName}</span>}
              </div>
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="ed-ec-phone">Emergency contact phone</label>
                <input id="ed-ec-phone" className="sh-form-input" inputMode="tel" autoComplete="off" value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} aria-invalid={Boolean(errors.emergencyContactPhone)} />
                {errors.emergencyContactPhone && <span className="ed-error" role="alert">{errors.emergencyContactPhone}</span>}
              </div>
            </div>
          </section>
          {active && (
            <section className="sm-section">
              <h4 className="sm-section-title">Face for check-in</h4>
              <p className="ed-hint">
                {employee.facePhotoPath
                  ? 'Their face is set up. Send a new link only if check-in says their face photo needs to be registered again.'
                  : 'Their face is not set up yet, so they cannot check in. Send them a one-time link to do it on their phone.'}
              </p>
              {faceLinkError && <span className="ed-error" role="alert">{faceLinkError}</span>}
              {faceLink
                ? <LinkResult url={enrolUrl(faceLink.token)} {...faceLink} />
                : (
                  <button type="button" className="btn btn-secondary" onClick={makeFaceLink} disabled={faceLinkBusy}>
                    {faceLinkBusy ? 'Creating link…' : 'Send face setup link'}
                  </button>
                )}
            </section>
          )}
          <section className="sm-section">
            <h4 className="sm-section-title">Employment status</h4>
            {active ? (
              <div className="ed-fields">
                <div className="sh-form-field">
                  <label className="sh-form-label" htmlFor="ed-left">Last working day</label>
                  <input id="ed-left" type="date" className="sh-form-input" max={today} value={leftOn} onChange={(e) => setLeftOn(e.target.value)} aria-invalid={Boolean(statusError)} aria-describedby="ed-left-hint" />
                  {statusError
                    ? <span className="ed-error" role="alert">{statusError}</span>
                    : <span id="ed-left-hint" className="ed-hint">For someone who has left. Their Staff ID stops working at the kiosk, and later days no longer count as absences.</span>}
                </div>
                <div className="sh-form-field">
                  <span className="sh-form-label" aria-hidden="true">&nbsp;</span>
                  <button type="button" className="btn btn-secondary" onClick={changeStatus} disabled={statusBusy}>Deactivate employee</button>
                </div>
              </div>
            ) : (
              <div className="ed-fields">
                <div className="sh-form-field">
                  <span className="sh-form-label">Deactivated</span>
                  <span className="ed-hint">Last working day {employee.leftOn ? formatAccraDate(employee.leftOn) : 'not recorded'}. Reactivate only to undo a mistake: every day since then counts as an attendance day again.</span>
                  {statusError && <span className="ed-error" role="alert">{statusError}</span>}
                </div>
                <div className="sh-form-field">
                  <span className="sh-form-label" aria-hidden="true">&nbsp;</span>
                  <button type="button" className="btn btn-secondary" onClick={changeStatus} disabled={statusBusy}>Reactivate employee</button>
                </div>
              </div>
            )}
          </section>
          <div className="sm-alert-actions">
            <button type="submit" className="btn btn-primary">Save details</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
