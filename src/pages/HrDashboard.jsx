import { useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import { mockListEmployees } from '../services/registrationService'
import { mockGetAllEvents } from '../services/attendanceService'
import '../styles/hr.css'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'employees', label: 'Employees', icon: 'users' },
  { id: 'attendance', label: 'Attendance', icon: 'clock' },
]

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
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
    check: <path d="M20 6L9 17l-5-5" />,
    x: (
      <>
        <path d="M18 6L6 18M6 6l12 12" />
      </>
    ),
    login: <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />,
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

function Sparkline({ points, color }) {
  const w = 200
  const h = 44
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const step = w / (points.length - 1 || 1)
  const coords = points.map((p, i) => [i * step, h - 6 - ((p - min) / range) * (h - 12)])
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" />
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

  const recentRegistrations = useMemo(() => companyEmployees.slice(0, 5), [companyEmployees])
  const recentCheckIns = useMemo(
    () => companyEvents.filter((e) => e.type === 'check-in').slice().reverse().slice(0, 5),
    [companyEvents],
  )

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

  const spark = {
    total: [3, 4, 3, 5, 4, 6, 5, stats.total],
    present: [2, 3, 2, 4, 3, 4, 3, stats.present],
    absent: [1, 0, 1, 1, 0, 1, 0, stats.absent],
    late: [0, 1, 0, 0, 1, 0, 1, stats.late],
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
              <h1>Welcome back, John!</h1>
              <p>Here&apos;s what&apos;s happening at {company.name} today.</p>
            </div>
            <span className="hr-today">
              <Icon name="clock" size={16} /> Today
            </span>
          </div>

          {activeNav === 'dashboard' && (
            <>
              {/* Stat cards */}
              <div className="hr-stats">
                <div className="hr-stat">
                  <div className="hr-stat-head">
                    <span className="hr-stat-icon icon-blue"><Icon name="users" /></span>
                    <span className="hr-stat-title">Total Employees</span>
                  </div>
                  <div className="hr-stat-value">{stats.total}</div>
                  <Sparkline points={spark.total} color="#1c6fe0" />
                </div>

                <div className="hr-stat">
                  <div className="hr-stat-head">
                    <span className="hr-stat-icon icon-green"><Icon name="check" /></span>
                    <span className="hr-stat-title">Present Today</span>
                  </div>
                  <div className="hr-stat-value">{stats.present}</div>
                  <Sparkline points={spark.present} color="#16834b" />
                </div>

                <div className="hr-stat">
                  <div className="hr-stat-head">
                    <span className="hr-stat-icon icon-red"><Icon name="x" /></span>
                    <span className="hr-stat-title">Absent Today</span>
                  </div>
                  <div className="hr-stat-value">{stats.absent}</div>
                  <Sparkline points={spark.absent} color="#d94a4a" />
                </div>

                <div className="hr-stat">
                  <div className="hr-stat-head">
                    <span className="hr-stat-icon icon-amber"><Icon name="clock" /></span>
                    <span className="hr-stat-title">Late Arrivals</span>
                  </div>
                  <div className="hr-stat-value">{stats.late}</div>
                  <Sparkline points={spark.late} color="#e9a23b" />
                </div>

                <div className="hr-stat">
                  <div className="hr-stat-head">
                    <span className="hr-stat-icon icon-blue"><Icon name="login" /></span>
                    <span className="hr-stat-title">Currently Checked In</span>
                  </div>
                  <div className="hr-stat-value">{stats.currentlyIn}</div>
                </div>

                <div className="hr-stat">
                  <div className="hr-stat-head">
                    <span className="hr-stat-title">Attendance Rate</span>
                  </div>
                  <div className="hr-rate">
                    <span className="hr-stat-value">{stats.rate}%</span>
                  </div>
                </div>
              </div>

              {/* Recent lists */}
              <div className="hr-panels">
                <section className="hr-panel">
                  <div className="hr-panel-head">
                    <h2>Recent Registrations</h2>
                    <button type="button" className="hr-link" onClick={() => setActiveNav('employees')}>
                      View All →
                    </button>
                  </div>
                  <table className="hr-table">
                    <thead>
                      <tr><th>Employee</th><th>Staff ID</th><th>Position</th></tr>
                    </thead>
                    <tbody>
                      {recentRegistrations.map((emp) => (
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
                        </tr>
                      ))}
                      {recentRegistrations.length === 0 && (
                        <tr><td colSpan="3" className="hr-empty">No registrations yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </section>

                <section className="hr-panel">
                  <div className="hr-panel-head">
                    <h2>Recent Check-Ins</h2>
                    <button type="button" className="hr-link" onClick={() => setActiveNav('attendance')}>
                      View All →
                    </button>
                  </div>
                  <table className="hr-table">
                    <thead>
                      <tr><th>Employee</th><th>Staff ID</th><th>Time</th></tr>
                    </thead>
                    <tbody>
                      {recentCheckIns.map((ev) => (
                        <tr key={ev.id}>
                          <td>{ev.fullName}</td>
                          <td className="hr-mono">{ev.staffId}</td>
                          <td>{new Date(ev.time).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                      {recentCheckIns.length === 0 && (
                        <tr><td colSpan="3" className="hr-empty">No check-ins yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </section>
              </div>
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

          <p className="mock-banner" style={{ textAlign: 'center' }}>
            Demo environment — HR data is read from the mock services, not a production backend.
          </p>
        </div>
      </div>
    </div>
  )
}
