import { useMemo, useState } from 'react'
import { CATEGORIES } from '../constants/employeeCategories'
import { listAttendanceRecords } from '../services/attendanceRecordsService'
import { VISIT_RESULT, outletLabel } from '../services/fieldVisitsService'
import { accraTodayKey, formatAccraDate, formatAccraTime } from '../utils/accraTime'
import { StatusBadge } from '../components/attendance/AttendanceBadges'
import '../styles/sales-monitoring.css'
import '../styles/attendance.css'

function hours(minutes) {
  if (minutes == null) return '—'
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`
}

/**
 * Sales Representative / Supervisor monitoring. These employees move between
 * outlets, so instead of one allocated shop they record a visit (face scan +
 * the phone's location) at each outlet. HR sees each person's day and every
 * visit with its location result. They have no scheduled break.
 */
export default function FieldVisitsMonitoring({ company, category, onOpenAttendance }) {
  const meta = CATEGORIES[category]
  const today = accraTodayKey()
  const [date, setDate] = useState(today)
  const [employeeId, setEmployeeId] = useState('')
  const [open, setOpen] = useState(null)

  const records = useMemo(
    () => listAttendanceRecords({ companyId: company.id, dates: [date] }).filter((r) => r.category === category),
    [company.id, date, category],
  )
  const shown = employeeId ? records.filter((r) => r.employeeId === employeeId) : records
  const visits = shown.flatMap((r) => r.visits.map((v) => ({ ...v, record: r }))).sort((a, b) => a.time.localeCompare(b.time))
  const count = (status) => visits.filter((v) => v.verification?.status === status).length
  const stats = {
    employees: shown.length,
    working: shown.filter((r) => r.hasAttendance).length,
    visits: visits.length,
    outside: count('outside'),
    noLocation: count('location-unavailable'),
  }

  return (
    <div className="sm-page">
      <div className="sm-head">
        <div>
          <h2>{meta.single} Monitoring</h2>
          <p>
            {category === 'supervisor'
              ? 'Supervisors visit larger outlets such as China Mall and Melcom and move between several shops. Each visit is recorded with a face scan and the phone’s location.'
              : 'Sales Representatives visit mini-markets for the company. Each visit is recorded with a face scan and the phone’s location.'}
            {' '}Company working hours apply; there is no scheduled break.
          </p>
        </div>
      </div>

      <div className="sm-controls">
        <label className="sr-only" htmlFor={`fv-date-${category}`}>Date</label>
        <input id={`fv-date-${category}`} type="date" className="sm-select" max={today} value={date} onChange={(e) => setDate(e.target.value > today ? today : e.target.value)} />
        <label className="sr-only" htmlFor={`fv-emp-${category}`}>Employee</label>
        <select id={`fv-emp-${category}`} className="sm-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">All {meta.label.toLowerCase()}</option>
          {records.map((r) => <option key={r.employeeId} value={r.employeeId}>{r.fullName} ({r.employeeId})</option>)}
        </select>
        <span className="at-period-chip">{company.name} · {formatAccraDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>

      <div className="sm-stats" role="status" aria-label={`${meta.label} summary`}>
        <div className="sm-stat"><span className="sm-stat-label">{meta.label}</span><span className="sm-stat-value">{stats.employees}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Clocked in</span><span className="sm-stat-value sm-stat-ok">{stats.working}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Outlet visits</span><span className="sm-stat-value sm-stat-accent">{stats.visits}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Outside outlet geofence</span><span className="sm-stat-value sm-stat-crit">{stats.outside}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Visits without location</span><span className="sm-stat-value sm-stat-warn">{stats.noLocation}</span></div>
      </div>

      <section className="sm-panel">
        <div className="sm-panel-head"><h3>{meta.label}</h3><span className="sm-muted">{shown.length} employee{shown.length === 1 ? '' : 's'}</span></div>
        {records.length === 0 ? (
          <p className="sm-empty">
            No {meta.label.toLowerCase()} are registered for {company.name}. Employees registered with the job position
            “{meta.single}” appear here.
          </p>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table">
              <thead>
                <tr><th scope="col">Employee</th><th scope="col">Status</th><th scope="col">Clock-in</th><th scope="col">Clock-out</th><th scope="col">Working hours</th><th scope="col">Visits</th><th scope="col">Last visit</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const last = r.visits[r.visits.length - 1]
                  return (
                    <tr key={r.employeeId}>
                      <td data-label="Employee"><span className="at-stack"><span className="at-emp-name">{r.fullName}</span><span className="at-sub"><span className="sm-mono">{r.employeeId}</span></span></span></td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Clock-in" className="at-time">{r.clockIn ? formatAccraTime(r.clockIn) : '—'}</td>
                      <td data-label="Clock-out" className="at-time">{r.atWork ? 'At work' : r.clockOut ? formatAccraTime(r.clockOut) : '—'}</td>
                      <td data-label="Working hours" className="at-time">{hours(r.workingMinutes)}</td>
                      <td data-label="Visits" className="at-time">{r.visits.length}</td>
                      <td data-label="Last visit">{last ? <span className="at-stack">{outletLabel(last.outlet)}<span className="at-sub">{formatAccraTime(last.time)} · {VISIT_RESULT[last.verification?.status]?.short}</span></span> : <span className="at-none">No visits</span>}</td>
                      <td data-label="Actions" className="at-actions">
                        {r.visits.length > 0 && <button type="button" className="sm-actions-btn" onClick={() => setOpen(open === r.employeeId ? null : r.employeeId)} aria-expanded={open === r.employeeId}>{open === r.employeeId ? 'Hide visits' : 'Visits'}</button>}
                        {onOpenAttendance && <button type="button" className="sm-actions-btn" onClick={() => onOpenAttendance({ employeeId: r.employeeId, date, companyId: r.companyId })}>Attendance</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sm-panel">
        <div className="sm-panel-head"><h3>Outlet visits{open ? ` — ${records.find((r) => r.employeeId === open)?.fullName}` : ''}</h3>{open && <button type="button" className="hr-link" onClick={() => setOpen(null)}>Show everyone</button>}</div>
        {(open ? visits.filter((v) => v.record.employeeId === open) : visits).length === 0 ? (
          <p className="sm-empty">No outlet visits recorded on this day.</p>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table">
              <thead><tr><th scope="col">Time</th><th scope="col">Employee</th><th scope="col">Outlet</th><th scope="col">Location check</th><th scope="col">Distance</th></tr></thead>
              <tbody>
                {(open ? visits.filter((v) => v.record.employeeId === open) : visits).map((v) => {
                  const res = VISIT_RESULT[v.verification?.status] ?? VISIT_RESULT['location-unavailable']
                  return (
                    <tr key={v.id}>
                      <td data-label="Time" className="at-time">{formatAccraTime(v.time)}</td>
                      <td data-label="Employee">{v.record.fullName}</td>
                      <td data-label="Outlet">{outletLabel(v.outlet)}{!v.outlet?.shopId && <span className="at-sub"> · not in the outlet list</span>}</td>
                      <td data-label="Location check"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span>{v.locationError && <span className="at-sub"> · {v.locationError}</span>}</td>
                      <td data-label="Distance" className="at-time">{v.verification?.distance != null ? `${v.verification.distance} m${v.location?.accuracy != null ? ` (±${v.location.accuracy} m)` : ''}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="at-rules">Locations come only from the employee’s phone at the moment of the visit; nothing is filled in automatically. Outlets typed in by the employee have no saved coordinates, so their location is recorded but cannot be checked against a geofence.</p>
      </section>
    </div>
  )
}
