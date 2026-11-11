import { useEffect, useMemo, useState } from 'react'
import { CORRECTION_REASONS, sourceLabel } from '../../constants/attendanceLabels'
import {
  mockGetAttendanceRecord,
  mockSaveAttendanceCorrection,
  previewCorrectionTimes,
  validateCorrection,
} from '../../services/attendanceRecordsService'
import { accraTodayKey, formatAccraDate, formatAccraTime, TIMEZONE } from '../../utils/accraTime'
import { StatusBadge } from './AttendanceBadges'
import { clockText } from './format'

function FieldError({ message }) {
  if (!message) return null
  return (
    <span className="sh-form-error" role="alert">
      {message}
    </span>
  )
}

/** "HH:MM" in Accra for an ISO timestamp (form prefill). */
function toTimeInput(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIMEZONE,
  })
}

/**
 * HR action: correct an attendance record or create one manually. Two steps:
 * the form, then a confirmation showing the previous and new values. Saving
 * appends to the record's correction history; nothing is overwritten silently.
 */
/** Warehouse Workers: their scanned breaks, editable (others have no break fields). */
function breakFields(record) {
  if (record?.category !== 'warehouse') return {}
  return { breaks: (record.breaks ?? []).map((b) => ({ startTime: toTimeInput(b.start), endTime: toTimeInput(b.end) })) }
}

