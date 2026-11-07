import { validateJobPosition } from '../../utils/registrationValidation'

/**
 * Screen 5 — Job position.
 * The employee types their own position and presses Enter (or Continue).
 * There is deliberately no dropdown list — each employee enters the exact
 * title they were hired for. Privileged roles (administrator, HR,
 * supervisor, etc.) cannot be self-assigned.
 */
export default function JobPosition({ data, onChange, showErrors, onSubmit }) {
  const error = validateJobPosition(data)
  const showError = Boolean(error) && showErrors

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!error && onSubmit) onSubmit()
    }
  }

  return (
    <section className="card">
      <p className="step-eyebrow">Step 3 of 4</p>
      <h2 className="step-title">Job position</h2>
      <p className="step-description">
        Type the job position you were hired for, then press Enter. Department
        and branch assignment will be completed by HR after registration.
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="field-position">
          Job position
        </label>
        <input
          id="field-position"
          className={`form-input ${showError ? 'has-error' : ''}`}
          type="text"
          value={data.position}
          placeholder="e.g. Warehouse Worker"
          autoComplete="off"
          aria-invalid={showError}
          aria-describedby={showError ? 'error-position' : undefined}
          onChange={(e) => onChange('position', e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {showError && (
          <span className="field-error" id="error-position" role="alert">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {error}
          </span>
        )}
      </div>

      <p className="role-note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>
          Administrator, HR and supervisor access cannot be self-assigned.
          Elevated access is granted separately by your company&apos;s
          administration.
        </span>
      </p>
    </section>
  )
}
