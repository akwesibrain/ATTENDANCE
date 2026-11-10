import { useEffect, useMemo, useState } from 'react'
import { authorisedCompanies, can } from '../services/permissionsService'
import { AUDIT_CATEGORIES, auditToCsv, companyLabel, listAuditEvents } from '../services/auditService'
import { recordAuditEvent } from '../services/auditStore'
import { accraDateKey, formatAccraDateTime } from '../utils/accraTime'
import '../styles/sales-monitoring.css'
import '../styles/attendance.css'
import '../styles/notifications.css'
import '../styles/settings.css'

const PAGE_SIZE = 15

function ValueBlock({ label, value }) {
  if (!value) return null
  return (
    <div className="st-value-block">
      <span className="sm-detail-label">{label}</span>
      <dl>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function EventDrawer({ event, onClose }) {
  useEffect(() => {
    const onEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])
  return (
    <div className="nt-drawer-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="nt-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-title">
        <header className="nt-drawer-head">
          <div>
            <div className="nt-drawer-badges">
              <span className={`st-origin st-origin-${event.origin}`}>{event.origin === 'seed' ? 'Demo seed data' : 'Recorded mock action'}</span>
              <span className="nt-category">{event.category}</span>
            </div>
            <h3 id="audit-title">{event.action}</h3>
            <p className="nt-muted">{event.eventId} · {formatAccraDateTime(event.at)}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="nt-drawer-body">
          <section className="sm-section">
            <h4 className="sm-section-title">Event</h4>
            <div className="sm-detail-grid">
              <div className="sm-detail"><span className="sm-detail-label">User responsible</span><span className="sm-detail-value">{event.actorName}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">User role</span><span className="sm-detail-value">{event.actorRole || '—'}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Company</span><span className="sm-detail-value">{companyLabel(event.companyIds)}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Affected record</span><span className="sm-detail-value">{event.affected || '—'}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Source</span><span className="sm-detail-value">{event.source}</span></div>
              <div className="sm-detail"><span className="sm-detail-label">Date and time</span><span className="sm-detail-value">{formatAccraDateTime(event.at)} (Africa/Accra)</span></div>
            </div>
          </section>
          {event.description && <p className="nt-description">{event.description}</p>}
          {(event.previous || event.next) ? (
            <div className="st-values">
              <ValueBlock label="Previous value" value={event.previous} />
              <ValueBlock label="New value" value={event.next} />
            </div>
          ) : (
            <p className="at-sub">No previous/new value applies to this event.</p>
          )}
          <p className="at-section-note at-flush">Audit entries cannot be edited or deleted. In production the audit log must be written and protected by the backend.</p>
        </div>
      </aside>
    </div>
  )
}

/** Audit Logs — read-only, company-scoped, filterable, exportable. */
export default function AuditLogs({ user }) {
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('')
  const [category, setCategory] = useState('')
  const [actor, setActor] = useState('')
  const [origin, setOrigin] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [version, setVersion] = useState(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => listAuditEvents(user), [user, version])
  const companies = authorisedCompanies(user)
  const actors = useMemo(() => Array.from(new Set(events.map((e) => e.actorName))).sort(), [events])
  const canExport = can(user, 'audit-logs', 'export')

  if (!can(user, 'audit-logs', 'view')) {
    return <p className="sm-empty">You do not have access to the audit log.</p>
  }

  const term = search.trim().toLowerCase()
  const filtered = events.filter((e) => {
    if (company && !e.companyIds.includes(company)) return false
    if (category && e.category !== category) return false
    if (actor && e.actorName !== actor) return false
    if (origin && e.origin !== origin) return false
    const d = accraDateKey(new Date(e.at))
    if (from && d < from) return false
    if (to && d > to) return false
    if (term && ![e.eventId, e.action, e.affected, e.description, e.actorName].some((v) => String(v ?? '').toLowerCase().includes(term))) return false
    return true
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const items = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const active = search || company || category || actor || origin || from || to
  const clear = () => { setSearch(''); setCompany(''); setCategory(''); setActor(''); setOrigin(''); setFrom(''); setTo(''); setPage(1) }
  const set = (fn) => (e) => { fn(e.target.value); setPage(1) }

  const exportCsv = () => {
    const blob = new Blob([auditToCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${company || (companies.length > 1 ? 'all-companies' : companies[0]?.id)}-${accraDateKey()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    recordAuditEvent({ action: 'Audit log exported', category: 'System Settings', source: 'Audit Logs', actor: { name: user.name, role: user.role }, companyIds: company ? [company] : companies.length > 1 ? [] : companies.map((c) => c.id), affected: 'Audit log', description: `${filtered.length} events exported to CSV.` })
    setVersion((v) => v + 1)
  }

  return (
    <div className="sm-page">
      <div className="sm-head">
        <div>
          <h2>Audit Logs</h2>
          <p>A read-only record of administrative actions. Entries cannot be edited or deleted.</p>
        </div>
        {canExport && (
          <div className="at-head-actions">
            <button type="button" className="btn btn-secondary at-btn" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
          </div>
        )}
      </div>
      <p className="st-legend">
        <span className="st-origin st-origin-action">Recorded mock action</span> happened in this browser&apos;s demo.{' '}
        <span className="st-origin st-origin-seed">Demo seed data</span> was pre-loaded to illustrate the log.
      </p>
      <section className="sm-panel">
        <div className="at-filters">
          <input type="search" className="form-input sm-search" placeholder="Search event, record or description…" value={search} onChange={set(setSearch)} aria-label="Search audit log" />
          <select className="sm-select" value={company} onChange={set(setCompany)} aria-label="Company">
            <option value="">{companies.length > 1 ? 'All companies' : 'My company'}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="sm-select" value={category} onChange={set(setCategory)} aria-label="Category">
            <option value="">All categories</option>
            {AUDIT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="sm-select" value={actor} onChange={set(setActor)} aria-label="User responsible">
            <option value="">All users</option>
            {actors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="sm-select" value={origin} onChange={set(setOrigin)} aria-label="Origin">
            <option value="">Recorded and seed</option>
            <option value="action">Recorded mock actions</option>
            <option value="seed">Demo seed data</option>
          </select>
          <span className="nt-range">
            <label htmlFor="au-from" className="nt-muted">From</label>
            <input id="au-from" type="date" className="form-input" value={from} max={to || undefined} onChange={set(setFrom)} />
            <label htmlFor="au-to" className="nt-muted">to</label>
            <input id="au-to" type="date" className="form-input" value={to} min={from || undefined} onChange={set(setTo)} />
          </span>
          <button type="button" className="hr-link at-clear" onClick={clear} disabled={!active}>Clear filters</button>
        </div>
        <div className="sm-panel-head at-table-head">
          <h3>Events</h3>
          <span className="sm-muted">{filtered.length} of {events.length}</span>
        </div>
        {filtered.length === 0 ? (
          <div className="sm-empty">
            <p style={{ margin: 0 }}>{events.length ? 'No events match the filters.' : 'No audit events yet.'}</p>
            {active && <button type="button" className="hr-link" onClick={clear}>Clear filters</button>}
          </div>
        ) : (
          <>
            <div className="sm-table-wrap">
              <table className="sm-table st-audit-table">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Category</th>
                    <th scope="col">User</th>
                    <th scope="col">Company</th>
                    <th scope="col">Date &amp; time</th>
                    <th scope="col">Affected record</th>
                    <th scope="col"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.eventId}>
                      <td data-label="Event">
                        <span className="at-stack">
                          <span className="at-emp-name">{e.action}</span>
                          <span className="at-sub"><span className="sm-mono">{e.eventId}</span> · <span className={`st-origin st-origin-${e.origin}`}>{e.origin === 'seed' ? 'Seed' : 'Recorded'}</span></span>
                        </span>
                      </td>
                      <td data-label="Category">{e.category}</td>
                      <td data-label="User">
                        <span className="at-stack">{e.actorName}<span className="at-sub">{e.actorRole || '—'}</span></span>
                      </td>
                      <td data-label="Company">{companyLabel(e.companyIds)}</td>
                      <td data-label="Date & time" className="at-nowrap">{formatAccraDateTime(e.at)}</td>
                      <td data-label="Affected record"><span className="at-stack">{e.affected || '—'}<span className="at-sub st-clamp">{e.description}</span></span></td>
                      <td data-label="Details" className="at-actions"><button type="button" className="sm-actions-btn" onClick={() => setOpen(e)}>Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="at-pagination" aria-label="Audit pages">
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
      {open && <EventDrawer event={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
