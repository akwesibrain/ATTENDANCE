import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, categoryForPosition } from '../constants/employeeCategories'
import { useCacheVersion } from '../services/backend/cache'
import { listAttendanceRecords } from '../services/attendanceRecordsService'
import { VISIT_RESULT, outletLabel, visitDistance } from '../services/fieldVisitsService'
import { GPS_TOLERANCE_M, formatDistance } from '../utils/distance'
import {
  fetchTrackingDailyReport,
  hydrateServerProof,
  visitProofForRecord,
} from '../services/trackingReportService'
import { MIN_STAY_MINUTES, OFF_LIST, SHOP_RESULT, getVisitList, saveVisitList } from '../services/visitListService'
import { MAX_SHOPS, MIN_SHOPS } from '../utils/shopSelection'
import { listShops } from '../services/shopsService'
import { can } from '../services/permissionsService'
import { accraTodayKey, formatAccraDate, formatAccraTime } from '../utils/accraTime'
import { StatusBadge } from '../components/attendance/AttendanceBadges'
import '../styles/sales-monitoring.css'
import '../styles/attendance.css'

/**
 * Sales Representative / Supervisor monitoring.
 *
 * Each person has a fixed list of shops (1 to MAX_SHOPS) to visit every
 * working day, set by HR here. No pass/fail radius: HR sees how far people
 * were. A listed shop is PROVEN when live tracking shows a stay of
 * MIN_STAY_MINUTES+ at it (within GPS_TOLERANCE_M, an allowance for GPS error).
 */
