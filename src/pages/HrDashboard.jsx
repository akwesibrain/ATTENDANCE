import { useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import { mockListEmployees } from '../services/registrationService'
import { mockListAttendanceEvents } from '../services/attendanceService'
import '../styles/registration.css'
import '../styles/hr.css'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'employees', label: 'Employees' },
  { id: 'attendance', label: 'Attendance' },
]

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

/**
 * HR dashboard (frontend, mock-backed).
 * Overview stats, employee directory, and attendance records with filters.
 * Data comes from the mock services; the real backend will provide it.
 */
export default function HrDashboard({ onBack }) {
  const [tab, setTab] = useState('overview')
  const [companyFilter, setCompanyFilter] = useState('')
  const [dateFilter, setDateFilter] = useState(todayKey())
  const [search, setSearch] = useState('')

  const employees = useMemo(() => mockListEmployees(), [])
  const allEvents = useMemo(() => mockListAttendanceEvents(), [])

  const stats = useMemo(() => {
    const today = todayKey()
    const todayEvents = allEvents.filter((e) => e.date === today)
    const checkIns = todayEvents.filter((e) => e.type === 'check-in')
    const late = checkIns.filter((e) => e.status === 'late')
    const checkOuts = todayEvents.filter((e) => e.type === 'check-out')
    return {
      totalEmployees: employees.length,
      checkedInToday: checkIns.length,
      lateToday: late.length,
      checkedOutToday: checkOuts.length,
    }
  }, [employees, allEvents])

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase()
    return employees.filter((emp) => {
      const matchesCompany = !companyFilter || emp.companyName === companyFilter
      const matchesSearch =
        !term ||
        emp.fullName.toLowerCase().includes(term) ||
        emp.staffId.toLowerCase().includes(term) ||
        emp.position.toLowerCase().includes(term)
      return matchesCompany && matchesSearch
    })
  }, [employees, companyFilter, search])

  const filteredEvents = useMemo(
    () =>
      mockListAttendanceEvents({
        date: dateFilter || undefined,
        companyName: companyFilter || undefined,
      }),
    [dateFilter, companyFilter],
  )

  return (
    <main className="registration-page hr-page">
      <div className="hr-shell">
        <header className="hr-header">
          <div className="registration-brand" style={{ padding: 0 }}>
            <span className="registration-brand-mark" aria-hidden="true">
              WA
            </span>
            <span>
              Workforce Attendance
              <span className="hr-subtitle">HR Dashboard</span>
            </span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back to Home
          </button>
        </header>

        <nav className="hr-tabs" aria-label="HR dashboard sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`hr-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <section className="hr-overview">
            <div className="stat-card">
              <span className="stat-value">{stats.totalEmployees}</span>
              <span className="stat-label">Total Employees</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats.checkedInToday}</span>
              <span className="stat-label">Checked In Today</span>
            </div>
            <div className="stat-card stat-late">
              <span className="stat-value">{stats.lateToday}</span>
              <span className="stat-label">Late Today</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats.checkedOutToday}</span>
              <span className="stat-label">Checked Out Today</span>
            </div>
          </section>
        )}

        {tab === 'employees' && (
          <section className="card hr-card">
            <div className="hr-toolbar">
              <input
                type="search"
                className="form-input hr-search"
                placeholder="Search name, Staff ID or position…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search employees"
              />
              <select
                className="form-select hr-filter"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                aria-label="Filter by company"
              >
                <option value="">All companies</option>
                {COMPANIES.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="hr-table-wrap">
              <table className="hr-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Staff ID</th>
                    <th>Company</th>
                    <th>Position</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.staffId}>
                      <td>
                        <div className="hr-employee">
                          {emp.faceImage ? (
                            <img className="hr-avatar" src={emp.faceImage} alt="" />
                          ) : (
                            <span className="hr-avatar hr-avatar-fallback" aria-hidden="true">
                              {emp.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                            </span>
                          )}
                          <span>{emp.fullName}</span>
                        </div>
                      </td>
                      <td className="hr-mono">{emp.staffId}</td>
                      <td>{emp.companyName}</td>
                      <td>{emp.position}</td>
                      <td>
                        <span className="status-badge">{emp.status}</span>
                      </td>
                    </tr>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan="5" className="hr-empty">
                        No employees found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'attendance' && (
          <section className="card hr-card">
            <div className="hr-toolbar">
              <input
                type="date"
                className="form-input hr-filter"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by date"
              />
              <select
                className="form-select hr-filter"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                aria-label="Filter by company"
              >
                <option value="">All companies</option>
                {COMPANIES.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="hr-table-wrap">
              <table className="hr-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Staff ID</th>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{event.fullName}</td>
                      <td className="hr-mono">{event.staffId}</td>
                      <td>{event.companyName}</td>
                      <td>
                        <span className={`hr-type hr-type-${event.type}`}>
                          {event.type === 'check-in' ? 'Check In' : 'Check Out'}
                        </span>
                      </td>
                      <td>{new Date(event.time).toLocaleTimeString()}</td>
                      <td>
                        {event.status === 'late' ? (
                          <span className="status-badge status-late">LATE</span>
                        ) : (
                          <span className="status-badge">ON TIME</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredEvents.length === 0 && (
                    <tr>
                      <td colSpan="6" className="hr-empty">
                        No attendance records for this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="mock-banner" style={{ textAlign: 'center' }}>
          Demo environment — HR data is read from the mock services, not a
          production backend.
        </p>
      </div>
    </main>
  )
}
