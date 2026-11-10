import { useCallback, useEffect, useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_STATUSES,
  SEVERITIES,
} from '../constants/notificationTypes'
import { canManageNotifications, canViewCompany } from '../constants/hrUser'
import {
  getLastSyncedAt,
  isOpen,
  mockGetNotification,
  mockListNotifications,
  mockMarkAllRead,
  mockSetRead,
  mockSyncNotifications,
  notificationDateKey,
  requiresHrAttention,
  summariseNotifications,
} from '../services/notificationsService'
import { formatAccraDateTime } from '../utils/accraTime'
import NotificationDrawer from '../components/notifications/NotificationDrawer'
import AttendanceDetailModal from '../components/attendance/AttendanceDetailModal'
import { NotificationStatusBadge, SeverityBadge } from '../components/notifications/NotificationBadges'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/attendance.css'
import '../styles/notifications.css'

const PAGE_SIZE = 12
const LOADING_MS = 300

const EMPTY_FILTERS = {
  search: '',
  category: '',
  severity: '',
  status: '',
  read: '',
  attention: false,
  from: '',
  to: '',
}

function Stat({ label, value, tone, active, onClick, hint }) {
  return (
    <button
      type="button"
      className={`sm-stat nt-stat${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={hint}
      aria-pressed={active}
    >
      <span className="sm-stat-label">{label}</span>
      <span className={`sm-stat-value${tone ? ` sm-stat-${tone}` : ''}`}>{value}</span>
    </button>
  )
}

/**
 * Notifications & Exceptions — in-app alerts raised from the shared mock data.
 * Company-scoped to the signed-in (mock) HR user. Nothing is sent externally.
 */
export default function NotificationsCenter({ company, user, onNavigate, onChanged }) {
  const canAct = canManageNotifications(user)

  const [companyId, setCompanyId] = useState(company.id)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [attendanceRecord, setAttendanceRecord] = useState(null)
  const [flash, setFlash] = useState('')

  const bump = useCallback(() => {
    setVersion((v) => v + 1)
    onChanged?.()
  }, [onChanged])

  const refresh = useCallback(
    (announce) => {
      setLoading(true)
      setTimeout(() => {
        const { added } = mockSyncNotifications()
        setLoading(false)
        bump()
        if (announce) {
          setFlash(added ? `${added} new notification${added === 1 ? '' : 's'} found.` : 'No new notifications. Everything is up to date.')
        }
      }, LOADING_MS)
    },
    [bump],
  )

  // Generate on open; the sync never creates duplicates.
  useEffect(() => {
    refresh(false)
  }, [refresh])

  const all = useMemo(
    () => mockListNotifications(user),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, version],
  )
  const authorisedCompanies = COMPANIES.filter((c) => canViewCompany(user, c.id))
  const effectiveCompany = companyId && canViewCompany(user, companyId) ? companyId : ''

  const setFilter = (name, value) => {
    setFilters((f) => ({ ...f, [name]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setCompanyId(canViewCompany(user, company.id) ? company.id : '')
    setPage(1)
  }

  const inCompany = useMemo(
    () => all.filter((n) => !effectiveCompany || n.companyId === effectiveCompany),
    [all, effectiveCompany],
  )

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return inCompany.filter((n) => {
      if (filters.category && n.category !== filters.category) return false
      if (filters.severity && n.severity !== filters.severity) return false
      if (filters.status && n.status !== filters.status) return false
      if (filters.read === 'unread' && n.read) return false
      if (filters.read === 'read' && !n.read) return false
      if (filters.attention && !requiresHrAttention(n)) return false
      if (filters.from || filters.to) {
        const d = notificationDateKey(n)
        if (filters.from && d < filters.from) return false
        if (filters.to && d > filters.to) return false
      }
      if (
        term &&
        ![n.title, n.description, n.employeeName, n.employeeId].some((v) => (v ?? '').toLowerCase().includes(term))
      ) {
        return false
      }
      return true
    })
  }, [inCompany, filters])

  const summary = useMemo(() => summariseNotifications(filtered), [filtered])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const selected = useMemo(
    () => (selectedId ? mockGetNotification(selectedId, user) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, user, version],
  )

  const openNotification = (n) => {
    setSelectedId(n.id)
    if (!n.read && canAct) {
      mockSetRead(n.id, true, user)
      bump()
    }
  }

  const markAllRead = () => {
    const ids = filtered.filter((n) => !n.read).map((n) => n.id)
    const { count } = mockMarkAllRead(ids, user)
    setFlash(count ? `${count} notification${count === 1 ? '' : 's'} marked as read.` : 'Nothing to mark: everything shown is already read.')
    bump()
  }

  const filtersActive =
    JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) ||
    effectiveCompany !== (canViewCompany(user, company.id) ? company.id : '')

  const companyLabel = effectiveCompany
    ? COMPANIES.find((c) => c.id === effectiveCompany)?.name
    : authorisedCompanies.length > 1 ? 'All authorised companies' : authorisedCompanies[0]?.name
  const lastSynced = getLastSyncedAt()

  return (
    <div className="sm-page nt-page">
      <div className="sm-head">
        <div>
          <h2>Notifications &amp; Exceptions</h2>
          <p>
            In-app alerts raised from attendance, verification and assignment data. HR reviews every
            exception; nothing here marks anyone absent or applies discipline automatically.
          </p>
        </div>
        <div className="at-head-actions">
          <button type="button" className="btn btn-secondary at-btn" onClick={() => refresh(true)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {canAct && (
            <button type="button" className="btn btn-primary at-btn" onClick={markAllRead} disabled={loading || summary.unread === 0}>
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="nt-userbar">
        <span className="nt-muted">
          {user.name} ({user.role}) 
          Sees only {authorisedCompanies.map((c) => c.name).join(' and ')} notifications.
          {lastSynced && ` Last refreshed ${formatAccraDateTime(lastSynced)}.`}
        </span>
      </div>

      {flash && (
        <div className="at-flash" role="status">
          <span>{flash}</span>
          <button type="button" className="hr-link" onClick={() => setFlash('')}>Dismiss</button>
        </div>
      )}

      <div className="sm-stats" role="group" aria-label="Notification summary" aria-busy={loading}>
        <Stat label="Total notifications" value={loading ? '–' : summary.total} active={false} onClick={clearFilters} hint="Clear filters" />
        <Stat label="Unread" value={loading ? '–' : summary.unread} tone="accent" active={filters.read === 'unread'} onClick={() => setFilter('read', filters.read === 'unread' ? '' : 'unread')} hint="Show unread only" />
        <Stat label="Critical alerts (open)" value={loading ? '–' : summary.critical} tone="crit" active={filters.severity === 'critical'} onClick={() => setFilter('severity', filters.severity === 'critical' ? '' : 'critical')} hint="Show critical only" />
        <Stat label="Pending exceptions" value={loading ? '–' : summary.pending} tone="warn" active={filters.status === 'new'} onClick={() => setFilter('status', filters.status === 'new' ? '' : 'new')} hint="Show new only" />
        <Stat label="Resolved exceptions" value={loading ? '–' : summary.resolved} tone="ok" active={filters.status === 'resolved'} onClick={() => setFilter('status', filters.status === 'resolved' ? '' : 'resolved')} hint="Show resolved only" />
        <Stat label="Requires HR attention" value={loading ? '–' : summary.attention} tone="crit" active={filters.attention} onClick={() => setFilter('attention', !filters.attention)} hint="Open notifications with Critical or High severity" />
      </div>

      <section className="sm-panel">
        <div className="at-filters">
          <input
            type="search"
            className="form-input sm-search"
            placeholder="Search title, description, employee or ID…"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            aria-label="Search notifications"
          />
          <select className="sm-select" value={effectiveCompany} onChange={(e) => { setCompanyId(e.target.value); setPage(1) }} aria-label="Company">
            {authorisedCompanies.length > 1 && <option value="">All authorised companies</option>}
            {authorisedCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="sm-select" value={filters.category} onChange={(e) => setFilter('category', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {Object.entries(NOTIFICATION_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select className="sm-select" value={filters.severity} onChange={(e) => setFilter('severity', e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {Object.entries(SEVERITIES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
          <select className="sm-select" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(NOTIFICATION_STATUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select className="sm-select" value={filters.read} onChange={(e) => setFilter('read', e.target.value)} aria-label="Read status">
            <option value="">Read and unread</option>
            <option value="unread">Unread only</option>
            <option value="read">Read only</option>
          </select>
          <span className="nt-range">
            <label htmlFor="nt-from" className="nt-muted">From</label>
            <input id="nt-from" type="date" className="form-input" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            <label htmlFor="nt-to" className="nt-muted">to</label>
            <input id="nt-to" type="date" className="form-input" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
          </span>
          <button type="button" className="hr-link at-clear" onClick={clearFilters} disabled={!filtersActive}>
            Clear filters
          </button>
        </div>

        <div className="sm-panel-head at-table-head">
          <h3>Notifications — {companyLabel}</h3>
          <span className="sm-muted">
            {loading ? 'Loading…' : `${filtered.length} of ${inCompany.length} shown`}
          </span>
        </div>

        {loading && all.length === 0 ? (
          <div className="at-skeleton" aria-label="Loading notifications">
            {Array.from({ length: 6 }).map((_, i) => <div className="at-skeleton-row" key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="sm-empty">
            <p style={{ margin: 0 }}>
              {inCompany.length === 0
                ? `No notifications for ${companyLabel}. Nothing needs attention right now.`
                : filters.read === 'unread'
                  ? 'You are all caught up — no unread notifications match these filters.'
                  : 'No notifications match the selected filters.'}
            </p>
            {filtersActive && <button type="button" className="hr-link" onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : (
          <>
            <div className="sm-table-wrap">
              <table className="sm-table nt-table">
                <thead>
                  <tr>
                    <th scope="col">Notification</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Category</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Date &amp; time</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((n) => (
                    <tr key={n.id} className={n.read ? '' : 'is-unread'}>
                      <td data-label="Notification">
                        <div className="nt-title-cell">
                          <span className={`nt-dot${n.read ? ' is-read' : ''}`} aria-label={n.read ? 'Read' : 'Unread'} role="img" />
                          <span className="at-stack">
                            <span className="nt-title">{n.title}</span>
                            <span className="nt-desc">{n.description}</span>
                          </span>
                        </div>
                      </td>
                      <td data-label="Employee">
                        <span className="at-stack">
                          <span className="at-emp-name">{n.employeeName}</span>
                          <span className="at-sub"><span className="sm-mono">{n.employeeId ?? 'Not matched'}</span> · {n.companyName}</span>
                        </span>
                      </td>
                      <td data-label="Category"><span className="nt-category">{NOTIFICATION_CATEGORIES[n.category]}</span></td>
                      <td data-label="Severity"><SeverityBadge severity={n.severity} /></td>
                      <td data-label="Date & time" className="at-nowrap at-time">{formatAccraDateTime(n.occurredAt)}</td>
                      <td data-label="Status">
                        <span className="at-stack">
                          <NotificationStatusBadge status={n.status} />
                          <span className="at-sub">
                            {n.read ? 'Read' : 'Unread'}
                            {n.assignedTo && isOpen(n) ? ` · ${n.assignedTo.name}` : ''}
                          </span>
                        </span>
                      </td>
                      <td data-label="Action" className="at-actions">
                        <button type="button" className="sm-actions-btn" onClick={() => openNotification(n)} aria-label={`Open ${n.title} for ${n.employeeName}`}>
                          {isOpen(n) && canAct ? 'Review' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="at-pagination" aria-label="Notification pages">
              <span className="sm-muted">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="at-pages">
                <button type="button" className="sm-actions-btn" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
                <span className="at-page-num">Page {currentPage} of {pageCount}</span>
                <button type="button" className="sm-actions-btn" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
              </div>
            </nav>
          </>
        )}
      </section>

      <p className="mock-banner" style={{ textAlign: 'center', margin: 0 }}>
        Demo only — notifications exist in this browser. No SMS, email or push messages are sent.
      </p>

      {selected && (
        <NotificationDrawer
          key={selected.id}
          notification={selected}
          user={user}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
          onOpenAttendance={setAttendanceRecord}
          onNavigate={(nav) => {
            setSelectedId(null)
            onNavigate?.(nav)
          }}
        />
      )}

      {attendanceRecord && (
        <AttendanceDetailModal
          record={attendanceRecord}
          canCorrect={false}
          onCorrect={() => {}}
          onClose={() => setAttendanceRecord(null)}
        />
      )}
    </div>
  )
}
