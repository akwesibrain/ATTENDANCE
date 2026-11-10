import { useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import { BATCH_STATUS, HISTORICAL_SOURCE_LABEL } from '../constants/historicalImportLabels'
import { canImportHistorical, canReviewHistorical, canViewCompany } from '../constants/hrUser'
import {
  mockListBatches,
  periodRangeLabel,
  summariseImports,
} from '../services/historicalImportService'
import { DIGITAL_GO_LIVE_DATE } from '../utils/attendanceRules'
import { formatAccraDate, formatAccraDateTime } from '../utils/accraTime'
import BatchDetail from '../components/historical-import/BatchDetail'
import BatchFormModal from '../components/historical-import/BatchFormModal'
import { BatchStatusBadge } from '../components/historical-import/ImportBadges'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/attendance.css'
import '../styles/notifications.css'
import '../styles/historical-import.css'

const PAGE_SIZE = 10

function Stat({ label, value, tone, hint }) {
  return (
    <div className="sm-stat" title={hint}>
      <span className="sm-stat-label">{label}</span>
      <span className={`sm-stat-value${tone ? ` sm-stat-${tone}` : ''}`}>{value}</span>
    </div>
  )
}

/**
 * Historical Attendance Import — transcribe paper notebooks into batches,
 * match employees, review data quality, and approve. Frontend + mock data only:
 * no OCR, no uploads, no employees created from notebook names.
 */
export default function HistoricalImport({ company, user, onChanged, onOpenAttendance }) {
  const userId = user.id
  const [openBatchId, setOpenBatchId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [version, setVersion] = useState(0)
  const [search, setSearch] = useState('')
  const [companyId, setCompanyId] = useState(company.id)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const bump = () => {
    setVersion((v) => v + 1)
    onChanged?.()
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batches = useMemo(() => mockListBatches(user), [user, version, openBatchId])
  const authorised = COMPANIES.filter((c) => canViewCompany(user, c.id))
  const effectiveCompany = canViewCompany(user, companyId) ? companyId : ''

  const inCompany = batches.filter((b) => !effectiveCompany || b.companyId === effectiveCompany)
  const term = search.trim().toLowerCase()
  const filtered = inCompany.filter((b) => {
    if (status && b.status !== status) return false
    if (term && ![b.name, b.notebookReference, b.sourceDescription, b.createdBy?.name].some((v) => (v ?? '').toLowerCase().includes(term))) return false
    return true
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summariseImports(inCompany, user), [inCompany.map((b) => `${b.batchId}:${b.updatedAt}:${b.status}`).join('|'), user])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const pageItems = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const awaitingMine = batches.filter((b) => b.status === 'submitted' && canReviewHistorical(user) && b.submittedBy?.id !== user.id).length

  const userBar = (
    <div className="nt-userbar">
      <span className="nt-muted">
        {user.name} ({user.role}) · 
        {canReviewHistorical(user) ? 'Can import and review (not their own batches).' : 'Can import and submit; cannot approve.'}
      </span>
    </div>
  )

  if (openBatchId) {
    return (
      <div className="sm-page">
        {userBar}
        <BatchDetail
          key={`${openBatchId}-${userId}`}
          batchId={openBatchId}
          user={user}
          onBack={() => setOpenBatchId(null)}
          onChanged={bump}
          onOpenAttendance={onOpenAttendance}
        />
      </div>
    )
  }

  const clear = () => { setSearch(''); setStatus(''); setCompanyId(company.id); setPage(1) }
  const filtersActive = search || status || effectiveCompany !== (canViewCompany(user, company.id) ? company.id : '')

  return (
    <div className="sm-page hi-page">
      <div className="sm-head">
        <div>
          <h2>Historical Attendance Import</h2>
          <p>
            Transcribe paper notebook attendance from before {formatAccraDate(DIGITAL_GO_LIVE_DATE)}, match it to
            existing employees and send it for approval. Approved entries appear in Attendance as{' '}
            <strong>{HISTORICAL_SOURCE_LABEL}</strong>.
          </p>
        </div>
        {canImportHistorical(user) && (
          <div className="at-head-actions">
            <button type="button" className="btn btn-primary at-btn" onClick={() => setCreating(true)}>New import batch</button>
          </div>
        )}
      </div>

      {userBar}

      {awaitingMine > 0 && (
        <div className="at-flash hi-review-banner" role="status">
          <span>{awaitingMine} batch{awaitingMine === 1 ? ' is' : 'es are'} waiting for your review.</span>
          <button type="button" className="hr-link" onClick={() => { setStatus('submitted'); setPage(1) }}>Show</button>
        </div>
      )}

      <div className="sm-stats" role="status" aria-label="Import summary">
        <Stat label="Total historical records" value={summary.total} />
        <Stat label="Successfully imported" value={summary.imported} tone="ok" hint="Approved records in completed batches" />
        <Stat label="Pending review" value={summary.pending} tone="accent" hint="Awaiting a reviewer decision, or needing HR to confirm a match" />
        <Stat label="Unmatched employees" value={summary.unmatched} tone="crit" hint="Records not linked to an existing employee" />
        <Stat label="Incomplete information" value={summary.incomplete} tone="warn" hint="Missing or unreadable times, unclear entries or invalid data" />
        <Stat label="Rejected records" value={summary.rejected} />
      </div>

      <section className="sm-panel">
        <div className="at-filters">
          <input type="search" className="form-input sm-search" placeholder="Search batch, notebook reference or importer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search import batches" />
          <select className="sm-select" value={effectiveCompany} onChange={(e) => { setCompanyId(e.target.value); setPage(1) }} aria-label="Company">
            {authorised.length > 1 && <option value="">All authorised companies</option>}
            {authorised.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="sm-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Batch status">
            <option value="">All batch statuses</option>
            {Object.entries(BATCH_STATUS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
          <button type="button" className="hr-link at-clear" onClick={clear} disabled={!filtersActive}>Clear filters</button>
        </div>
        <div className="sm-panel-head at-table-head">
          <h3>Import history</h3>
          <span className="sm-muted">{filtered.length} of {inCompany.length} batches</span>
        </div>

        {inCompany.length === 0 ? (
          <div className="sm-empty">
            <p style={{ margin: 0 }}>No historical imports yet.</p>
            {canImportHistorical(user) && (
              <p className="at-sub" style={{ margin: '6px 0 0' }}>
                Create a batch for one notebook (or a few pages), attach a photo of the pages, then type in each line.
              </p>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="sm-empty">
            <p style={{ margin: 0 }}>No batches match the filters.</p>
            <button type="button" className="hr-link" onClick={clear}>Clear filters</button>
          </div>
        ) : (
          <>
            <div className="sm-table-wrap">
              <table className="sm-table hi-batch-table">
                <thead>
                  <tr>
                    <th scope="col">Import batch</th>
                    <th scope="col">Company</th>
                    <th scope="col">Attendance period</th>
                    <th scope="col">Records</th>
                    <th scope="col">Imported by</th>
                    <th scope="col">Import date</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((b) => (
                    <tr key={b.batchId}>
                      <td data-label="Import batch">
                        <span className="at-stack">
                          <span className="at-emp-name">{b.name}</span>
                          <span className="at-sub">{b.notebookReference}</span>
                        </span>
                      </td>
                      <td data-label="Company">{b.companyName}</td>
                      <td data-label="Attendance period">
                        <span className="at-stack">
                          {periodRangeLabel(b.startDate, b.endDate)}
                          <span className="at-sub">{formatAccraDate(b.startDate, { day: 'numeric', month: 'short' })} – {formatAccraDate(b.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </span>
                      </td>
                      <td data-label="Records" className="at-time">{b.records.length}</td>
                      <td data-label="Imported by">{(b.submittedBy ?? b.createdBy).name}</td>
                      <td data-label="Import date" className="at-nowrap">{formatAccraDateTime(b.submittedAt ?? b.createdAt)}</td>
                      <td data-label="Status"><BatchStatusBadge status={b.status} /></td>
                      <td data-label="Actions" className="at-actions">
                        <button type="button" className="sm-actions-btn" onClick={() => setOpenBatchId(b.batchId)}>
                          {['draft', 'returned'].includes(b.status) && canImportHistorical(user)
                            ? 'Continue'
                            : b.status === 'submitted' && canReviewHistorical(user) && b.submittedBy?.id !== user.id
                              ? 'Review'
                              : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="at-pagination" aria-label="Batch pages">
              <span className="sm-muted">Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="at-pages">
                <button type="button" className="sm-actions-btn" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
                <span className="at-page-num">Page {current} of {pageCount}</span>
                <button type="button" className="sm-actions-btn" disabled={current === pageCount} onClick={() => setPage(current + 1)}>Next</button>
              </div>
            </nav>
          </>
        )}
      </section>

      <p className="mock-banner" style={{ textAlign: 'center', margin: 0 }}>
        Demo only — batches and attachments are kept in this browser. No OCR, no uploads, and no employees are created from notebook names.
      </p>

      {creating && (
        <BatchFormModal
          user={user}
          defaultCompanyId={effectiveCompany || company.id}
          onClose={() => setCreating(false)}
          onSaved={(batch) => {
            setCreating(false)
            bump()
            setOpenBatchId(batch.batchId)
          }}
        />
      )}
    </div>
  )
}
