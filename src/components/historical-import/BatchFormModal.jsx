import { useEffect, useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import { canViewCompany } from '../../constants/hrUser'
import {
  mockCreateBatch,
  mockUpdateBatchDetails,
  periodsForRange,
  validateBatch,
} from '../../services/historicalImportService'
import { DIGITAL_GO_LIVE_DATE } from '../../utils/attendanceRules'
import { addDaysToKey, formatAccraDate } from '../../utils/accraTime'
import AttachmentPreview from './AttachmentPreview'
import { prepareAttachment } from './attachmentStore'

function FieldError({ message }) {
  if (!message) return null
  return <span className="sh-form-error" role="alert">{message}</span>
}

function periodText(p) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }
  return `${p.label}: ${p.start.toLocaleDateString([], opts)} – ${p.end.toLocaleDateString([], opts)}`
}

/** Step 1 — create a batch, or edit a draft batch's details. */
export default function BatchFormModal({ batch, user, defaultCompanyId, onClose, onSaved }) {
  const isEdit = Boolean(batch)
  const companies = COMPANIES.filter((c) => canViewCompany(user, c.id))
  const [data, setData] = useState(() =>
    isEdit
      ? {
          name: batch.name,
          companyId: batch.companyId,
          startDate: batch.startDate,
          endDate: batch.endDate,
          sourceDescription: batch.sourceDescription,
          notebookReference: batch.notebookReference,
          attachment: batch.attachment,
        }
      : {
          name: '',
          companyId: canViewCompany(user, defaultCompanyId) ? defaultCompanyId : companies[0]?.id ?? '',
          startDate: '',
          endDate: '',
          sourceDescription: '',
          notebookReference: '',
          attachment: null,
        },
  )
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const validation = validateBatch(data, user)
  const errors = showErrors ? { ...validation, ...serverErrors } : serverErrors
  const periods = periodsForRange(data.startDate, data.endDate)
  const lastAllowed = addDaysToKey(DIGITAL_GO_LIVE_DATE, -1)

  const update = (field, value) => {
    setData((d) => ({ ...d, [field]: value }))
    setServerErrors({})
  }

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setReading(true)
    const result = await prepareAttachment(file)
    setReading(false)
    if (result.error) {
      setFileError(result.error)
      return
    }
    setFileError('')
    update('attachment', result.attachment)
  }

  const submit = (event) => {
    event.preventDefault()
    setShowErrors(true)
    if (Object.keys(validation).length) return
    const result = isEdit ? mockUpdateBatchDetails(batch.batchId, data, user) : mockCreateBatch(data, user)
    if (result.errors) {
      setServerErrors(result.errors)
      return
    }
    onSaved(result.batch)
  }

  const inputClass = (f) => `sh-form-input${errors[f] ? ' has-error' : ''}`

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-labelledby="batch-form-title" style={{ maxWidth: 720 }}>
        <div className="sm-modal-head">
          <div>
            <h3 id="batch-form-title">{isEdit ? 'Edit batch details' : 'New historical import batch'}</h3>
            <p>Step 1 of 4 · Source and period</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <form className="sm-modal-body" onSubmit={submit} noValidate>
          <div className="sh-form-grid">
            <div className="sh-form-field is-full">
              <label className="sh-form-label" htmlFor="hb-name">Batch name</label>
              <input id="hb-name" className={inputClass('name')} value={data.name} placeholder="e.g. Osu shop notebook — September 2026" onChange={(e) => update('name', e.target.value)} />
              <FieldError message={errors.name} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hb-company">Company</label>
              <select id="hb-company" className={`sh-form-select${errors.companyId ? ' has-error' : ''}`} value={data.companyId} onChange={(e) => update('companyId', e.target.value)}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <FieldError message={errors.companyId} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hb-ref">Original notebook / page reference</label>
              <input id="hb-ref" className={inputClass('notebookReference')} value={data.notebookReference} placeholder="e.g. Notebook 3, pages 12–18" onChange={(e) => update('notebookReference', e.target.value)} />
              <FieldError message={errors.notebookReference} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hb-start">Start date</label>
              <input id="hb-start" type="date" className={inputClass('startDate')} value={data.startDate} max={lastAllowed} onChange={(e) => update('startDate', e.target.value)} />
              <FieldError message={errors.startDate} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hb-end">End date</label>
              <input id="hb-end" type="date" className={inputClass('endDate')} value={data.endDate} min={data.startDate || undefined} max={lastAllowed} onChange={(e) => update('endDate', e.target.value)} />
              <FieldError message={errors.endDate} />
            </div>
            {periods.length > 0 && (
              <div className="sh-form-field is-full">
                <div className="hi-periods">
                  <span className="sm-detail-label">Attendance period{periods.length > 1 ? 's' : ''} (26th–25th, Africa/Accra)</span>
                  {periods.map((p) => <span key={p.key}>{periodText(p)}</span>)}
                </div>
              </div>
            )}
            <div className="sh-form-field is-full">
              <label className="sh-form-label" htmlFor="hb-source">Source description</label>
              <textarea id="hb-source" rows={2} className={inputClass('sourceDescription')} value={data.sourceDescription} placeholder="Which notebook, who kept it and where it was stored." onChange={(e) => update('sourceDescription', e.target.value)} style={{ resize: 'vertical' }} />
              <FieldError message={errors.sourceDescription} />
            </div>
            <div className="sh-form-field is-full">
              <label className="sh-form-label" htmlFor="hb-file">Notebook photograph or scanned document</label>
              <input id="hb-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={onFile} className="hi-file" />
              <span className="at-sub">JPG, PNG, WEBP, HEIC or PDF up to 10 MB. Kept in this browser only; nothing is uploaded and no text is read from the image.</span>
              {reading && <span className="at-sub">Reading file…</span>}
              <FieldError message={fileError || errors.attachment} />
              {data.attachment && <AttachmentPreview attachment={data.attachment} height={220} />}
            </div>
          </div>
          {errors.form && <p className="at-form-alert" role="alert">{errors.form}</p>}
          <p className="sh-form-note" style={{ margin: 0 }}>
            Historical imports cover dates before digital attendance started on {formatAccraDate(DIGITAL_GO_LIVE_DATE)}.
          </p>
          <div className="sm-alert-actions">
            <button type="submit" className="btn btn-primary" disabled={reading}>{isEdit ? 'Save details' : 'Create batch'}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
