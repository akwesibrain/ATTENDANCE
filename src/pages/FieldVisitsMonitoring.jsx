import { useMemo, useState } from 'react'
import { CATEGORIES } from '../constants/employeeCategories'
import { listAttendanceRecords } from '../services/attendanceRecordsService'
import { VISIT_RESULT, outletLabel } from '../services/fieldVisitsService'
import { visitProofForRecord } from '../services/trackingReportService'
import { MIN_STAY_MINUTES, OFF_LIST, SHOP_PROOF, getVisitList, mockSaveVisitList } from '../services/visitListService'
import { listShops } from '../services/shopsService'
import { can } from '../services/permissionsService'
import { accraTodayKey, formatAccraDate, formatAccraTime } from '../utils/accraTime'
import { StatusBadge } from '../components/attendance/AttendanceBadges'
import '../styles/sales-monitoring.css'
import '../styles/attendance.css'

/**
 * Sales Representative / Supervisor monitoring.
 *
 * Each person has a fixed list of shops to visit every working day (set by
 * HR here). A visit to a listed shop is PROVEN only by a face scan inside the
 * shop's area AND a stay of at least MIN_STAY_MINUTES on live tracking.
 * Everything else — scan without a stay, scan outside, missed shops, shops not
 * on the list, typed-in outlets — is flagged for HR to review.
 */
