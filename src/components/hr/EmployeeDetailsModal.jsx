import { useEffect, useState } from 'react'
import { getSessionUser } from '../../services/permissionsService'
import { employeeJoinedOn, mockUpdateEmployeeDetails, validateEmployeeDetails } from '../../services/registrationService'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'
import { formatTenure, tenureBetween } from '../../utils/tenure'

/**
 * HR enters the date an employee joined the company and their emergency
 * contact — once. A review step shows what will be saved; after confirming,
 * the details are locked and can no longer be edited.
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
  const [reviewing, setReviewing] = useState(false)

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

  // Step 1: check the form, then show what will be locked.
  const review = (e) => {
    e.preventDefault()
    setTouched(true)
    const errs = validateEmployeeDetails(form, today)
    setErrors(errs)
    if (!Object.keys(errs).length) setReviewing(true)
  }
  // Step 2: save and lock.
  const confirm = () => {
    const result = mockUpdateEmployeeDetails(employee.staffId, form, getSessionUser())
    if (result.errors) { setErrors(result.errors); setReviewing(false); return }
    onSaved(result.employee)
  }

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-labelledby="ed-title" style={{ maxWidth: 560 }}>
        <div className="sm-modal-head">
          <div>
            <h3 id="ed-title">{reviewing ? 'Confirm employee details' : 'Employee details'}</h3>
            <p>{employee.fullName} · {employee.staffId}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {reviewing ? (
          <div className="sm-modal-body">
            <p className="ed-lock-warning" role="note">
              <strong>Check carefully.</strong> Once confirmed, these details are locked and can no longer be edited.
            </p>
            <section className="sm-section">
              <h4 className="sm-section-title">You are about to save</h4>
              <div className="sm-detail-grid">
                <div className="sm-detail"><span className="sm-detail-label">Date joined</span><span className="sm-detail-value">{formatAccraDate(form.joinedOn)}</span></div>
                <div className="sm-detail"><span className="sm-detail-label">Time with the company</span><span className="sm-detail-value">{formatTenure(preview)}</span></div>
                <div className="sm-detail"><span className="sm-detail-label">Emergency contact name</span><span className="sm-detail-value">{form.emergencyContactName.trim()}</span></div>
                <div className="sm-detail"><span className="sm-detail-label">Emergency contact phone</span><span className="sm-detail-value">{form.emergencyContactPhone.trim()}</span></div>
              </div>
            </section>
            <div className="sm-alert-actions">
              <button type="button" className="btn btn-primary" onClick={confirm}>Confirm and lock</button>
              <button type="button" className="btn btn-secondary" onClick={() => setReviewing(false)}>Back to edit</button>
            </div>
          </div>
        ) : (
        <form className="sm-modal-body" onSubmit={review} noValidate>
          {errors.form && <p className="at-form-alert" role="alert">{errors.form}</p>}
          <p className="ed-hint">These details can be entered once. You will see a summary to check before they are saved and locked.</p>
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
          <div className="sm-alert-actions">
            <button type="submit" className="btn btn-primary">Review details</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