export default function CorrectionModal({ roster, initial, user, onClose, onSaved }) {
  const fixedRecord = Boolean(initial?.employeeId && initial?.date)
  const [form, setForm] = useState(() => {
    const record = fixedRecord ? mockGetAttendanceRecord(initial.employeeId, initial.date) : null
    return {
      employeeId: initial?.employeeId ?? '',
      date: initial?.date ?? accraTodayKey(),
      clockInTime: toTimeInput(record?.clockIn),
      clockOutTime: toTimeInput(record?.clockOut),
      ...breakFields(record),
      reason: '',
      remarks: '',
    }
  })
  const [showErrors, setShowErrors] = useState(false)
  const [step, setStep] = useState('form')
  const [saveErrors, setSaveErrors] = useState({})

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const record = useMemo(
    () => mockGetAttendanceRecord(form.employeeId, form.date),
    [form.employeeId, form.date],
  )
  const validation = validateCorrection(form, record)
  const errors = showErrors ? { ...validation, ...saveErrors } : saveErrors
  const isCorrection = Boolean(record?.hasAttendance)

  const update = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
    setSaveErrors({})
  }

  const selectEmployeeOrDate = (field, value) => {
    setForm((f) => {
      const next = { ...f, [field]: value }
      const rec = mockGetAttendanceRecord(next.employeeId, next.date)
      next.clockInTime = toTimeInput(rec?.clockIn)
      next.clockOutTime = toTimeInput(rec?.clockOut)
      Object.assign(next, breakFields(rec))
      delete next.breaks
      if (rec?.category === 'warehouse') next.breaks = breakFields(rec).breaks
      return next
    })
    setSaveErrors({})
  }

  const handleReview = (event) => {
    event.preventDefault()
    setShowErrors(true)
    if (Object.keys(validation).length > 0) return
    setStep('confirm')
  }

  const handleConfirm = () => {
    const result = mockSaveAttendanceCorrection(form, user)
    if (result.errors) {
      setSaveErrors(result.errors)
      setStep('form')
      return
    }
    onSaved(result.record)
  }

  const preview =
    step === 'confirm' ? previewCorrectionTimes(form, record) : { clockIn: null, clockOut: null }
  const inputClass = (field) => `sh-form-input${errors[field] ? ' has-error' : ''}`
  const title = isCorrection ? 'Correct attendance record' : 'Record attendance manually'

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
        aria-labelledby="correction-title"
        style={{ maxWidth: 640 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3 id="correction-title">{step === 'confirm' ? 'Confirm the change' : title}</h3>
            <p>Recorded as {user.name} ({user.role}) · Africa/Accra time</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {step === 'form' ? (
          <form className="sm-modal-body" onSubmit={handleReview} noValidate>
            <div className="sh-form-grid">
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="cor-employee">Employee</label>
                <select
                  id="cor-employee"
                  className={`sh-form-select${errors.employeeId ? ' has-error' : ''}`}
                  value={form.employeeId}
                  disabled={fixedRecord}
                  onChange={(e) => selectEmployeeOrDate('employeeId', e.target.value)}
                >
                  <option value="">Choose an employee…</option>
                  {roster.map((emp) => (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {emp.fullName} ({emp.employeeId})
                    </option>
                  ))}
                </select>
                <FieldError message={errors.employeeId} />
              </div>

              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="cor-date">Attendance date</label>
                <input
                  id="cor-date"
                  type="date"
                  className={inputClass('date')}
                  value={form.date}
                  max={accraTodayKey()}
                  disabled={fixedRecord}
                  onChange={(e) => selectEmployeeOrDate('date', e.target.value)}
                />
                <FieldError message={errors.date} />
              </div>

              {record && (
                <div className="sh-form-field is-full">
                  <div className="at-current">
                    <span className="sm-event-field-label">Current record</span>
                    <span>
                      <StatusBadge status={record.status} /> In{' '}
                      {clockText(record.clockIn, record.clockInUnknown)} · Out{' '}
                      {clockText(record.clockOut, record.clockOutUnknown)} ·{' '}
                      {sourceLabel(record.source)}
                    </span>
                    {isCorrection && !fixedRecord && (
                      <span className="at-sub">
                        A record already exists for this date, so it will be corrected rather than
                        duplicated. The previous values stay in the correction history.
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="cor-in">Corrected clock-in time</label>
                <input
                  id="cor-in"
                  type="time"
                  className={inputClass('clockInTime')}
                  value={form.clockInTime}
                  onChange={(e) => update('clockInTime', e.target.value)}
                />
                <FieldError message={errors.clockInTime} />
              </div>

              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="cor-out">
                  Corrected clock-out time <span className="at-sub">(if available)</span>
                </label>
                <input
                  id="cor-out"
                  type="time"
                  className={inputClass('clockOutTime')}
                  value={form.clockOutTime}
                  onChange={(e) => update('clockOutTime', e.target.value)}
                />
                <FieldError message={errors.clockOutTime} />
              </div>

              {Array.isArray(form.breaks) && (
                <fieldset className="sh-form-field is-full at-breaks">
                  <legend className="sh-form-label">Breaks (Warehouse Worker)</legend>
                  <p className="at-sub" style={{ margin: 0 }}>Break time is not working time. Leave a return time empty only if it is genuinely unknown — the day then stays on hold for review.</p>
                  {form.breaks.map((b, i) => (
                    <div className="at-break-row" key={i}>
                      <label className="sh-form-label">Break {form.breaks.length > 1 ? i + 1 : ''} departure
                        <input type="time" className="sh-form-input" value={b.startTime} onChange={(e) => update('breaks', form.breaks.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
                      </label>
                      <label className="sh-form-label">Return
                        <input type="time" className="sh-form-input" value={b.endTime} onChange={(e) => update('breaks', form.breaks.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                      </label>
                      <button type="button" className="sm-actions-btn" onClick={() => update('breaks', form.breaks.filter((_, j) => j !== i))} aria-label={`Remove break ${i + 1}`}>Remove</button>
                    </div>
                  ))}
                  {form.breaks.length < 3 && (
                    <button type="button" className="sm-actions-btn" style={{ alignSelf: 'flex-start' }} onClick={() => update('breaks', [...form.breaks, { startTime: '', endTime: '' }])}>+ Add break</button>
                  )}
                  <FieldError message={errors.breaks} />
                </fieldset>
              )}

              <div className="sh-form-field is-full">
                <label className="sh-form-label" htmlFor="cor-reason">Reason for correction</label>
                <select
                  id="cor-reason"
                  className={`sh-form-select${errors.reason ? ' has-error' : ''}`}
                  value={form.reason}
                  onChange={(e) => update('reason', e.target.value)}
                >
                  <option value="">Choose a reason…</option>
                  {CORRECTION_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <FieldError message={errors.reason} />
              </div>

              <div className="sh-form-field is-full">
                <label className="sh-form-label" htmlFor="cor-remarks">Supporting remarks</label>
                <textarea
                  id="cor-remarks"
                  className={inputClass('remarks')}
                  rows={3}
                  value={form.remarks}
                  placeholder="What happened, and what evidence supports this change (e.g. supervisor confirmation)."
                  onChange={(e) => update('remarks', e.target.value)}
                  style={{ resize: 'vertical' }}
                />
                <FieldError message={errors.remarks} />
              </div>
            </div>

            {errors.form && <p className="at-form-alert" role="alert">{errors.form}</p>}

            <p className="sh-form-note" style={{ margin: 0 }}>
              Manual entries are marked as HR corrections. They are never shown as face- or
              GPS-verified.
            </p>

            <div className="sm-alert-actions">
              <button type="submit" className="btn btn-primary">Review change</button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="sm-modal-body">
            <p className="at-confirm-lead">
              {isCorrection ? 'Correct' : 'Create'} the attendance record for{' '}
              <strong>{record?.fullName}</strong> on{' '}
              <strong>{formatAccraDate(form.date)}</strong>?
            </p>
            <div className="sm-table-wrap">
              <table className="sm-table at-confirm-table">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Previous value</th>
                    <th scope="col">New value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Clock-in</th>
                    <td>{clockText(record?.clockIn, record?.clockInUnknown)}</td>
                    <td><strong>{formatAccraTime(preview.clockIn)}</strong></td>
                  </tr>
                  <tr>
                    <th scope="row">Clock-out</th>
                    <td>{clockText(record?.clockOut, record?.clockOutUnknown)}</td>
                    <td><strong>{preview.clockOut ? formatAccraTime(preview.clockOut) : 'Not recorded'}</strong></td>
                  </tr>
                  {Array.isArray(form.breaks) && (
                    <tr>
                      <th scope="row">Breaks</th>
                      <td>{(record?.breaks ?? []).length ? record.breaks.map((b) => `${formatAccraTime(b.start)}–${b.end ? formatAccraTime(b.end) : 'not scanned'}`).join(', ') : 'None'}</td>
                      <td><strong>{form.breaks.length ? form.breaks.map((b) => `${b.startTime}–${b.endTime || 'not known'}`).join(', ') : 'None'}</strong></td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">Reason</th>
                    <td colSpan="2">{form.reason}</td>
                  </tr>
                  <tr>
                    <th scope="row">Remarks</th>
                    <td colSpan="2">{form.remarks.trim()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="sh-form-note" style={{ margin: 0 }}>
              The previous values are kept in the correction history together with your name and
              the time of this change.
            </p>
            <div className="sm-alert-actions">
              <button type="button" className="btn btn-primary" onClick={handleConfirm}>
                Confirm and save
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setStep('form')}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
