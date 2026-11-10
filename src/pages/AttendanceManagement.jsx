import { useEffect, useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import { ATTENDANCE_STATUS, VERIFICATION_STATUS } from '../constants/attendanceLabels'
import { authorisedCompanies, can, canCorrectAttendance } from '../constants/hrUser'
import {
  attendanceRecordsToCsv,
  listAttendanceRecords,
  listAttendanceRoster,
  mockGetAttendanceRecord,
  summariseAttendance,
} from '../services/attendanceRecordsService'
import { mockListAllShops } from '../services/shopsService'
import { elapsedPeriodDateKeys, periodForDateKey } from '../utils/attendanceRules'
import { accraTodayKey, formatAccraDate } from '../utils/accraTime'
import AttendanceDetailModal from '../components/attendance/AttendanceDetailModal'
import CorrectionModal from '../components/attendance/CorrectionModal'
import ManualEntry from '../components/attendance/ManualEntry'
import { SourceTag, StatusBadge, VerificationBadge } from '../components/attendance/AttendanceBadges'
import { clockText, durationText, initials } from '../components/attendance/format'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/attendance.css'
import { SkeletonLine, SkeletonTable } from '../components/common/Skeletons'

const PAGE_SIZE = 12
const NON_WORKING = ['rest-day', 'holiday']
const LOADING_MS = 250

const EMPTY_FILTERS = {
  search: '',
  position: '',
  shopId: '',
  status: '',
  verification: '',
  includeNonWorking: false,
}

function periodRangeText(period) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }
  return `${period.start.toLocaleDateString([], opts)} – ${period.end.toLocaleDateString([], opts)}`
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, tone, sub }) {
  return (
    <div className="sm-stat">
      <span className="sm-stat-label">{label}</span>
      <span className={`sm-stat-value${tone ? ` sm-stat-${tone}` : ''}`}>{value}</span>
      {sub && <span className="at-stat-sub">{sub}</span>}
    </div>
  )
}

/**
 * Attendance Management — daily and period attendance for HR, built on the
 * shared mock data (employees, shops, verification, leave).
 * Frontend and mock data only.
 */
