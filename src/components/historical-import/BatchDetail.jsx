import { useEffect, useMemo, useState } from 'react'
import {
  NOTEBOOK_STATUS,
  RECORD_STATUS,
} from '../../constants/historicalImportLabels'
import { canImportHistorical, canReviewHistorical } from '../../constants/hrUser'
import {
  assessRecords,
  autoMatch,
  buildAssessmentContext,
  mockApproveAllEligible,
  mockClearDecision,
  mockCompleteReview,
  mockDecideRecord,
  mockGetBatch,
  mockRejectBatch,
  mockReturnBatch,
  mockSaveDraft,
  mockSubmitBatch,
  periodRangeLabel,
} from '../../services/historicalImportService'
import { FINALISED_STATUSES } from '../../services/historicalImportStore'
import { formatAccraDate, formatAccraDateTime } from '../../utils/accraTime'
import AttachmentPreview from './AttachmentPreview'
import BatchFormModal from './BatchFormModal'
import RecordDrawer from './RecordDrawer'
import RecordForm from './RecordForm'
import { BatchStatusBadge, FlagList, RecordStatusBadge } from './ImportBadges'

function timeCell(time, unreadable, status) {
  if (status !== 'present') return <span className="at-none">—</span>
  if (unreadable) return <span className="hi-unknown">Unknown (unreadable)</span>
  if (!time) return <span className="hi-unknown">Unknown</span>
  return time
}

