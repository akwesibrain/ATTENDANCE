import { useState } from 'react'
import { NOTEBOOK_STATUS } from '../../constants/historicalImportLabels'
import { newRecord, validateRecord } from '../../services/historicalImportService'

function FieldError({ message }) {
  if (!message) return null
  return <span className="sh-form-error" role="alert">{message}</span>
}

const IDENTITY_FIELDS = ['rawName', 'rawEmployeeId', 'rawPhone']

/**
 * Step 2 — type one notebook line exactly as written. Nothing is filled in
 * automatically: an empty time stays empty and is stored as Unknown.
 * In add mode, the date and page reference carry over to the next entry.
 */
export default function RecordForm({ batch, record, onSave, onCancel }) {
  const isEdit = Boolean(record)
  const [data, setData] = useState(() => record ?? newRecord({ date: batch.startDate }))
  const [showErrors, setShowErrors] = useState(false)
  const errors = showErrors ? validateRecord(data, batch) : {}
  const present = data.recordedStatus === 'present'

  const update = (field, value) => setData((d) => {
    const next = { ...d, [field]: value }
    if (field === 'recordedStatus' && value !== 'present') {
      Object.assign(next, { arrivalTime: '', departureTime: '', arrivalUnreadable: false, departureUnreadable: false })
    }
    if (field === 'arrivalUnreadable' && value) next.arrivalTime = ''
    if (field === 'departureUnreadable' && value) next.departureTime = ''
    // Changing who the line refers to clears any earlier employee match.
    if (IDENTITY_FIELDS.includes(field) && d.match && d.match.method !== 'manual') next.match = null
    return next
  })

  const submit = (event) => {
    event.preventDefault()
    setShowErrors(true)
    if (Object.keys(validateRecord(data, batch)).length) return
    const identityChanged = isEdit && IDENTITY_FIELDS.some((f) => record[f] !== data[f])
    onSave({ ...data, rawName: data.rawName.trim(), rawEmployeeId: data.rawEmployeeId.trim(), rawPhone: data.rawPhone.trim(), remarks: data.remarks.trim() }, { identityChanged })
    if (!isEdit) {
      setData(newRecord({ date: data.date, pageReference: data.pageReference, recordedStatus: 'present' }))
      setShowErrors(false)
    }
  }

  const cls = (f) => `sh-form-input${errors[f] ? ' has-error' : ''}`

  return (
    <form className="hi-record-form" onSubmit={submit} noValidate aria-label={isEdit ? 'Edit notebook record' : 'Add notebook record'}>
      <div className="hi-form-grid">
        <div className="sh-form-field hi-span-2">
          <label className="sh-form-label" htmlFor="hr-name">Employee name (as written)</label>
          <input id="hr-name" className={cls('rawName')} value={data.rawName} onChange={(e) => update('rawName', e.target.value)} autoComplete="off" />
          <FieldError message={errors.rawName} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-id">Employee ID <span className="at-sub">(if known)</span></label>
          <input id="hr-id" className={cls('rawEmployeeId')} value={data.rawEmployeeId} onChange={(e) => update('rawEmployeeId', e.target.value)} autoComplete="off" />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-phone">Phone <span className="at-sub">(if available)</span></label>
          <input id="hr-phone" className={cls('rawPhone')} value={data.rawPhone} inputMode="tel" onChange={(e) => update('rawPhone', e.target.value)} autoComplete="off" />
          <FieldError message={errors.rawPhone} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-date">Attendance date</label>
          <input id="hr-date" type="date" className={cls('date')} value={data.date} min={batch.startDate} max={batch.endDate} onChange={(e) => update('date', e.target.value)} />
          <FieldError message={errors.date} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-status">Notebook status</label>
          <select id="hr-status" className={`sh-form-select${errors.recordedStatus ? ' has-error' : ''}`} value={data.recordedStatus} onChange={(e) => update('recordedStatus', e.target.value)}>
            {Object.entries(NOTEBOOK_STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <FieldError message={errors.recordedStatus} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-in">Arrival time</label>
          <input id="hr-in" type="time" className={cls('arrivalTime')} value={data.arrivalTime} disabled={!present || data.arrivalUnreadable} onChange={(e) => update('arrivalTime', e.target.value)} />
          <label className="at-check hi-small-check">
            <input type="checkbox" checked={data.arrivalUnreadable} disabled={!present} onChange={(e) => update('arrivalUnreadable', e.target.checked)} />
            Unreadable
          </label>
          <FieldError message={errors.arrivalTime} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-out">Departure time <span className="at-sub">(if available)</span></label>
          <input id="hr-out" type="time" className={cls('departureTime')} value={data.departureTime} disabled={!present || data.departureUnreadable} onChange={(e) => update('departureTime', e.target.value)} />
          <label className="at-check hi-small-check">
            <input type="checkbox" checked={data.departureUnreadable} disabled={!present} onChange={(e) => update('departureUnreadable', e.target.checked)} />
            Unreadable
          </label>
          <FieldError message={errors.departureTime} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-in-raw">Arrival as written <span className="at-sub">(optional)</span></label>
          <input id="hr-in-raw" className="sh-form-input" value={data.arrivalAsWritten} placeholder='e.g. "8.15am"' disabled={!present} onChange={(e) => update('arrivalAsWritten', e.target.value)} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-out-raw">Departure as written <span className="at-sub">(optional)</span></label>
          <input id="hr-out-raw" className="sh-form-input" value={data.departureAsWritten} disabled={!present} onChange={(e) => update('departureAsWritten', e.target.value)} />
        </div>
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="hr-page">Source page</label>
          <input id="hr-page" className="sh-form-input" value={data.pageReference} placeholder="e.g. p. 14" onChange={(e) => update('pageReference', e.target.value)} />
        </div>
        <div className="sh-form-field hi-span-3">
          <label className="sh-form-label" htmlFor="hr-remarks">Original notebook remarks</label>
          <input id="hr-remarks" className="sh-form-input" value={data.remarks} onChange={(e) => update('remarks', e.target.value)} />
        </div>
      </div>
      <div className="hi-form-foot">
        <span className="at-sub">
          Leave a time empty if the notebook does not show it; it is stored as Unknown. Nothing is filled in for you.
        </span>
        <div className="sm-alert-actions">
          <button type="submit" className="btn btn-primary at-btn">{isEdit ? 'Save record' : 'Add record'}</button>
          {onCancel && <button type="button" className="btn btn-secondary at-btn" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </form>
  )
}