export default function FieldVisitsMonitoring({ company, category, user, onOpenAttendance }) {
  const dataVersion = useCacheVersion()
  const meta = CATEGORIES[category]
  const today = accraTodayKey()
  const [date, setDate] = useState(today)
  const [employeeId, setEmployeeId] = useState('')
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const [version, setVersion] = useState(0)
  const [serverProofs, setServerProofs] = useState({ key: '', byEmp: {} })
  const canEditLists = can(user, 'shops', 'edit')

  const requestKey = `${company.id}|${date}|${category}|${version}`

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchTrackingDailyReport(company.id, date, category)
        .then((report) => {
          if (cancelled) return
          const byEmp = {}
          ;(report.rows ?? []).forEach((row) => {
            if (row.proof) byEmp[row.employeeId] = hydrateServerProof(row.proof)
          })
          setServerProofs({ key: requestKey, byEmp })
        })
        .catch(() => {
          // Keep cached fallback on transient network hiccup.
        })
    }
    load()
    if (date !== today) return () => { cancelled = true }
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, 30000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [company.id, date, category, today, requestKey])

  const records = useMemo(
    () => listAttendanceRecords({ companyId: company.id, dates: [date] })
      .map((r) => ({ ...r, category: r.category ?? categoryForPosition(r.position), visits: r.visits ?? [] }))
      .filter((r) => r.category === category),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, date, category, dataVersion],
  )
  const proofs = useMemo(
    () => {
      const fromServer = serverProofs.key === requestKey ? serverProofs.byEmp : {}
      return Object.fromEntries(
        records.map((r) => [r.employeeId, fromServer[r.employeeId] ?? visitProofForRecord(r)]),
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, version, dataVersion, serverProofs, requestKey],
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
            {' '}Each person has a list of 1 to {MAX_SHOPS} shops to visit every working day. A visit is <strong>proven</strong> when
            live tracking shows a stay of {MIN_STAY_MINUTES}+ minutes at the shop. There is no pass/fail distance — you see how far
            people were and decide.
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
                <thead><tr><th scope="col">Shop</th><th scope="col">Result</th><th scope="col">Visit recorded</th><th scope="col">Stay at the shop (live tracking)</th></tr></thead>
                <tbody>
                  {openProof.listed.map((l) => {
                    const res = SHOP_RESULT[l.status] ?? SHOP_RESULT.pending
                    const closest = l.closest ?? l.closestM ?? null
                    return (
                      <tr key={l.shopId}>
                        <td data-label="Shop">{l.shop?.shopName ?? l.shopName ?? l.shopId}</td>
                        <td data-label="Result"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span></td>
                        <td data-label="Visit recorded">
                          {l.first
                            ? <span className="at-stack">{formatAccraTime(l.first.time)}{l.scans > 1 ? ` · ${l.scans} visits` : ''}<span className="at-sub">{l.visitDistance != null ? `${formatDistance(l.visitDistance)} from the shop` : 'distance not available'}</span></span>
                            : <span className="at-none">No visit recorded</span>}
                        </td>
                        <td data-label="Stay at the shop">
                          {l.stayMinutes == null
                            ? <span className="at-none">{l.shop?.latitude == null && l.hasMapLocation === false ? 'Shop has no map location' : 'No live tracking'}</span>
                            : <span className="at-stack">{l.stayMinutes} min<span className="at-sub">{closest != null ? `closest ${formatDistance(closest)}` : ''}</span></span>}
                        </td>
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
                  <thead><tr><th scope="col">Time</th><th scope="col">Outlet</th><th scope="col">Result</th><th scope="col">Phone location</th><th scope="col">Distance</th></tr></thead>
                  <tbody>
                    {openProof.offList.map(({ visit, status, distance }) => {
                      const res = OFF_LIST[status] ?? OFF_LIST['off-list']
                      const loc = VISIT_RESULT[visit.verification?.status ?? visit.status] ?? VISIT_RESULT['location-unavailable']
                      return (
                        <tr key={visit.id}>
                          <td data-label="Time" className="at-time">{formatAccraTime(visit.time)}</td>
                          <td data-label="Outlet">{outletLabel(visit.outlet)}</td>
                          <td data-label="Result"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span></td>
                          <td data-label="Phone location">{loc.short}</td>
                          <td data-label="Distance" className="at-time">{distance != null ? formatDistance(distance) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="at-rules">
            Proven = live tracking shows {MIN_STAY_MINUTES}+ minutes within {GPS_TOLERANCE_M} m of the shop (an allowance for GPS error,
            not a pass/fail rule). A flag is a reason to check with the employee — for example a phone with no mobile data shows no stay —
            not proof of misconduct.
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
              <thead><tr><th scope="col">Time</th><th scope="col">Employee</th><th scope="col">Outlet</th><th scope="col">Phone location</th><th scope="col">Distance from shop</th></tr></thead>
              <tbody>
                {visits.map((v) => {
                  const res = VISIT_RESULT[v.verification?.status ?? v.status] ?? VISIT_RESULT['location-unavailable']
                  return (
                    <tr key={v.id}>
                      <td data-label="Time" className="at-time">{formatAccraTime(v.time)}</td>
                      <td data-label="Employee">{v.record.fullName}</td>
                      <td data-label="Outlet">{outletLabel(v.outlet)}{!v.outlet?.shopId && <span className="at-sub"> · typed in, not in the shop list</span>}</td>
                      <td data-label="Phone location"><span className={`at-badge at-tone-${res.tone}`} title={res.label}>{res.short}</span>{v.locationError && <span className="at-sub"> · {v.locationError}</span>}</td>
                      <td data-label="Distance from shop" className="at-time">{formatDistance(visitDistance(v))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="at-rules">Locations come only from the employee’s phone; nothing is filled in automatically. Outlets typed in by the employee are not in the shop list, so they never count as a listed shop.</p>
      </section>
    </div>
  )
}

/** HR chooses the shops a Sales Rep / Supervisor visits every working day. */
function VisitListEditor({ record, company, onClose, onSaved }) {
  const shops = listShops(company.id)
  const [selected, setSelected] = useState(() => new Set(getVisitList(record.employeeId)))
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredShops = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shops
    return shops.filter((sh) =>
      selected.has(sh.shopId) ||
      sh.shopName.toLowerCase().includes(q) ||
      (sh.town ?? '').toLowerCase().includes(q) ||
      (sh.area ?? '').toLowerCase().includes(q),
    )
  }, [shops, query, selected])

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const save = async () => {
    if (selected.size < MIN_SHOPS) { setError('Choose at least one shop.'); return }
    if (selected.size > MAX_SHOPS) { setError(`Choose up to ${MAX_SHOPS} shops.`); return }
    setSaving(true)
    setError('')
    const r = await saveVisitList({ employeeId: record.employeeId, shopIds: [...selected] })
    setSaving(false)
    if (r.error) { setError(r.error); return }
    onSaved()
  }

  return (
    <section className="sm-panel fv-editor" aria-labelledby="fv-editor-title">
      <div className="sm-panel-head">
        <div>
          <h3 id="fv-editor-title">Daily shop list — {record.fullName}</h3>
          <span className="sm-muted">The shops {record.fullName.split(' ')[0]} must visit every working day — 1 to {MAX_SHOPS} shops.</span>
        </div>
        {shops.length > 10 && (
          <input
            type="search"
            className="form-input"
            placeholder="Filter shops by name, town or area…"
            aria-label="Filter shops"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      {shops.length === 0 ? (
        <p className="sm-empty">{company.name} has no shops in the Shop Directory yet.</p>
      ) : (
        <ul className="fv-shop-list">
          {filteredShops.map((sh) => (
            <li key={sh.shopId}>
              <label className={`fv-shop${selected.has(sh.shopId) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={selected.has(sh.shopId)} onChange={() => toggle(sh.shopId)} disabled={saving} />
                <span className="at-stack">
                  <span>{sh.shopName}</span>
                  <span className="at-sub">{[sh.area, sh.town].filter(Boolean).join(', ') || '—'}</span>
                </span>
                {sh.latitude == null && <span className="at-badge at-tone-warn" title="HR can save the shop's location in the Shop Directory so it shows on the map.">No map location</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="fv-editor-actions">
        <span className="sm-muted">{selected.size} shop{selected.size === 1 ? '' : 's'} selected</span>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save list'}</button>
      </div>
    </section>
  )
}