/** In-page confirmation with an optional required reason. */
function Confirm({ title, lead, needReason, reasonLabel, confirmLabel, danger, onConfirm, onCancel, error }) {
  const [reason, setReason] = useState('')
  return (
    <div className="sm-modal-overlay" role="presentation">
      <div className="nt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="hi-confirm-title" style={{ marginTop: '10vh' }}>
        <h3 id="hi-confirm-title">{title}</h3>
        <div className="nt-confirm-lead">{lead}</div>
        {needReason && (
          <div className="sh-form-field">
            <label className="sh-form-label" htmlFor="hi-confirm-reason">{reasonLabel}</label>
            <textarea id="hi-confirm-reason" className="sh-form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
        )}
        {error && <p className="at-form-alert" role="alert">{error}</p>}
        <div className="sm-alert-actions">
          <button type="button" className={`btn ${danger ? 'btn-secondary nt-btn-danger' : 'btn-primary'}`} onClick={() => onConfirm(reason)}>{confirmLabel}</button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const TABS = [
  { id: 'details', label: '1. Details & source' },
  { id: 'records', label: '2. Records & matching' },
  { id: 'preview', label: '3. Preview & submit' },
  { id: 'review', label: '4. Review' },
  { id: 'history', label: 'History' },
]

/** Batch details: the four-step import workflow for one batch. */
export default function BatchDetail({ batchId, user, onBack, onChanged, onOpenAttendance }) {
  const [version, setVersion] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batch = useMemo(() => mockGetBatch(batchId, user), [batchId, user, version])
  const editable = Boolean(batch) && ['draft', 'returned'].includes(batch.status) && canImportHistorical(user)
  const isReviewer = Boolean(batch) && batch.status === 'submitted' && canReviewHistorical(user) && batch.submittedBy?.id !== user.id

  const [records, setRecords] = useState(() => batch?.records ?? [])
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState(() => (batch?.status === 'submitted' ? 'review' : 'records'))
  const [editingId, setEditingId] = useState(null)
  const [drawerId, setDrawerId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [confirmError, setConfirmError] = useState('')
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [editingDetails, setEditingDetails] = useState(false)

  // Re-sync the working copy when the stored batch changes and nothing is unsaved.
  useEffect(() => {
    if (batch && !dirty) setRecords(batch.records)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch])

  const shown = useMemo(() => (editable ? records : batch?.records ?? []), [editable, records, batch])
  const ctx = useMemo(
    () => buildAssessmentContext(user, batchId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, batchId, version],
  )
  const assessed = useMemo(() => (batch ? assessRecords(batch, shown, ctx) : new Map()), [batch, shown, ctx])

  if (!batch) {
    return (
      <section className="sm-panel">
        <p className="sm-empty">This batch does not exist or belongs to a company you are not authorised for.</p>
        <div style={{ padding: '0 18px 18px' }}><button type="button" className="hr-link" onClick={onBack}>← Back to imports</button></div>
      </section>
    )
  }

  const refresh = (message) => {
    setVersion((v) => v + 1)
    onChanged?.()
    if (message) setFlash(message)
  }

  const run = (result, message) => {
    if (result.error) { setError(result.error); return false }
    setError('')
    refresh(message)
    return true
  }

  /* ----- working copy edits (draft) ----- */
  const withAutoMatch = (rec) => (rec.match ? rec : { ...rec, match: autoMatch(rec, ctx.roster, batch) })
  const changeRecords = (next) => { setRecords(next); setDirty(true) }
  const addRecord = (rec) => {
    changeRecords([...records, withAutoMatch(rec)])
    setFlash(`Added ${rec.rawName}. Add the next line, or save the draft.`)
  }
  const saveRecord = (rec) => {
    changeRecords(records.map((r) => (r.recordId === rec.recordId ? withAutoMatch(rec) : r)))
    setEditingId(null)
  }
  const setMatch = (recordId, match) => changeRecords(records.map((r) => (r.recordId === recordId ? { ...r, match } : r)))

  const saveDraft = () => {
    const result = mockSaveDraft(batchId, records, user)
    if (run(result, `Draft saved · ${records.length} record${records.length === 1 ? '' : 's'}`)) setDirty(false)
  }

  /* ----- summary over shown records ----- */
  const counts = {}
  shown.forEach((r) => {
    const s = assessed.get(r.recordId)?.status
    counts[s] = (counts[s] ?? 0) + 1
  })
  const withErrors = shown.filter((r) => Object.keys(assessed.get(r.recordId)?.errors ?? {}).length > 0)
  const undecided = batch.records.filter((r) => !r.review).length
  const eligibleCount = batch.records.filter((r) => !r.review && assessed.get(r.recordId)?.eligible).length

  const term = search.trim().toLowerCase()
  const filtered = shown.filter((r) => {
    const a = assessed.get(r.recordId)
    if (statusFilter && a?.status !== statusFilter) return false
    if (term && ![r.rawName, r.rawEmployeeId, r.rawPhone, r.match?.employeeName, r.match?.employeeId].some((v) => (v ?? '').toLowerCase().includes(term))) return false
    return true
  })

  const drawerRecord = drawerId ? shown.find((r) => r.recordId === drawerId) : null
  const editingRecord = editingId ? records.find((r) => r.recordId === editingId) : null
  const finalised = FINALISED_STATUSES.includes(batch.status)

  const openConfirm = (c) => { setConfirm(c); setConfirmError('') }
  const doConfirm = (reason) => {
    let result = {}
    let message = ''
    if (confirm.kind === 'submit') {
      result = mockSubmitBatch(batchId, records, user)
      message = 'Submitted for review. Another authorised reviewer must approve it.'
    } else if (confirm.kind === 'remove') {
      changeRecords(records.filter((r) => r.recordId !== confirm.recordId))
      setConfirm(null)
      return
    } else if (confirm.kind === 'leave') {
      setConfirm(null)
      onBack()
      return
    } else if (confirm.kind === 'reject-batch') {
      result = mockRejectBatch(batchId, reason, user)
      message = 'Batch rejected. Nothing from it appears in Attendance.'
    } else if (confirm.kind === 'return') {
      result = mockReturnBatch(batchId, reason, user)
      message = 'Batch returned to the importer for changes.'
    } else if (confirm.kind === 'complete') {
      result = mockCompleteReview(batchId, user)
      message = 'Review completed. Approved records now appear in Attendance as Historical – Manually Recorded.'
    }
    if (result.error) { setConfirmError(result.error); return }
    setConfirm(null)
    if (confirm.kind === 'submit') { setDirty(false); setTab('review') }
    refresh(message)
  }

  const back = () => (dirty ? openConfirm({ kind: 'leave' }) : onBack())

  return (
    <div className="sm-page hi-detail">
      <div>
        <button type="button" className="hr-link" onClick={back}>← Back to imports</button>
      </div>

      <div className="sm-head">
        <div>
          <div className="nt-drawer-badges">
            <BatchStatusBadge status={batch.status} />
            <span className="nt-category">{batch.companyName}</span>
          </div>
          <h2 style={{ marginTop: 6 }}>{batch.name}</h2>
          <p>
            {formatAccraDate(batch.startDate)} – {formatAccraDate(batch.endDate)} · {periodRangeLabel(batch.startDate, batch.endDate)} · {batch.notebookReference}
          </p>
        </div>
        {editable && (
          <div className="at-head-actions">
            <button type="button" className="btn btn-secondary at-btn" onClick={saveDraft} disabled={!dirty}>
              {dirty ? 'Save draft' : 'Draft saved'}
            </button>
            <button type="button" className="btn btn-primary at-btn" onClick={() => setTab('preview')}>Preview batch</button>
          </div>
        )}
      </div>

      {dirty && <div className="hi-unsaved" role="status">You have unsaved changes. Save the draft to keep them.</div>}
      {batch.status === 'returned' && batch.returnReason && (
        <div className="nt-outcome nt-outcome-dismissed"><strong>Returned for changes</strong><span>{batch.returnReason}</span></div>
      )}
      {batch.status === 'rejected' && batch.rejectionReason && (
        <div className="nt-outcome nt-outcome-dismissed"><strong>Batch rejected</strong><span>{batch.rejectionReason}</span><span className="nt-muted">{batch.reviewedBy?.name} · {formatAccraDateTime(batch.reviewedAt)}</span></div>
      )}
      {flash && (
        <div className="at-flash" role="status"><span>{flash}</span><button type="button" className="hr-link" onClick={() => setFlash('')}>Dismiss</button></div>
      )}
      {error && <p className="at-form-alert" role="alert">{error}</p>}

      <div className="sm-tabs hi-steps" role="tablist" aria-label="Import steps">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`sm-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'review' && batch.status === 'submitted' && <span className="sm-tab-count">{undecided}</span>}
          </button>
        ))}
      </div>

      {/* 1. Details & source */}
      {tab === 'details' && (
        <section className="sm-panel">
          <div className="sm-panel-head">
            <h3>Batch details and source</h3>
            {editable && <button type="button" className="sm-actions-btn" onClick={() => setEditingDetails(true)}>Edit details</button>}
          </div>
          <div className="hi-details-grid">
            <div className="sm-detail-grid hi-detail-list">
              <div className="sm-detail"><span className="sm-detail-label">Company</span><span className="sm-detail-value">{batch.companyName}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Dates</span><span className="sm-detail-value">{formatAccraDate(batch.startDate)} – {formatAccraDate(batch.endDate)}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Attendance period</span><span className="sm-detail-value">{periodRangeLabel(batch.startDate, batch.endDate)} (26th–25th)</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Notebook / page reference</span><span className="sm-detail-value">{batch.notebookReference}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Source</span><span className="sm-detail-value">{batch.sourceDescription}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Created by</span><span className="sm-detail-value">{batch.createdBy.name} · {formatAccraDateTime(batch.createdAt)}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Submitted by</span><span className="sm-detail-value">{batch.submittedBy ? `${batch.submittedBy.name} · ${formatAccraDateTime(batch.submittedAt)}` : 'Not submitted'}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Reviewed by</span><span className="sm-detail-value">{batch.reviewedBy ? `${batch.reviewedBy.name} · ${formatAccraDateTime(batch.reviewedAt)}` : 'Not reviewed'}</span></div>
            </div>
            <div className="hi-attachment-wrap">
              <span className="sm-detail-label">Supporting attachment</span>
              <AttachmentPreview attachment={batch.attachment} />
            </div>
          </div>
        </section>
      )}

      {/* 2. Records & matching */}
      {tab === 'records' && (
        <>
          {editable && (
            <section className="sm-panel">
              <div className="sm-panel-head">
                <h3>{editingRecord ? 'Edit record' : 'Add a notebook line'}</h3>
                <span className="sm-muted">Type exactly what the notebook says. No text is read from the attachment.</span>
              </div>
              {editingRecord ? (
                <RecordForm key={editingRecord.recordId} batch={batch} record={editingRecord} onSave={saveRecord} onCancel={() => setEditingId(null)} />
              ) : (
                <RecordForm key="new" batch={batch} onSave={addRecord} />
              )}
            </section>
          )}

          <section className="sm-panel">
            <div className="at-filters">
              <input type="search" className="form-input sm-search" placeholder="Search name, ID or phone…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
              <select className="sm-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by record status">
                <option value="">All record statuses</option>
                {Object.entries(RECORD_STATUS).map(([id, s]) => <option key={id} value={id}>{s.label}{counts[id] ? ` (${counts[id]})` : ''}</option>)}
              </select>
              {(search || statusFilter) && <button type="button" className="hr-link at-clear" onClick={() => { setSearch(''); setStatusFilter('') }}>Clear filters</button>}
            </div>
            <div className="sm-panel-head at-table-head">
              <h3>Records</h3>
              <span className="sm-muted">{filtered.length} of {shown.length}</span>
            </div>
            {shown.length === 0 ? (
              <p className="sm-empty">{editable ? 'No records yet. Add the first notebook line above.' : 'This batch has no records.'}</p>
            ) : filtered.length === 0 ? (
              <p className="sm-empty">No records match the filters.</p>
            ) : (
              <RecordsTable
                records={filtered}
                assessed={assessed}
                actions={(r) => (
                  <>
                    <button type="button" className="sm-actions-btn" onClick={() => setDrawerId(r.recordId)}>
                      {editable && !r.match ? 'Match' : 'Open'}
                    </button>
                    {editable && <button type="button" className="sm-actions-btn" onClick={() => { setEditingId(r.recordId); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }}>Edit</button>}
                    {editable && <button type="button" className="sm-actions-btn" onClick={() => openConfirm({ kind: 'remove', recordId: r.recordId, name: r.rawName })}>Remove</button>}
                    {finalised && r.review?.decision === 'approved' && (
                      <button type="button" className="sm-actions-btn" onClick={() => onOpenAttendance({ employeeId: r.match.employeeId, date: r.date, companyId: batch.companyId })}>View in Attendance</button>
                    )}
                  </>
                )}
              />
            )}
          </section>
        </>
      )}

      {/* 3. Preview & submit */}
      {tab === 'preview' && (
        <section className="sm-panel">
          <div className="sm-panel-head">
            <h3>Batch preview</h3>
            <span className="sm-muted">{shown.length} record{shown.length === 1 ? '' : 's'}</span>
          </div>
          <div className="at-period-grid">
            {Object.entries(RECORD_STATUS).map(([id, s]) => (
              <div className="sm-stat" key={id}><span className="sm-stat-label">{s.label}</span><span className="sm-stat-value">{counts[id] ?? 0}</span></div>
            ))}
          </div>
          <div className="at-section-pad">
            {withErrors.length > 0 ? (
              <p className="at-form-alert">{withErrors.length} record{withErrors.length === 1 ? ' has' : 's have'} errors that must be fixed before submitting (see the Records step).</p>
            ) : shown.length > 0 ? (
              <p className="sh-form-note" style={{ margin: 0 }}>
                Unmatched, uncertain and incomplete records can be submitted; the reviewer decides on each one. Missing
                times will be stored as Unknown. Missing notebook entries are not added and never become absences.
              </p>
            ) : null}
          </div>
          {shown.length > 0 && <RecordsTable records={shown} assessed={assessed} compact />}
          <div className="at-section-pad">
            {editable ? (
              <div className="sm-alert-actions">
                <button type="button" className="btn btn-primary" disabled={shown.length === 0 || withErrors.length > 0} onClick={() => openConfirm({ kind: 'submit' })}>Submit for review</button>
                <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={!dirty}>Save draft</button>
              </div>
            ) : (
              <p className="at-sub">This batch was submitted {batch.submittedBy ? `by ${batch.submittedBy.name} on ${formatAccraDateTime(batch.submittedAt)}` : ''} and can no longer be edited.</p>
            )}
          </div>
        </section>
      )}

      {/* 4. Review */}
      {tab === 'review' && (
        <section className="sm-panel">
          <div className="sm-panel-head">
            <h3>Reviewer decision</h3>
            <span className="sm-muted">{batch.records.length - undecided} of {batch.records.length} decided</span>
          </div>
          <div className="at-section-pad">
            {batch.status !== 'submitted' && (
              <p className="sh-form-note" style={{ margin: 0 }}>
                {['draft', 'returned'].includes(batch.status)
                  ? 'Submit the batch first. A reviewer other than the submitter will then approve or reject it.'
                  : `Review completed by ${batch.reviewedBy?.name ?? '—'} on ${formatAccraDateTime(batch.reviewedAt)}.`}
              </p>
            )}
            {batch.status === 'submitted' && !isReviewer && (
              <p className="sh-form-note" style={{ margin: 0 }}>
                {!canReviewHistorical(user)
                  ? 'Waiting for an authorised reviewer (HR Manager or HR Director).'
                  : 'You submitted this batch, so another authorised reviewer must review it.'}
              </p>
            )}
            {isReviewer && (
              <div className="sm-alert-actions">
                <button type="button" className="btn btn-primary at-btn" disabled={eligibleCount === 0} onClick={() => run(mockApproveAllEligible(batchId, user), `Approved ${eligibleCount} eligible record${eligibleCount === 1 ? '' : 's'}.`)}>
                  Approve all eligible ({eligibleCount})
                </button>
                <button type="button" className="btn btn-primary at-btn" disabled={undecided > 0} onClick={() => openConfirm({ kind: 'complete' })}>Complete review</button>
                <button type="button" className="btn btn-secondary at-btn" onClick={() => openConfirm({ kind: 'return' })}>Return for changes…</button>
                <button type="button" className="btn btn-secondary at-btn nt-btn-danger" onClick={() => openConfirm({ kind: 'reject-batch' })}>Reject entire batch…</button>
              </div>
            )}
          </div>
          <RecordsTable
            records={batch.records}
            assessed={assessed}
            showDecision
            actions={(r) => (
              <>
                <button type="button" className="sm-actions-btn" onClick={() => setDrawerId(r.recordId)}>{isReviewer ? 'Review' : 'Open'}</button>
                {isReviewer && !r.review && assessed.get(r.recordId)?.eligible && (
                  <button type="button" className="sm-actions-btn" onClick={() => run(mockDecideRecord(batchId, r.recordId, 'approved', '', user))}>Approve</button>
                )}
                {finalised && r.review?.decision === 'approved' && (
                  <button type="button" className="sm-actions-btn" onClick={() => onOpenAttendance({ employeeId: r.match.employeeId, date: r.date, companyId: batch.companyId })}>View in Attendance</button>
                )}
              </>
            )}
          />
        </section>
      )}

      {tab === 'history' && (
        <section className="sm-panel">
          <div className="sm-panel-head"><h3>Batch history</h3><span className="sm-muted">{batch.history.length} entries</span></div>
          <ol className="nt-history">
            {batch.history.slice().reverse().map((h) => (
              <li key={h.id}>
                <div className="nt-history-head"><strong>{h.action}</strong><span className="nt-muted">{h.by}{h.byRole ? ` (${h.byRole})` : ''} · {formatAccraDateTime(h.at)}</span></div>
                {h.note && <p>{h.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {drawerRecord && (
        <RecordDrawer
          batch={batch}
          record={drawerRecord}
          assessment={assessed.get(drawerRecord.recordId)}
          roster={ctx.roster}
          mode={editable ? 'edit' : isReviewer ? 'review' : 'view'}
          user={user}
          error={error}
          onMatch={setMatch}
          onDecide={(recordId, decision, reason) => run(mockDecideRecord(batchId, recordId, decision, reason, user), decision === 'approved' ? 'Record approved.' : 'Record rejected.')}
          onClearDecision={(recordId) => run(mockClearDecision(batchId, recordId, user), 'Decision undone.')}
          onClose={() => { setDrawerId(null); setError('') }}
        />
      )}

      {editingDetails && (
        <BatchFormModal batch={batch} user={user} onClose={() => setEditingDetails(false)} onSaved={() => { setEditingDetails(false); refresh('Batch details saved.') }} />
      )}

      {confirm && (
        <Confirm
          error={confirmError}
          onCancel={() => setConfirm(null)}
          onConfirm={doConfirm}
          {...{
            submit: {
              title: 'Submit this batch for review?',
              lead: <>You are submitting <strong>{records.length}</strong> records ({counts.matched ?? 0} matched, {(counts.unmatched ?? 0) + (counts['pending-review'] ?? 0)} needing a decision, {counts.incomplete ?? 0} incomplete). After submitting, the batch cannot be edited unless the reviewer returns it.</>,
              confirmLabel: 'Submit for review',
            },
            remove: {
              title: 'Remove this record?',
              lead: <>Remove the unsubmitted line for <strong>{confirm.name || 'this entry'}</strong>? This only affects the draft.</>,
              confirmLabel: 'Remove record',
              danger: true,
            },
            leave: {
              title: 'Leave without saving?',
              lead: 'Your unsaved changes to this draft will be lost.',
              confirmLabel: 'Leave without saving',
              danger: true,
            },
            'reject-batch': {
              title: 'Reject the entire batch?',
              lead: 'Every record in this batch will be rejected and nothing will appear in Attendance. The reason is kept in the batch history.',
              needReason: true,
              reasonLabel: 'Rejection reason (required)',
              confirmLabel: 'Reject batch',
              danger: true,
            },
            return: {
              title: 'Return for changes?',
              lead: 'The importer can edit the batch again. Decisions made so far are cleared but stay in the history.',
              needReason: true,
              reasonLabel: 'What needs to change (required)',
              confirmLabel: 'Return batch',
            },
            complete: {
              title: 'Complete the review?',
              lead: `${batch.records.filter((r) => r.review?.decision === 'approved').length} approved records will appear in Attendance as Historical – Manually Recorded. Rejected records will not.`,
              confirmLabel: 'Complete review',
            },
          }[confirm.kind]}
        />
      )}
    </div>
  )
}

/** Shared records table (cards on narrow screens). */
function RecordsTable({ records, assessed, actions, compact = false, showDecision = false }) {
  return (
    <div className="sm-table-wrap">
      <table className="sm-table hi-table">
        <thead>
          <tr>
            <th scope="col">Notebook name</th>
            <th scope="col">Matched employee</th>
            <th scope="col">Date</th>
            <th scope="col">Arrival</th>
            <th scope="col">Departure</th>
            <th scope="col">Notebook status</th>
            <th scope="col">Flags</th>
            <th scope="col">Status</th>
            {!compact && <th scope="col"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const a = assessed.get(r.recordId)
            return (
              <tr key={r.recordId}>
                <td data-label="Notebook name">
                  <span className="at-stack">
                    <span className="at-emp-name">{r.rawName || '—'}</span>
                    <span className="at-sub">{[r.rawEmployeeId, r.rawPhone, r.pageReference].filter(Boolean).join(' · ') || 'No ID or phone'}</span>
                  </span>
                </td>
                <td data-label="Matched employee">
                  {r.match ? (
                    <span className="at-stack">
                      {r.match.employeeName}
                      <span className="at-sub"><span className="sm-mono">{r.match.employeeId}</span> · {r.match.position}</span>
                    </span>
                  ) : (
                    <span className="hi-unknown">Not matched</span>
                  )}
                </td>
                <td data-label="Date" className="at-nowrap">{r.date ? formatAccraDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                <td data-label="Arrival" className="at-time">{timeCell(r.arrivalTime, r.arrivalUnreadable, r.recordedStatus)}</td>
                <td data-label="Departure" className="at-time">{timeCell(r.departureTime, r.departureUnreadable, r.recordedStatus)}</td>
                <td data-label="Notebook status">{NOTEBOOK_STATUS[r.recordedStatus]}</td>
                <td data-label="Flags"><FlagList flags={a?.flags ?? []} compact /></td>
                <td data-label="Status">
                  <span className="at-stack">
                    <RecordStatusBadge status={a?.status} />
                    {showDecision && r.review?.reason && <span className="at-sub">{r.review.reason}</span>}
                  </span>
                </td>
                {!compact && <td data-label="Actions" className="at-actions hi-actions">{actions?.(r)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