export default function FieldVisitsMonitoring({ company, category, user, onOpenAttendance }) {
  const meta = CATEGORIES[category]
  const today = accraTodayKey()
  const [date, setDate] = useState(today)
  const [employeeId, setEmployeeId] = useState('')
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const [version, setVersion] = useState(0)
  const canEditLists = can(user, 'shops', 'edit')

  const records = useMemo(
    () => listAttendanceRecords({ companyId: company.id, dates: [date] }).filter((r) => r.category === category),
    [company.id, date, category],
  )
  const proofs = useMemo(
    () => Object.fromEntries(records.map((r) => [r.employeeId, visitProofForRecord(r)])),
    // version: recalculate after a list is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, version],
  )
  const shown = employeeId ? records.filter((r) => r.employeeId === employeeId) : records
  const visits = shown.flatMap((r) => r.visits.map((v) => ({ ...v, record: r }))).sort((a, b) => a.time.localeCompare(b.time))
  const sum = (key) => shown.reduce((n, r) => n + (proofs[r.employeeId]?.counts[key] ?? 0), 0)
  const stats = {
    employees: shown.length,
    working: shown.filter((r) => r.hasAttendance).length,
    listed: sum('listed'),
    proven: sum('proven'),
    flagged: sum('flagged'),
    missed: sum('missed'),
  }
  const openRecord = open ? records.find((r) => r.employeeId === open) : null
  const openProof = open ? proofs[open] : null

  return (
    <div className="sm-page">
      <div className="sm-head">
        <div>
          <h2>{meta.single} Monitoring</h2>
          <p>
            {category === 'supervisor'
              ? 'Supervisors visit larger outlets such as China Mall and Melcom.'
              : 'Sales Representatives visit mini-markets for the company.'}
            {' '}Each person has a list of shops to visit every working day. A visit is <strong>proven</strong> only
            by a face scan inside the shop area <strong>and</strong> a stay of at least {MIN_STAY_MINUTES} minutes on live tracking.
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
        <div className="sm-stat"><span className="sm-stat-label">Shop visits due</span><span className="sm-stat-value">{stats.listed}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Visits proven</span><span className="sm-stat-value sm-stat-ok">{stats.proven}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Flagged for review</span><span className={`sm-stat-value${stats.flagged ? ' sm-stat-warn' : ''}`}>{stats.flagged}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Shops missed</span><span className={`sm-stat-value${stats.missed ? ' sm-stat-crit' : ''}`}>{stats.missed}</span></div>
      </div>

      {editing && (
        <VisitListEditor
          key={editing.employeeId}
          record={editing}
          company={company}
          user={user}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setVersion((v) => v + 1) }}
        />
      )}

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
                <tr><th scope="col">Employee</th><th scope="col">Status</th><th scope="col">Clock-in</th><th scope="col">Clock-out</th><th scope="col">Shops proven</th><th scope="col">Flagged</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const c = proofs[r.employeeId]?.counts ?? { listed: 0, proven: 0, flagged: 0 }
                  return (
                    <tr key={r.employeeId} className={open === r.employeeId ? 'is-selected' : ''}>
                      <td data-label="Employee"><span className="at-stack"><span className="at-emp-name">{r.fullName}</span><span className="at-sub"><span className="sm-mono">{r.employeeId}</span></span></span></td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Clock-in" className="at-time">{r.clockIn ? formatAccraTime(r.clockIn) : '—'}</td>
                      <td data-label="Clock-out" className="at-time">{r.atWork ? 'At work' : r.clockOut ? formatAccraTime(r.clockOut) : '—'}</td>
                      <td data-label="Shops proven">
                        {c.listed
                          ? <span className="fv-proven"><span className="fv-proven-bar" aria-hidden="true"><span style={{ width: `${(c.proven / c.listed) * 100}%` }} /></span>{c.proven} of {c.listed}</span>
                          : <span className="at-none">No shop list</span>}
                      </td>
                      <td data-label="Flagged" className="at-time">{c.flagged ? <span className="at-badge at-tone-warn">{c.flagged}</span> : '—'}</td>
                      <td data-label="Actions" className="at-actions">
                        <button type="button" className="sm-actions-btn" onClick={() => setOpen(open === r.employeeId ? null : r.employeeId)} aria-expanded={open === r.employeeId}>{open === r.employeeId ? 'Hide shops' : 'Shops'}</button>
                        {canEditLists && <button type="button" className="sm-actions-btn" onClick={() => setEditing(r)}>Edit shop list</button>}
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

      {openRecord && openProof && (
        <section className="sm-panel" aria-labelledby="fv-proof-title">
          <div className="sm-panel-head">
            <h3 id="fv-proof-title">Shop visits — {openRecord.fullName}</h3>
            <button type="button" className="hr-link" onClick={() => setOpen(null)}>Close</button>
          </div>
          {openProof.listed.length === 0 ? (
            <p className="sm-empty">No shop list yet.{canEditLists ? ' Use “Edit shop list” to choose the shops this person visits every working day.' : ''}</p>
          ) : (
            <div className="sm-table-wrap">
              <table className="sm-table">
                <thead><tr><th scope="col">Shop</th><th scope="col">Result</th><th scope="col">Face-scan visit</th><th scope="col">Stay on live tracking</th></tr></thead>
                <tbody>
                  {openProof.listed.map((l) => {
                    const res = SHOP_PROOF[l.status]
                    const scanRes = l.scan ? VISIT_RESULT[l.scan.verification?.status] : null
                    return (
                      <tr key={l.shopId}>
                        <td data-label="Shop">{l.shop?.shopName ?? l.shopId}</td>
                        <td data-label="Result"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span></td>
                        <td data-label="Face-scan visit">
                          {l.scan
                            ? <span className="at-stack">{formatAccraTime(l.scan.time)} · {scanRes?.short}<span className="at-sub">{l.scan.verification?.distance != null ? `${l.scan.verification.distance} m from the shop` : 'no distance'}{l.scans > 1 ? ` · ${l.scans} scans` : ''}</span></span>
                            : <span className="at-none">No scan</span>}
                        </td>
                        <td data-label="Stay on live tracking">{l.stayMinutes == null ? <span className="at-none">No live tracking</span> : `${l.stayMinutes} min${l.stayMinutes >= MIN_STAY_MINUTES ? '' : ` (needs ${MIN_STAY_MINUTES})`}`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {openProof.offList.length > 0 && (
            <>
              <h4 className="fv-subhead">Visits to shops not on the list</h4>
              <div className="sm-table-wrap">
                <table className="sm-table">
                  <thead><tr><th scope="col">Time</th><th scope="col">Outlet</th><th scope="col">Result</th><th scope="col">Location check</th></tr></thead>
                  <tbody>
                    {openProof.offList.map(({ visit, status }) => {
                      const res = OFF_LIST[status]
                      const loc = VISIT_RESULT[visit.verification?.status] ?? VISIT_RESULT['location-unavailable']
                      return (
                        <tr key={visit.id}>
                          <td data-label="Time" className="at-time">{formatAccraTime(visit.time)}</td>
                          <td data-label="Outlet">{outletLabel(visit.outlet)}</td>
                          <td data-label="Result"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span></td>
                          <td data-label="Location check">{loc.short}{visit.verification?.distance != null ? ` · ${visit.verification.distance} m` : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="at-rules">
            Proven = face scan inside the shop area <strong>and</strong> at least {MIN_STAY_MINUTES} minutes near the shop on live tracking.
            A flag is a reason to check with the employee — for example a phone with no mobile data shows no stay — not proof of misconduct.
          </p>
        </section>
      )}

      <section className="sm-panel">
        <div className="sm-panel-head"><h3>All outlet visits{employeeId ? ` — ${records.find((r) => r.employeeId === employeeId)?.fullName}` : ''}</h3></div>
        {visits.length === 0 ? (
          <p className="sm-empty">No outlet visits recorded on this day.</p>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table">
              <thead><tr><th scope="col">Time</th><th scope="col">Employee</th><th scope="col">Outlet</th><th scope="col">Location check</th><th scope="col">Distance</th></tr></thead>
              <tbody>
                {visits.map((v) => {
                  const res = VISIT_RESULT[v.verification?.status] ?? VISIT_RESULT['location-unavailable']
                  return (
                    <tr key={v.id}>
                      <td data-label="Time" className="at-time">{formatAccraTime(v.time)}</td>
                      <td data-label="Employee">{v.record.fullName}</td>
                      <td data-label="Outlet">{outletLabel(v.outlet)}{!v.outlet?.shopId && <span className="at-sub"> · typed in, cannot be verified</span>}</td>
                      <td data-label="Location check"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span>{v.locationError && <span className="at-sub"> · {v.locationError}</span>}</td>
                      <td data-label="Distance" className="at-time">{v.verification?.distance != null ? `${v.verification.distance} m${v.location?.accuracy != null ? ` (±${v.location.accuracy} m)` : ''}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="at-rules">Locations come only from the employee’s phone; nothing is filled in automatically. Outlets typed in by the employee have no saved coordinates, so they can never count as a proven visit.</p>
      </section>
    </div>
  )
}

/** HR chooses the shops a Sales Rep / Supervisor visits every working day. */
function VisitListEditor({ record, company, user, onClose, onSaved }) {
  const shops = listShops(company.id)
  const [selected, setSelected] = useState(() => new Set(getVisitList(record.employeeId)))
  const [error, setError] = useState('')
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const save = () => {
    const r = mockSaveVisitList({ employeeId: record.employeeId, fullName: record.fullName, companyId: company.id, shopIds: [...selected] }, user)
    if (r.error) { setError(r.error); return }
    onSaved()
  }
  return (
    <section className="sm-panel fv-editor" aria-labelledby="fv-editor-title">
      <div className="sm-panel-head">
        <div>
          <h3 id="fv-editor-title">Daily shop list — {record.fullName}</h3>
          <span className="sm-muted">The shops {record.fullName.split(' ')[0]} must visit every working day.</span>
        </div>
      </div>
      {shops.length === 0 ? (
        <p className="sm-empty">{company.name} has no shops in the Shop Directory yet.</p>
      ) : (
        <ul className="fv-shop-list">
          {shops.map((sh) => (
            <li key={sh.shopId}>
              <label className={`fv-shop${selected.has(sh.shopId) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={selected.has(sh.shopId)} onChange={() => toggle(sh.shopId)} />
                <span className="at-stack">
                  <span>{sh.shopName}</span>
                  <span className="at-sub">{[sh.area, sh.town].filter(Boolean).join(', ') || '—'}</span>
                </span>
                {sh.latitude == null && <span className="at-badge at-tone-warn" title="Visits here cannot be proven until HR saves the shop's location in the Shop Directory.">No saved location</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="fv-editor-actions">
        <span className="sm-muted">{selected.size} shop{selected.size === 1 ? '' : 's'} selected</span>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save}>Save list</button>
      </div>
    </section>
  )
}
