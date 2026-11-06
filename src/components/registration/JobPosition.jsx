import { useMemo, useState } from 'react'
import {
  POSITIONS,
  validateJobPosition,
} from '../../utils/registrationValidation'

/**
 * Screen 5 — Job position.
 * The employee types their own position; common titles are offered as
 * autocomplete suggestions. Privileged roles (administrator, HR,
 * supervisor, etc.) cannot be self-assigned.
 */
export default function JobPosition({ data, onChange, showErrors }) {
  const [focused, setFocused] = useState(false)

  const suggestions = useMemo(() => {
    const term = data.position.trim().toLowerCase()
    if (!term) return POSITIONS
    return POSITIONS.filter((position) =>
      position.toLowerCase().includes(term),
    )
  }, [data.position])

  const error = validateJobPosition(data)
  const showError = Boolean(error) && showErrors
  const showSuggestions =
    focused && suggestions.length > 0 && !suggestions.includes(data.position.trim())

  const handleSelect = (position) => {
    onChange('position', position)
    setFocused(false)
  }

  // Keep the suggestion list open while focus stays anywhere inside the
  // typeahead (input or a suggestion button); close it when focus leaves.
  const handleBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocused(false)
    }
  }

  return (
    <section className="card">
      <p className="step-eyebrow">Step 4 of 5</p>
      <h2 className="step-title">Job position</h2>
      <p className="step-description">
        Type the job position you were hired for. Department and branch
        assignment will be completed by HR after registration.
      </p>

      <div
        className="form-field position-typeahead"
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
      >
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
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls="position-suggestions"
          aria-autocomplete="list"
          aria-invalid={showError}
          aria-describedby={showError ? 'error-position' : undefined}
          onChange={(e) => onChange('position', e.target.value)}
        />

        {showSuggestions && (
          <ul
            className="position-suggestions"
            id="position-suggestions"
            role="listbox"
            aria-label="Suggested positions"
          >
            {suggestions.map((position) => (
              <li key={position}>
                <button
                  type="button"
                  role="option"
                  aria-selected={data.position.trim() === position}
                  className="position-suggestion"
                  onClick={() => handleSelect(position)}
                >
                  {position}
                </button>
              </li>
            ))}
          </ul>
        )}

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
