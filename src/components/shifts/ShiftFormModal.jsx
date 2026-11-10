import { useEffect, useState } from 'react'
import {
  expectedWorkingHours,
  isOvernight,
  mockCreateShift,
  mockUpdateShift,
  validateShift,
} from '../../services/shiftsService'
import { attendanceRulesFor, defaultHoursFor } from '../../services/settingsService'

/** New shifts start from the company's default working hours (Settings). */
function defaultsFor(companyId) {
  const h = defaultHoursFor(companyId)
  const breakEnd = h.breakMinutes > 0
    ? (() => { const [hh, mm] = h.breakStart.split(':').map(Number); const m = hh * 60 + mm + h.breakMinutes; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })()
    : ''
  return {
    ...EMPTY_SHIFT,
    startTime: h.startTime,
    endTime: h.endTime,
    workingDays: h.workingDays.slice(),
    breakStart: h.breakMinutes > 0 ? h.breakStart : '',
    breakEnd,
    graceMinutes: Math.min(attendanceRulesFor().graceMinutes, 120),
  }
}

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

const EMPTY_SHIFT = {
  name: '',
  code: '',
  startTime: '08:00',
  endTime: '17:00',
  workingDays: [1, 2, 3, 4, 5],
  breakStart: '12:30',
  breakEnd: '13:00',
  graceMinutes: 10,
  expectedHours: 8.5,
  status: 'active',
  description: '',
}

function FieldError({ message }) {
  if (!message) return null
  return (
    <span className="sh-form-error" role="alert">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {message}
    </span>
  )
}

/**
 * HR action: create a new shift or edit an existing one. The company is fixed
 * to the company currently selected in the dashboard.
 */
export default function ShiftFormModal({ shift, company, onClose, onSaved }) {
  const isEdit = Boolean(shift)
  const [data, setData] = useState(() =>
    isEdit
      ? { ...EMPTY_SHIFT, ...shift, description: shift.description ?? '' }
      : { ...defaultsFor(company.id), companyId: company.id },
  )
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState({})

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const errors = showErrors ? { ...validateShift(data), ...serverErrors } : {}
  const timesValid = !validateShift(data).startTime && !validateShift(data).endTime
  const overnight = timesValid && isOvernight(data)
  const calculatedHours = timesValid ? expectedWorkingHours(data) : null

  const update = (field, value) => {
    setData((d) => ({ ...d, [field]: value }))
    setServerErrors((e) => {
      if (!e[field]) return e
      const next = { ...e }
      delete next[field]
      return next
    })
  }

  const toggleDay = (day) => {
    update(
      'workingDays',
      data.workingDays.includes(day)
        ? data.workingDays.filter((d) => d !== day)
        : [...data.workingDays, day],
    )
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setShowErrors(true)
    if (Object.keys(validateShift(data)).length > 0) return
    const payload = {
      ...data,
      description: data.description.trim(),
      workingDays: data.workingDays.slice().sort((a, b) => a - b),
    }
    const result = isEdit
      ? mockUpdateShift(shift.shiftId, payload)
      : mockCreateShift(payload)
    if (result.errors) {
      setServerErrors(result.errors)
      return
    }
    onSaved(result.shift)
    onClose()
  }

  const inputClass = (field) => `sh-form-input${errors[field] ? ' has-error' : ''}`

  return (
    <div
      className="sm-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-form-title"
        style={{ maxWidth: 640 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3 id="shift-form-title">{isEdit ? 'Edit shift' : 'New shift'}</h3>
            <p>{company.name}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form className="sm-modal-body" onSubmit={handleSubmit} noValidate>
          <div className="sh-form-grid">
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-name">Shift name</label>
              <input
                id="shift-name"
                className={inputClass('name')}
                value={data.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Evening Shift"
                autoFocus
              />
              <FieldError message={errors.name} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-code">Shift code</label>
              <input
                id="shift-code"
                className={inputClass('code')}
                value={data.code}
                onChange={(e) => update('code', e.target.value.toUpperCase())}
                placeholder="e.g. EVE"
                maxLength={8}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <FieldError message={errors.code} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-start">Start time</label>
              <input
                id="shift-start"
                type="time"
                className={inputClass('startTime')}
                value={data.startTime}
                onChange={(e) => update('startTime', e.target.value)}
              />
              <FieldError message={errors.startTime} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-end">
                End time {overnight && <span className="sh-overnight">Overnight</span>}
              </label>
              <input
                id="shift-end"
                type="time"
                className={inputClass('endTime')}
                value={data.endTime}
                onChange={(e) => update('endTime', e.target.value)}
              />
              <FieldError message={errors.endTime} />
            </div>

            <div className="sh-form-field is-full">
              <span className="sh-form-label" id="shift-days-label">Working days</span>
              <div className="sh-days" role="group" aria-labelledby="shift-days-label">
                {DAYS.map((day) => {
                  const selected = data.workingDays.includes(day.value)
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={`sh-day${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
              <FieldError message={errors.workingDays} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-break-start">Break start</label>
              <input
                id="shift-break-start"
                type="time"
                className={inputClass('breakStart')}
                value={data.breakStart}
                onChange={(e) => update('breakStart', e.target.value)}
              />
              <FieldError message={errors.breakStart} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-break-end">Break end</label>
              <input
                id="shift-break-end"
                type="time"
                className={inputClass('breakEnd')}
                value={data.breakEnd}
                onChange={(e) => update('breakEnd', e.target.value)}
              />
              <FieldError message={errors.breakEnd} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-grace">Grace period (minutes)</label>
              <input
                id="shift-grace"
                type="number"
                min="0"
                max="120"
                className={inputClass('graceMinutes')}
                value={data.graceMinutes}
                onChange={(e) => update('graceMinutes', e.target.value)}
              />
              <FieldError message={errors.graceMinutes} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-hours">Expected hours</label>
              <input
                id="shift-hours"
                type="number"
                min="0.5"
                max="24"
                step="0.5"
                className={inputClass('expectedHours')}
                value={data.expectedHours}
                onChange={(e) => update('expectedHours', e.target.value)}
              />
              {calculatedHours !== null && Number(data.expectedHours) !== calculatedHours && (
                <button
                  type="button"
                  className="emp-card-assign-link"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => update('expectedHours', calculatedHours)}
                >
                  Use {calculatedHours} h from the times above
                </button>
              )}
              <FieldError message={errors.expectedHours} />
            </div>

            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="shift-status">Status</label>
              <select
                id="shift-status"
                className="sh-form-select"
                value={data.status}
                onChange={(e) => update('status', e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="sh-form-field is-full">
              <label className="sh-form-label" htmlFor="shift-desc">Description (optional)</label>
              <textarea
                id="shift-desc"
                className="sh-form-input"
                rows={2}
                value={data.description}
                onChange={(e) => update('description', e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          <p className="sh-form-note" style={{ margin: 0 }}>
            For Sales Representatives and Merchandisers, the start and end times set
            the window for the three verification checks. The check times are
            chosen by the backend and are never shown here.
          </p>

          <div className="sm-alert-actions">
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save changes' : 'Create shift'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
