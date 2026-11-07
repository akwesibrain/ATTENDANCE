import { useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import { mockListEmployees } from '../services/registrationService'
import { mockGetAllEvents } from '../services/attendanceService'
import {
  getPayPeriod,
  listPayPeriods,
  payPeriodDates,
} from '../utils/payPeriod'
import '../styles/hr.css'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'employees', label: 'Employees', icon: 'users' },
  { id: 'attendance', label: 'Attendance', icon: 'clock' },
  { id: 'reports', label: 'Reports', icon: 'report' },
]

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatPeriodDate(date) {
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const TIER_LABELS = {
  perfect: 'Perfect',
  excellent: 'Excellent',
  good: 'Good',
  'needs-attention': 'Needs Attention',
}

function Icon({ name, size = 20 }) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    report: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
      </>
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5M12 15V3" />
      </>
    ),
    print: (
      <>
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
    building: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="1" />
        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

/**
 * HR dashboard (frontend, mock-backed) — sidebar admin layout.
 */
export default function HrDashboard({ onBack }) {
  const [activeNav, setActiveNav] = useState('dashboard')
  const [companyId, setCompanyId] = useState(COMPANIES[0].id)
  const [search, setSearch] = useState('')
  const [attendanceDate, setAttendanceDate] = useState(todayKey())
  // The reporting month (pay period) selected in the Reports view.
  const [reportPeriodKey, setReportPeriodKey] = useState(() => getPayPeriod().key)

  const company = COMPANIES.find((c) => c.id === companyId) ?? COMPANIES[0]

  const employees = useMemo(() => mockListEmployees(), [])
  const allEvents = useMemo(() => mockGetAllEvents(), [])

  const companyEmployees = useMemo(
    () => employees.filter((e) => e.companyName === company.name),
    [employees, company],
  )
  const companyEvents = useMemo(
    () => allEvents.filter((e) => e.companyName === company.name),
    [allEvents, company],
  )

  const stats = useMemo(() => {
    const today = todayKey()
    const todayEvents = companyEvents.filter((e) => e.date === today)
    const checkIns = todayEvents.filter((e) => e.type === 'check-in')
    const late = checkIns.filter((e) => e.status === 'late')
    const checkOuts = todayEvents.filter((e) => e.type === 'check-out')
    const total = companyEmployees.length
    const present = checkIns.length
    const absent = Math.max(total - present, 0)
    const currentlyIn = Math.max(present - checkOuts.length, 0)
    const rate = total ? Math.round((present / total) * 1000) / 10 : 0
    return { total, present, absent, late: late.length, currentlyIn, rate }
  }, [companyEmployees, companyEvents])

  // One row per employee for the selected date: their check-in time,
  // check-out time and derived status (Late / On time / Absent).
  const attendanceRows = useMemo(() => {
    return companyEmployees.map((emp) => {
      const empEvents = companyEvents.filter(
        (e) => e.staffId === emp.staffId && e.date === attendanceDate,
      )
      const checkIn = empEvents.find((e) => e.type === 'check-in')
      const checkOut = empEvents.find((e) => e.type === 'check-out')
      const absentMark = empEvents.find((e) => e.type === 'absent')
      let status = null
      if (checkIn) status = checkIn.status === 'late' ? 'late' : 'on-time'
      return { emp, checkIn, checkOut, absentMark, status }
    })
  }, [companyEmployees, companyEvents, attendanceDate])

  // Today's register: one row per employee for today, present first, then
  // late, then absent — so who needs attention rises to the top.
  const todayRows = useMemo(() => {
    const today = todayKey()
    const rows = companyEmployees.map((emp) => {
      const empEvents = companyEvents.filter(
        (e) => e.staffId === emp.staffId && e.date === today,
      )
      const checkIn = empEvents.find((e) => e.type === 'check-in')
      const checkOut = empEvents.find((e) => e.type === 'check-out')
      const absentMark = empEvents.find((e) => e.type === 'absent')
      let status = null
      if (checkIn) status = checkIn.status === 'late' ? 'late' : 'on-time'
      return { emp, checkIn, checkOut, absentMark, status }
    })
    const rank = (r) => (r.status === 'on-time' ? 0 : r.status === 'late' ? 1 : 2)
    return rows.sort((a, b) => rank(a) - rank(b))
  }, [companyEmployees, companyEvents])

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return companyEmployees
    return companyEmployees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(term) ||
        e.staffId.toLowerCase().includes(term) ||
        e.position.toLowerCase().includes(term),
    )
  }, [companyEmployees, search])

  // Number of distinct days each employee came to work (days with a check-in).
  const daysWorkedByStaffId = useMemo(() => {
    const map = {}
    companyEvents.forEach((e) => {
      if (e.type !== 'check-in') return
      if (!map[e.staffId]) map[e.staffId] = new Set()
      map[e.staffId].add(e.date)
    })
    const counts = {}
    Object.keys(map).forEach((staffId) => {
      counts[staffId] = map[staffId].size
    })
    return counts
  }, [companyEvents])

  /* ---------- Monthly report (pay period: 26th to 25th) ---------- */

  const reportPeriods = useMemo(() => listPayPeriods(12), [])
  const reportPeriod = useMemo(
    () => reportPeriods.find((p) => p.key === reportPeriodKey) ?? reportPeriods[0],
    [reportPeriods, reportPeriodKey],
  )

  // One report row per employee: total days in the period, days present, late
  // days, absent days, attendance rate and a status tier.
  const reportRows = useMemo(() => {
    const dates = new Set(payPeriodDates(reportPeriod))
    const totalDays = dates.size
    return companyEmployees.map((emp) => {
      const empEvents = companyEvents.filter(
        (e) => e.staffId === emp.staffId && dates.has(e.date),
      )
      const checkIns = empEvents.filter((e) => e.type === 'check-in')
      const present = new Set(checkIns.map((e) => e.date)).size
      const late = new Set(
        checkIns.filter((e) => e.status === 'late').map((e) => e.date),
      ).size
      const absent = Math.max(totalDays - present, 0)
      const rate = totalDays ? (present / totalDays) * 100 : 0
      let tier = 'needs-attention'
      if (rate >= 99) tier = 'perfect'
      else if (rate >= 95) tier = 'excellent'
      else if (rate >= 90) tier = 'good'
      return { emp, totalDays, present, late, absent, rate, tier }
    })
  }, [companyEmployees, companyEvents, reportPeriod])

  // Download the current report as a CSV file.
  const downloadReport = () => {
    const header = ['#', 'Employee Name', 'Employee ID', 'Position', 'Total Days', 'Present', 'Late', 'Absent', 'Attendance Rate', 'Status']
    const lines = reportRows.map((r, i) => [
      i + 1,
      r.emp.fullName,
      r.emp.staffId,
      r.emp.position,
      r.totalDays,
      r.present,
      r.late,
      r.absent,
      `${r.rate.toFixed(1)}%`,
      TIER_LABELS[r.tier],
    ])
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-report-${company.id}-${reportPeriod.key}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="hr-layout">
      {/* Sidebar */}
      <aside className="hr-sidebar">
        <div className="hr-brand">
          <span className="hr-brand-mark" aria-hidden="true">
            <Icon name="building" size={22} />
          </span>
          <span className="hr-brand-text">
            WorkForce Pro
            <span>Manage · Track · Grow</span>
          </span>
        </div>

        <nav className="hr-nav" aria-label="HR sections">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`hr-nav-item ${activeNav === item.id ? 'is-active' : ''}`}
              onClick={() => setActiveNav(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="hr-sidebar-footer">
          {company.logo ? (
            <img
              className={`hr-footer-logo hr-footer-logo-${company.id}`}
              src={company.logo}
              alt={`${company.name} logo`}
            />
          ) : (
            <span className="hr-brand-mark" aria-hidden="true">
              <Icon name="building" size={20} />
            </span>
          )}
          <span>
            {company.name}
            <span className="hr-footer-sub">Admin Portal</span>
          </span>
        </div>
      </aside>

      {/* Main */}
      <div className="hr-main">
        {/* Top bar */}
        <header className="hr-topbar">
          <div className="hr-company-switch">
            <label className="sr-only" htmlFor="company-select">Company</label>
            <select
              id="company-select"
              className="hr-company-select"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              {COMPANIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="hr-topbar-right">
            <button type="button" className="hr-icon-btn" aria-label="Notifications">
              <Icon name="bell" />
              <span className="hr-badge">3</span>
            </button>
            <div className="hr-profile">
              <span className="hr-avatar-lg hr-avatar-fallback">JM</span>
              <span className="hr-profile-text">
                John Mensah
                <span>HR Manager</span>
              </span>
            </div>
            <button type="button" className="btn btn-secondary hr-exit" onClick={onBack}>
              Exit
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="hr-content">
          <div className="hr-welcome">
            <div>
              <h1>{company.name}</h1>
              <p>
                {new Date(`${todayKey()}T00:00:00`).toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <span className="hr-today">
              <Icon name="clock" size={16} /> Today
            </span>
          </div>

          {activeNav === 'dashboard' && (
            <>
              {/* The four numbers HR needs, as a clean stat strip. The day's
                  register below stays the hero. */}
              <div className="hr-stats" role="status" aria-label="Today's attendance summary">
                <div className="hr-stat">
                  <span className="hr-stat-label">Total employees</span>
                  <span className="hr-stat-value">{stats.total}</span>
                </div>
                <div className="hr-stat">
                  <span className="hr-stat-label">Present today</span>
                  <span className="hr-stat-value hr-stat-ok">{stats.present}</span>
                </div>
                <div className="hr-stat">
                  <span className="hr-stat-label">Absent today</span>
                  <span className="hr-stat-value hr-stat-crit">{stats.absent}</span>
                </div>
                <div className="hr-stat">
                  <span className="hr-stat-label">Late coming</span>
                  <span className="hr-stat-value hr-stat-warn">{stats.late}</span>
                </div>
              </div>

              <section className="hr-panel hr-register">
                <div className="hr-panel-head">
                  <h2>Today&apos;s register</h2>
                  <button
                    type="button"
                    className="hr-link"
                    onClick={() => setActiveNav('attendance')}
                  >
                    Full attendance →
                  </button>
                </div>
                <div className="hr-table-wrap">
                  <table className="hr-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Staff ID</th>
                        <th>Check in</th>
                        <th>Check out</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayRows.map(({ emp, checkIn, checkOut, absentMark, status }) => (
                        <tr key={emp.staffId}>
                          <td>
                            <div className="hr-employee">
                              {emp.faceImage ? (
                                <img className="hr-avatar" src={emp.faceImage} alt="" />
                              ) : (
                                <span className="hr-avatar hr-avatar-fallback">
                                  {emp.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                                </span>
                              )}
                              {emp.fullName}
                            </div>
                          </td>
                          <td className="hr-mono">{emp.staffId}</td>
                          <td className="hr-time">
                            {checkIn ? formatTime(checkIn.time) : '—'}
                          </td>
                          <td className="hr-time">
                            {checkOut ? formatTime(checkOut.time) : '—'}
                          </td>
                          <td>
                            {status === 'late' ? (
                              <span className="status-badge status-late">Late</span>
                            ) : status === 'on-time' ? (
                              <span className="status-badge">On time</span>
                            ) : (
                              <span
                                className="status-badge status-absent"
                                title={absentMark?.reason}
                              >
                                Absent
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {todayRows.length === 0 && (
                        <tr>
                          <td colSpan="5" className="hr-empty">
                            No employees registered for {company.name} yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeNav === 'employees' && (
            <section className="hr-panel">
              <div className="hr-panel-head">
                <h2>Employees — {company.name}</h2>
                <input
                  type="search"
                  className="form-input hr-search"
                  placeholder="Search name, Staff ID or position…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search employees"
                />
              </div>
              <table className="hr-table">
                <thead>
                  <tr><th>Employee</th><th>Staff ID</th><th>Position</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.staffId}>
                      <td>
                        <div className="hr-employee">
                          {emp.faceImage ? (
                            <img className="hr-avatar" src={emp.faceImage} alt="" />
                          ) : (
                            <span className="hr-avatar hr-avatar-fallback">
                              {emp.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                            </span>
                          )}
                          {emp.fullName}
                        </div>
                      </td>
                      <td className="hr-mono">{emp.staffId}</td>
                      <td>{emp.position}</td>
                      <td><span className="status-badge">{emp.status}</span></td>
                    </tr>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <tr><td colSpan="4" className="hr-empty">No employees found.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}

          {activeNav === 'attendance' && (
            <section className="hr-panel">
              <div className="hr-panel-head">
                <h2>Attendance — {company.name}</h2>
                <input
                  type="date"
                  className="form-input hr-date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  aria-label="Attendance date"
                />
              </div>
              <table className="hr-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Staff ID</th>
                    <th>Position</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Date</th>
                    <th>Days</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceRows.map(({ emp, checkIn, checkOut, absentMark, status }) => (
                    <tr key={emp.staffId}>
                      <td>
                        <div className="hr-employee">
                          {emp.faceImage ? (
                            <img className="hr-avatar" src={emp.faceImage} alt="" />
                          ) : (
                            <span className="hr-avatar hr-avatar-fallback">
                              {emp.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                            </span>
                          )}
                          {emp.fullName}
                        </div>
                      </td>
                      <td className="hr-mono">{emp.staffId}</td>
                      <td>{emp.position}</td>
                      <td>{checkIn ? new Date(checkIn.time).toLocaleTimeString() : '—'}</td>
                      <td>{checkOut ? new Date(checkOut.time).toLocaleTimeString() : '—'}</td>
                      <td>{new Date(`${attendanceDate}T00:00:00`).toLocaleDateString()}</td>
                      <td>{daysWorkedByStaffId[emp.staffId] ?? 0}</td>
                      <td>
                        {status === 'late' ? (
                          <span className="status-badge status-late">LATE</span>
                        ) : status === 'on-time' ? (
                          <span className="status-badge">ON TIME</span>
                        ) : absentMark ? (
                          <span
                            className="status-badge status-absent"
                            title={absentMark.reason}
                          >
                            ABSENT
                          </span>
                        ) : (
                          <span className="status-badge status-absent">ABSENT</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {attendanceRows.length === 0 && (
                    <tr><td colSpan="8" className="hr-empty">No employees found.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}

          {activeNav === 'reports' && (
            <section className="hr-panel hr-report">
              <div className="hr-report-head">
                <div className="hr-report-title">
                  <span className="hr-report-icon" aria-hidden="true">
                    <Icon name="report" size={20} />
                  </span>
                  <div>
                    <h2>Employee Attendance Details</h2>
                    <p className="hr-report-sub">
                      {reportPeriod.label} · {formatPeriodDate(reportPeriod.start)} to{' '}
                      {formatPeriodDate(reportPeriod.end)}
                    </p>
                  </div>
                </div>
                <div className="hr-report-actions">
                  <label className="sr-only" htmlFor="report-period">Report month</label>
                  <select
                    id="report-period"
                    className="hr-company-select hr-report-period"
                    value={reportPeriod.key}
                    onChange={(e) => setReportPeriodKey(e.target.value)}
                  >
                    {reportPeriods.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary hr-report-btn"
                    onClick={downloadReport}
                  >
                    <Icon name="download" size={16} /> Download Report
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary hr-report-btn"
                    onClick={() => window.print()}
                  >
                    <Icon name="print" size={16} /> Print
                  </button>
                </div>
              </div>

              <div className="hr-table-wrap">
                <table className="hr-table hr-report-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Employee Name</th>
                      <th>Employee ID</th>
                      <th>Position</th>
                      <th className="hr-num">Total Days</th>
                      <th className="hr-num">Present</th>
                      <th className="hr-num">Late</th>
                      <th className="hr-num">Absent</th>
                      <th className="hr-num">Attendance Rate</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map(({ emp, totalDays, present, late, absent, rate, tier }, i) => (
                      <tr key={emp.staffId}>
                        <td className="hr-num hr-rownum">{i + 1}</td>
                        <td>
                          <div className="hr-employee">
                            {emp.faceImage ? (
                              <img className="hr-avatar" src={emp.faceImage} alt="" />
                            ) : (
                              <span className="hr-avatar hr-avatar-fallback">
                                {emp.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                              </span>
                            )}
                            {emp.fullName}
                          </div>
                        </td>
                        <td className="hr-mono">{emp.staffId}</td>
                        <td>{emp.position}</td>
                        <td className="hr-num">{totalDays}</td>
                        <td className="hr-num">{present}</td>
                        <td className="hr-num">
                          {late > 0 ? <span className="hr-cell-warn">{late}</span> : late}
                        </td>
                        <td className="hr-num">
                          {absent > 0 ? <span className="hr-cell-crit">{absent}</span> : absent}
                        </td>
                        <td className="hr-num hr-rate">{rate.toFixed(1)}%</td>
                        <td>
                          <span className={`report-tier report-tier-${tier}`}>
                            {TIER_LABELS[tier]}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {reportRows.length === 0 && (
                      <tr>
                        <td colSpan="10" className="hr-empty">
                          No employees registered for {company.name} yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="mock-banner" style={{ textAlign: 'center' }}>
            Demo environment — HR data is read from the mock services, not a production backend.
          </p>
        </div>
      </div>
    </div>
  )
}