export default function AttendanceManagement({ company, user, onChanged, focus = null }) {
  const today = accraTodayKey()
  const canCorrect = canCorrectAttendance(user)
  const canExport = can(user, 'attendance', 'export')

  // `focus` opens one employee's attendance history (e.g. from Employees or
  // Historical Import): their company, the period containing the date, and a
  // search for their employee ID.
  const [requestedCompany, setCompanyId] = useState(focus?.companyId ?? company.id)
  // The company filter can only narrow the user's own scope, never widen it.
  const myCompanies = authorisedCompanies(user)
  const allowedIds = myCompanies.map((c) => c.id)
  const allowedKey = allowedIds.join(',')
  const companyId = allowedIds.includes(requestedCompany) ? requestedCompany : allowedIds.length > 1 ? '' : allowedIds[0] ?? '__none'
  const [date, setDate] = useState(focus?.date && focus.date <= today ? focus.date : today)
  const [mode, setMode] = useState(focus ? 'period' : 'day')
  const [filters, setFilters] = useState(focus ? { ...EMPTY_FILTERS, search: focus.employeeId } : EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [periodRecords, setPeriodRecords] = useState([])
  const [detailKey, setDetailKey] = useState(null) // { employeeId, date }
  const [correction, setCorrection] = useState(null) // { employeeId?, date? }
  const [flash, setFlash] = useState('')
  // Records list, or Manual Attendance Entry (needs correction permission).
  const [view, setView] = useState('records')

  const isFuture = date > today
  const period = useMemo(() => periodForDateKey(date <= today ? date : today), [date, today])

  // Load the whole period (up to today) once; the day view is a slice of it.
  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      setPeriodRecords(
        listAttendanceRecords({
          companyId: companyId || null,
          dates: elapsedPeriodDateKeys(period, today),
        }).filter((r) => allowedIds.includes(r.companyId)),
      )
      setLoading(false)
    }, LOADING_MS)
    return () => clearTimeout(timer)
    // Reload only when the period (not just the day within it) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, allowedKey, period.key, today, refreshKey])

  const roster = useMemo(
    () => listAttendanceRoster(companyId || null).filter((e) => allowedIds.includes(e.companyId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, allowedKey, refreshKey],
  )

  const shops = useMemo(
    () => mockListAllShops().filter((s) => (companyId ? s.companyId === companyId : allowedIds.includes(s.companyId))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, allowedKey],
  )
  const positions = useMemo(
    () => Array.from(new Set(roster.map((e) => e.position))).sort(),
    [roster],
  )

  const setFilter = (name, value) => {
    setFilters((f) => ({ ...f, [name]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setCompanyId(company.id)
    setDate(today)
    setMode('day')
    setPage(1)
  }

  // Filters that define "who" (used by the summary figures too).
  const matchesWho = (r) => {
    const term = filters.search.trim().toLowerCase()
    if (term && !r.fullName.toLowerCase().includes(term) && !r.employeeId.toLowerCase().includes(term)) {
      return false
    }
    if (filters.position && r.position !== filters.position) return false
    if (filters.shopId && r.shopId !== filters.shopId) return false
    return true
  }

  const dayRecords = useMemo(
    () => (isFuture ? [] : periodRecords.filter((r) => r.date === date)),
    [periodRecords, date, isFuture],
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const whoDay = useMemo(() => dayRecords.filter(matchesWho), [dayRecords, filters])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const whoPeriod = useMemo(() => periodRecords.filter(matchesWho), [periodRecords, filters])

  const daySummary = useMemo(() => summariseAttendance(whoDay), [whoDay])
  const periodSummary = useMemo(() => summariseAttendance(whoPeriod), [whoPeriod])

  const tableRecords = useMemo(() => {
    const base = mode === 'day' ? whoDay : whoPeriod
    return base.filter((r) => {
      if (filters.status) {
        if (filters.status === 'late' ? !r.isLate : r.status !== filters.status) return false
      } else if (!filters.includeNonWorking && NON_WORKING.includes(r.status)) {
        return false
      }
      if (filters.verification && r.verification !== filters.verification) return false
      return true
    })
  }, [mode, whoDay, whoPeriod, filters])

  const pageCount = Math.max(1, Math.ceil(tableRecords.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRecords = tableRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const detailRecord = useMemo(
    () => (detailKey ? mockGetAttendanceRecord(detailKey.employeeId, detailKey.date) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailKey, refreshKey],
  )

  const companyName = companyId
    ? COMPANIES.find((c) => c.id === companyId)?.name
    : 'All my companies'
  const isTodaySelected = date === today
  const dayLabel = isTodaySelected ? 'today' : `on ${formatAccraDate(date, { day: 'numeric', month: 'short' })}`

  const exportCsv = () => {
    const scope = mode === 'day' ? date : `period-${period.key}`
    downloadCsv(
      `attendance-${companyId || 'all-companies'}-${scope}.csv`,
      attendanceRecordsToCsv(tableRecords),
    )
  }

  const handleSaved = (record) => {
    setCorrection(null)
    setRefreshKey((k) => k + 1)
    setFlash(
      `Attendance for ${record.fullName} on ${formatAccraDate(record.date)} was saved. The change is in the record's correction history.`,
    )
    onChanged?.()
  }

  const filtersActive =
    JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) ||
    companyId !== company.id ||
    date !== today ||
    mode !== 'day'

  return (
    <div className="sm-page at-page">
      <div className="sm-head">
        <div>
          <h2>Attendance Management</h2>
          <p>
            Daily attendance, verification and corrections. Attendance periods run from the 26th
            to the 25th · Africa/Accra time.
          </p>
        </div>
        <div className="at-head-actions">
          {canCorrect && (
            <button type="button" className="btn btn-primary at-btn" onClick={() => setCorrection({})}>
              Record attendance
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary at-btn"
            onClick={exportCsv}
            hidden={!canExport}
            disabled={loading || tableRecords.length === 0}
          >
            Export CSV
          </button>
        </div>
      </div>

      {flash && (
        <div className="at-flash" role="status">
          <span>{flash}</span>
          <button type="button" className="hr-link" onClick={() => setFlash('')}>Dismiss</button>
        </div>
      )}

      {canCorrect && (
        <div className="sm-tabs" role="tablist" aria-label="Attendance sections">
          <button type="button" role="tab" aria-selected={view === 'records'} className={`sm-tab${view === 'records' ? ' is-active' : ''}`} onClick={() => setView('records')}>Attendance records</button>
          <button type="button" role="tab" aria-selected={view === 'manual'} className={`sm-tab${view === 'manual' ? ' is-active' : ''}`} onClick={() => setView('manual')}>Manual Entry</button>
        </div>
      )}

      {view === 'manual' && canCorrect && (
        <ManualEntry
          user={user}
          defaultCompanyId={companyId}
          onSaved={() => {
            setRefreshKey((k) => k + 1)
            onChanged?.()
          }}
          onViewHistory={({ employeeId, companyId: cid, date: d }) => {
            setCompanyId(cid)
            setDate(d)
            setMode('period')
            setFilters({ ...EMPTY_FILTERS, search: employeeId })
            setPage(1)
            setView('records')
          }}
        />
      )}

      {view === 'records' && <>
      {/* Date and range */}
      <div className="sm-controls">
        <div className="sm-tabs" role="tablist" aria-label="Range">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'day'}
            className={`sm-tab${mode === 'day' ? ' is-active' : ''}`}
            onClick={() => { setMode('day'); setPage(1) }}
          >
            Selected day
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'period'}
            className={`sm-tab${mode === 'period' ? ' is-active' : ''}`}
            onClick={() => { setMode('period'); setPage(1) }}
          >
            Attendance period
          </button>
        </div>
        <input
          type="date"
          className="form-input"
          value={date}
          max={today}
          onChange={(e) => { setDate(e.target.value || today); setPage(1) }}
          aria-label="Attendance date"
        />
        <select
          className="sm-select"
          value={companyId}
          onChange={(e) => { setCompanyId(e.target.value); setFilters((f) => ({ ...f, shopId: '', position: '' })); setPage(1) }}
          aria-label="Company"
        >
          {myCompanies.length > 1 && <option value="">All my companies</option>}
          {myCompanies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="at-period-chip">
          {period.label} period · {periodRangeText(period)}
        </span>
      </div>

      {/* Daily summary */}
      <div className="sm-stats" role="status" aria-label={`Attendance summary ${dayLabel}`} aria-busy={loading}>
        <Stat label={`Present ${dayLabel}`} value={loading ? <SkeletonLine width="52px" size="xl" /> : daySummary.present} tone="ok" />
        <Stat label={`Absent ${dayLabel}`} value={loading ? <SkeletonLine width="52px" size="xl" /> : daySummary.absent} tone="crit" />
        <Stat label="Late arrivals" value={loading ? <SkeletonLine width="52px" size="xl" /> : daySummary.late} tone="warn" />
        <Stat
          label="Currently at work"
          value={loading ? <SkeletonLine width="52px" size="xl" /> : isTodaySelected ? daySummary.atWork : '—'}
          tone="accent"
          sub={isTodaySelected ? null : 'Only shown for today'}
        />
        <Stat label="On approved leave" value={loading ? <SkeletonLine width="52px" size="xl" /> : daySummary.onLeave} />
        <Stat label="Incomplete records" value={loading ? <SkeletonLine width="52px" size="xl" /> : daySummary.incomplete} tone="warn" />
      </div>

      {/* Filters */}
      <section className="sm-panel">
        <div className="at-filters">
          <input
            type="search"
            className="form-input sm-search"
            placeholder="Search name or employee ID…"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            aria-label="Search by employee name or ID"
          />
          <select className="sm-select" value={filters.position} onChange={(e) => setFilter('position', e.target.value)} aria-label="Filter by position">
            <option value="">All positions</option>
            {positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="sm-select" value={filters.shopId} onChange={(e) => setFilter('shopId', e.target.value)} aria-label="Filter by shop">
            <option value="">All shops</option>
            {shops.map((s) => <option key={s.shopId} value={s.shopId}>{s.shopName}</option>)}
          </select>
          <select className="sm-select" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Filter by attendance status">
            <option value="">All attendance statuses</option>
            {Object.entries(ATTENDANCE_STATUS).map(([id, s]) => (
              <option key={id} value={id}>{s.label}</option>
            ))}
          </select>
          <select className="sm-select" value={filters.verification} onChange={(e) => setFilter('verification', e.target.value)} aria-label="Filter by verification status">
            <option value="">All verification statuses</option>
            {Object.entries(VERIFICATION_STATUS).map(([id, s]) => (
              <option key={id} value={id}>{id === 'none' ? 'No verification' : s.label}</option>
            ))}
          </select>
          <label className="at-check">
            <input
              type="checkbox"
              checked={filters.includeNonWorking}
              disabled={Boolean(filters.status)}
              onChange={(e) => setFilter('includeNonWorking', e.target.checked)}
            />
            Show rest days &amp; holidays
          </label>
          <button type="button" className="hr-link at-clear" onClick={clearFilters} disabled={!filtersActive}>
            Clear filters
          </button>
        </div>

        <div className="sm-panel-head at-table-head">
          <h3>
            {mode === 'day'
              ? `Attendance records — ${formatAccraDate(date)}`
              : `Attendance records — ${period.label} period (to ${formatAccraDate(today, { day: 'numeric', month: 'short' })})`}
          </h3>
          <span className="sm-muted">
            {companyName} · {loading ? 'Loading records…' : `${tableRecords.length} record${tableRecords.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loading ? (
          <div className="at-skeleton" role="status" aria-label="Loading attendance records">
            <SkeletonTable rows={6} />
          </div>
        ) : isFuture ? (
          <p className="sm-empty">
            {formatAccraDate(date)} is in the future. No attendance exists yet, and future dates are
            never counted as absences.
          </p>
        ) : tableRecords.length === 0 ? (
          <div className="sm-empty">
            <p style={{ margin: 0 }}>
              {roster.length === 0
                ? `No employees are registered for ${companyName} yet.`
                : 'No attendance records match the selected filters.'}
            </p>
            {filtersActive && roster.length > 0 && (
              <button type="button" className="hr-link" onClick={clearFilters}>Clear filters</button>
            )}
          </div>
        ) : (
          <>
            <div className="sm-table-wrap">
              <table className="sm-table at-table">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Position &amp; shop</th>
                    <th scope="col">Date</th>
                    <th scope="col">Clock-in</th>
                    <th scope="col">Clock-out</th>
                    <th scope="col">Hours</th>
                    <th scope="col">Arrival status</th>
                    <th scope="col">Verification</th>
                    <th scope="col">Source</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((r) => (
                    <tr key={r.key}>
                      <td data-label="Employee">
                        <div className="sm-rep-cell">
                          {r.photo ? (
                            <img className="sm-avatar" src={r.photo} alt="" />
                          ) : (
                            <span className="sm-avatar sm-avatar-fallback">{initials(r.fullName)}</span>
                          )}
                          <span className="at-emp">
                            <span className="at-emp-name">{r.fullName}</span>
                            <span className="at-sub">
                              <span className="sm-mono">{r.employeeId}</span> · {r.companyName}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td data-label="Position & shop">
                        <span className="at-stack">
                          {r.position}
                          <span className="at-sub">
                            {r.shop ? r.shop.shopName : r.isFieldRole ? 'No shop assigned' : 'Office'}
                          </span>
                        </span>
                      </td>
                      <td data-label="Date" className="at-nowrap">
                        {formatAccraDate(r.date, { day: 'numeric', month: 'short' })}
                      </td>
                      <td data-label="Clock-in" className="at-time">{clockText(r.clockIn, r.clockInUnknown)}</td>
                      <td data-label="Clock-out" className="at-time">
                        {r.atWork ? <span className="at-sub">At work</span> : clockText(r.clockOut, r.clockOutUnknown)}
                      </td>
                      <td data-label="Hours" className="at-time">
                        {r.clockInUnknown || r.clockOutUnknown ? 'Unknown' : durationText(r.workingMinutes)}
                      </td>
                      <td data-label="Arrival status">
                        <span className="at-badges">
                          <StatusBadge status={r.status} />
                          {r.isLate && r.status === 'incomplete' && <StatusBadge status="late" />}
                        </span>
                      </td>
                      <td data-label="Verification">
                        <VerificationBadge verification={r.verification} />
                      </td>
                      <td data-label="Source">
                        <SourceTag record={r} />
                      </td>
                      <td data-label="Actions" className="at-actions">
                        <button
                          type="button"
                          className="sm-actions-btn"
                          onClick={() => setDetailKey({ employeeId: r.employeeId, date: r.date })}
                          aria-label={`View attendance for ${r.fullName} on ${r.date}`}
                        >
                          View
                        </button>
                        {canCorrect && r.status !== 'on-leave' && (
                          <button
                            type="button"
                            className="sm-actions-btn"
                            onClick={() => setCorrection({ employeeId: r.employeeId, date: r.date })}
                            aria-label={`Correct attendance for ${r.fullName} on ${r.date}`}
                          >
                            {r.hasAttendance ? 'Correct' : 'Record'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav className="at-pagination" aria-label="Attendance pages">
              <span className="sm-muted">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, tableRecords.length)} of {tableRecords.length}
              </span>
              <div className="at-pages">
                <button type="button" className="sm-actions-btn" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  Previous
                </button>
                <span className="at-page-num">Page {currentPage} of {pageCount}</span>
                <button type="button" className="sm-actions-btn" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </section>

      {/* Period summary */}
      <section className="sm-panel">
        <div className="sm-panel-head">
          <h3>Period summary — {period.label}</h3>
          <span className="sm-muted">
            {periodRangeText(period)} · {companyName} · counted up to {formatAccraDate(today, { day: 'numeric', month: 'short' })}
          </span>
        </div>
        <div className="at-period-grid" aria-busy={loading}>
          <Stat label="Present (incl. late)" value={loading ? <SkeletonLine width="52px" size="xl" /> : periodSummary.present} tone="ok" sub="employee-days" />
          <Stat label="Absent" value={loading ? <SkeletonLine width="52px" size="xl" /> : periodSummary.absent} tone="crit" sub="employee-days" />
          <Stat label="Late" value={loading ? <SkeletonLine width="52px" size="xl" /> : periodSummary.late} tone="warn" sub="arrivals" />
          <Stat label="On leave" value={loading ? <SkeletonLine width="52px" size="xl" /> : periodSummary.onLeave} sub="employee-days" />
          <Stat label="Incomplete" value={loading ? <SkeletonLine width="52px" size="xl" /> : periodSummary.incomplete} tone="warn" sub="records" />
          <Stat label="Total working hours" value={loading ? <SkeletonLine width="52px" size="xl" /> : periodSummary.totalHours.toLocaleString()} tone="accent" sub="completed records" />
        </div>
        <p className="at-rules">
          Future dates, rest days, public holidays and approved leave are never counted as absences.
          Nobody is absent before the working day has ended. Missed SMS verifications are reviewed as
          exceptions, not absences.
          {periodSummary.unknown > 0 &&
            ` ${periodSummary.unknown} historical day${periodSummary.unknown === 1 ? ' is' : 's are'} Unknown because the register entry is missing.`}
        </p>
      </section>

      </>}

      <p className="mock-banner" style={{ textAlign: 'center', margin: 0 }}>
        Demo data — face, GPS and SMS verification results are simulated, not genuine evidence. Manual Entry records are never verified.
      </p>

      {detailRecord && (
        <AttendanceDetailModal
          record={detailRecord}
          canCorrect={canCorrect}
          onClose={() => setDetailKey(null)}
          onCorrect={(r) => {
            setDetailKey(null)
            setCorrection({ employeeId: r.employeeId, date: r.date })
          }}
        />
      )}

      {correction && (
        <CorrectionModal
          roster={roster}
          initial={correction}
          user={user}
          onClose={() => setCorrection(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
