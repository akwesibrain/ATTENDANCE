import { useEffect, useState } from 'react'
import { getSessionUser } from '../../services/permissionsService'
import { employeeJoinedOn, mockUpdateEmployeeDetails, validateEmployeeDetails } from '../../services/registrationService'
import { accraTodayKey } from '../../utils/accraTime'
import { formatTenure, tenureBetween } from '../../utils/tenure'

/**
 * HR edits the date an employee joined the company and their emergency
 * contact. Time with the company is calculated from the joining date.
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

  const save = (e) => {
    e.preventDefault()
    setTouched(true)
    const result = mockUpdateEmployeeDetails(employee.staffId, form, getSessionUser())
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
          <div className="sm-alert-actions">
            <button type="submit" className="btn btn-primary">Save details</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
