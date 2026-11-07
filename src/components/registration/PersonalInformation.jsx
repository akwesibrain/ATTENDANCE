import { useState } from 'react'
import { validatePersonalInformation } from '../../utils/registrationValidation'

const FIELDS = [
  { name: 'firstName', label: 'First name', required: true, autoComplete: 'given-name', placeholder: 'e.g. John' },
  { name: 'lastName', label: 'Last name', required: true, autoComplete: 'family-name', placeholder: 'e.g. Mensah' },
  { name: 'middleName', label: 'Middle name', required: false, autoComplete: 'additional-name', placeholder: 'Optional' },
  { name: 'phone', label: 'Phone number', required: true, autoComplete: 'tel', inputMode: 'tel', placeholder: 'e.g. +233 24 123 4567' },
  { name: 'email', label: 'Email address', required: false, autoComplete: 'email', inputMode: 'email', placeholder: 'e.g. john@example.com' },
  { name: 'address', label: 'Residential address', required: false, autoComplete: 'street-address', placeholder: 'Optional', full: true },
  { name: 'emergencyContactName', label: 'Emergency contact name', required: false, placeholder: 'Optional', section: 'Emergency contact (optional)' },
  { name: 'emergencyContactPhone', label: 'Emergency contact phone', required: false, inputMode: 'tel', placeholder: 'Optional' },
]

/**
 * Screen 3 — Personal information form with inline validation.
 */
export default function PersonalInformation({ data, onChange, showErrors }) {
  const [touched, setTouched] = useState({})
  const errors = validatePersonalInformation(data)

  const handleBlur = (name) =>
    setTouched((prev) => ({ ...prev, [name]: true }))

  return (
    <section className="card">
      <p className="step-eyebrow">Step 1 of 4</p>
      <h2 className="step-title">Personal information</h2>
      <p className="step-description">
        Tell us who you are. Fields marked optional can be completed later by
        HR if you prefer.
      </p>

      <div className="form-grid">
        {FIELDS.map((field) => {
          const error = errors[field.name]
          const showError = Boolean(error) && (touched[field.name] || showErrors)
          return (
            <div key={field.name} style={{ display: 'contents' }}>
              {field.section && (
                <h3 className="form-section-title">{field.section}</h3>
              )}
              <div className={`form-field ${field.full ? 'is-full' : ''}`}>
                <label className="form-label" htmlFor={`field-${field.name}`}>
                  {field.label}
                  {!field.required && (
                    <span className="optional-tag">Optional</span>
                  )}
                </label>
                <input
                  id={`field-${field.name}`}
                  className={`form-input ${showError ? 'has-error' : ''}`}
                  type="text"
                  value={data[field.name]}
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  inputMode={field.inputMode}
                  aria-invalid={showError}
                  aria-describedby={
                    showError ? `error-${field.name}` : undefined
                  }
                  onChange={(e) => onChange(field.name, e.target.value)}
                  onBlur={() => handleBlur(field.name)}
                />
                {showError && (
                  <span className="field-error" id={`error-${field.name}`} role="alert">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    {error}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
