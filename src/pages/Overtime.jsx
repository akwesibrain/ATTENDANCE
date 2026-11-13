import { useEffect, useMemo, useState } from 'react'
import { can, canCorrectAttendance } from '../constants/hrUser'
import { overtimeReport, overtimeToCsv, formatCedis, formatOvertime, OVERTIME_KINDS, vatModeLabel } from '../services/overtimeService'
import { listAttendanceRoster } from '../services/attendanceRecordsService'
import { defaultHoursFor } from '../services/settingsService'
import { scopeCompanyIds } from '../services/permissionsService'
import { recordExport } from '../services/auditStore'
import { listPayPeriods } from '../utils/payPeriod'
import { accraTodayKey, formatAccraDate, formatAccraTime } from '../utils/accraTime'
import { sourceLabel } from '../constants/attendanceLabels'
import CorrectionModal from '../components/attendance/CorrectionModal'
import { ChartCard, Columns } from '../components/reports/Charts'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/attendance.css'
import '../styles/notifications.css'
import '../styles/hr-users.css'
import '../styles/charts.css'
import '../styles/overtime.css'

function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function EmployeeDrawer({ row, canCorrect, onCorrect, onClose }) {
  useEffect(() => {
    const onEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])
  return (
    <div className="nt-drawer-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="nt-drawer" role="dialog" aria-modal="true" aria-labelledby="ot-drawer-title">
        <header className="nt-drawer-head">
          <div>
            <h3 id="ot-drawer-title">{row.fullName}</h3>
            <p className="nt-muted">{row.employeeId} · {row.companyName} · {row.position}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="nt-drawer-body">
          <div className="ot-mini-stats">
            <div><span>Overtime</span><strong>{formatOvertime(row.minutes)}</strong></div>
            <div><span>Days</span><strong>{row.days}</strong></div>
            <div><span>Earnings</span><strong>{formatCedis(row.pay)}</strong></div>
            {row.vat.mode !== 'none' && <div><span>VAT ({vatModeLabel(row.vat)})</span><strong>{formatCedis(row.vat.amount)}</strong></div>}
            {row.vat.mode === 'deduct' && <div><span>Employee gets</span><strong>{formatCedis(row.vat.employeeGets)}</strong></div>}
            {row.vat.mode === 'add' && <div><span>Company cost</span><strong>{formatCedis(row.vat.companyCost)}</strong></div>}
          </div>
          <div className="sm-table-wrap">
            <table className="sm-table ot-day-table">
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Clock-out</th><th scope="col">Type</th><th scope="col">Overtime from</th><th scope="col">Overtime</th><th scope="col">Pay</th><th scope="col"><span className="sr-only">Review</span></th></tr>
              </thead>
              <tbody>
                {row.entries.map((d) => (
                  <tr key={d.record.key}>
                    <td data-label="Date" className="at-nowrap">{formatAccraDate(d.record.date, { weekday: 'short', day: 'numeric', month: 'short' })}<span className="at-sub ot-source">{sourceLabel(d.record.source)}</span></td>
                    <td data-label="Clock-out" className="at-time">{formatAccraTime(d.record.clockOut)}</td>
                    <td data-label="Type"><span className={`ot-kind ot-kind-${d.kind}`}>{OVERTIME_KINDS[d.kind]}</span></td>
                    <td data-label="Overtime from" className="at-time">{d.kind !== 'after-hours' ? `${formatAccraTime(d.threshold)} (clock-in)` : formatAccraTime(d.threshold)}</td>
                    <td data-label="Overtime" className="at-time">{formatOvertime(d.minutes)}</td>
                    <td data-label="Pay" className="at-time">{formatCedis(d.pay)}<span className="at-sub"> @ {formatCedis(d.rate)}/h</span></td>
                    <td data-label="Review">{canCorrect && <button type="button" className="sm-actions-btn" onClick={() => onCorrect(d.record)}>Correct</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="at-section-note at-flush">
            Corrections keep the original times and are recorded in the correction history and the audit log.
            Overtime is recalculated from the corrected clock-out.
          </p>
        </div>
      </aside>
    </div>
  )
}

/**
 * Overtime — minutes after the company overtime start, accumulated over the
 * 26th–25th attendance period, with GH₵ earnings at the configured rate.
 * Calculated from the attendance records.
 */
export default function Overtime({ company, user, onChanged }) {
  const periods = useMemo(() => listPayPeriods(12), [])
  const [periodKey, setPeriodKey] = useState(periods[0].key)
  const [search, setSearch] = useState('')
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState(null) // employeeId
  const [correcting, setCorrecting] = useState(null) // record
  const [showExcluded, setShowExcluded] = useState(false)
  const period = periods.find((p) => p.key === periodKey) ?? periods[0]
  const companyId = company?.id ?? ''
  const canExport = can(user, 'reports', 'export')
  const canCorrect = canCorrectAttendance(user)

  const report = useMemo(
    () => overtimeReport({ user, companyId, period }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, companyId, period.key, version],
  )
  const ids = report.companyIds
  const combined = ids.length > 1
  const term = search.trim().toLowerCase()
  const rows = report.employees.filter((e) => !term || e.fullName.toLowerCase().includes(term) || e.employeeId.toLowerCase().includes(term))
  const openRow = open ? report.employees.find((e) => e.employeeId === open) : null
  const roster = useMemo(() => listAttendanceRoster(null).filter((e) => scopeCompanyIds(user, companyId).includes(e.companyId)), [user, companyId])
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }

  const exportCsv = (detail) => {
    const scope = companyId || (combined ? 'all-companies' : ids[0])
    download(`overtime-${detail ? 'daily-' : ''}${scope}-period-${period.key}.csv`, overtimeToCsv(report, { detail }))
    recordExport({ action: 'Overtime report exported', category: 'Attendance', source: 'Overtime', companyIds: ids, affected: `${period.label} period`, description: `${detail ? 'Daily' : 'Employee'} overtime CSV (${report.employees.length} employees).` })
  }

  return (
    <div className="sm-page ot-page">
      <div className="sm-head">
        <div>
          <h2>Overtime</h2>
          <p>Overtime from recorded clock-out times, accumulated over the {period.label} attendance period (26th–25th, Africa/Accra).</p>
        </div>
        {canExport && (
          <div className="at-head-actions">
            <button type="button" className="btn btn-secondary at-btn" onClick={() => exportCsv(false)} disabled={!report.employees.length}>Export summary (CSV)</button>
            <button type="button" className="btn btn-secondary at-btn" onClick={() => exportCsv(true)} disabled={!report.employees.length}>Export daily (CSV)</button>
          </div>
        )}
      </div>

      <p className="hu-warning" role="note">
        Saturdays, Sundays and holidays are overtime:
        all time worked on those days counts. On weekdays, only time after the overtime start counts. Overtime pay = (overtime minutes ÷ 60)
        × the hourly rate. VAT on overtime follows each company's choice in Settings → Overtime Pay &amp; VAT: not applied, deducted from the employee, or added on top as a company cost.
      </p>

      <div className="sm-controls">
        <label className="sr-only" htmlFor="ot-period">Attendance period</label>
        <select id="ot-period" className="sm-select" value={period.key} onChange={(e) => setPeriodKey(e.target.value)}>
          {periods.map((p) => <option key={p.key} value={p.key}>{p.label} period</option>)}
        </select>
        <span className="at-period-chip">{period.start.toLocaleDateString([], opts)} – {period.end.toLocaleDateString([], opts)} · counted to {formatAccraDate(accraTodayKey(), { day: 'numeric', month: 'short' })}</span>
      </div>

      <div className="sm-stats" role="status" aria-label="Overtime summary">
        <div className="sm-stat"><span className="sm-stat-label">Total overtime</span><span className="sm-stat-value">{formatOvertime(report.totals.minutes)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Overtime hours</span><span className="sm-stat-value">{report.totals.hours.toFixed(2)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Overtime earnings</span><span className="sm-stat-value sm-stat-accent">{formatCedis(report.totals.pay)}</span></div>
        {report.totals.vatAmount > 0 && <div className="sm-stat"><span className="sm-stat-label">VAT on overtime</span><span className="sm-stat-value">{formatCedis(report.totals.vatAmount)}</span></div>}
        {report.totals.employeeGets !== report.totals.pay && <div className="sm-stat"><span className="sm-stat-label">Employees get (after VAT)</span><span className="sm-stat-value">{formatCedis(report.totals.employeeGets)}</span></div>}
        {report.totals.companyCost !== report.totals.pay && <div className="sm-stat"><span className="sm-stat-label">Company cost (with VAT)</span><span className="sm-stat-value">{formatCedis(report.totals.companyCost)}</span></div>}
        <div className="sm-stat"><span className="sm-stat-label">Employees with overtime</span><span className="sm-stat-value">{report.totals.employees}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Overtime days</span><span className="sm-stat-value">{report.totals.days}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Excluded records</span><span className="sm-stat-value sm-stat-warn">{report.excluded.length}</span></div>
      </div>

      <section className="sm-panel">
        <div className="sm-panel-head"><h3>Rates and rules</h3><span className="sm-muted">From Settings → Working Hours &amp; Timezone</span></div>
        <div className="sm-table-wrap">
          <table className="sm-table ot-rates-table">
            <thead><tr><th scope="col">Company</th><th scope="col">Official hours</th><th scope="col">Late after</th><th scope="col">Overtime from</th><th scope="col">Rate</th><th scope="col">VAT on overtime</th><th scope="col">Overtime</th><th scope="col">Earnings</th><th scope="col">VAT</th></tr></thead>
            <tbody>
              {report.companies.map((c) => {
                const h = defaultHoursFor(c.companyId)
                return (
                  <tr key={c.companyId}>
                    <th scope="row" data-label="Company">{c.name}</th>
                    <td data-label="Official hours">{h.startTime}–{h.endTime}</td>
                    <td data-label="Late after">{h.lateAfter}</td>
                    <td data-label="Overtime from">{h.overtimeStart}</td>
                    <td data-label="Rate">{formatCedis(c.currentRate)}/h</td>
                    <td data-label="VAT on overtime">{vatModeLabel({ mode: c.vatMode, rate: c.vatRate })}</td>
                    <td data-label="Overtime">{formatOvertime(c.minutes)}</td>
                    <td data-label="Earnings"><strong>{formatCedis(c.pay)}</strong></td>
                    <td data-label="VAT">{c.vatMode === 'none' ? '—' : formatCedis(c.vatAmount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="at-rules">Saturdays, Sundays and holidays: the whole time worked is overtime, from clock-in to clock-out. Weekdays: only time after the overtime start counts. Approved leave, incomplete records and unknown times are excluded.</p>
      </section>

      <ChartCard
        title="Daily overtime"
        subtitle={`Overtime minutes per day · ${period.label} period`}
        empty={report.totals.minutes ? null : 'No overtime has been recorded in this period yet.'}
        table={(
          <table className="sm-table"><thead><tr><th scope="col">Date</th><th scope="col">Employees</th><th scope="col">Overtime</th><th scope="col">Pay</th></tr></thead>
            <tbody>{report.daily.filter((d) => d.minutes).map((d) => <tr key={d.date}><td>{formatAccraDate(d.date)}</td><td>{d.employees}</td><td>{formatOvertime(d.minutes)}</td><td>{formatCedis(d.pay)}</td></tr>)}</tbody>
          </table>
        )}
      >
        <Columns
          ariaLabel="Overtime minutes per day"
          data={report.daily.map((d) => ({ key: d.date, label: formatAccraDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' }), short: formatAccraDate(d.date, { day: 'numeric' }), value: d.minutes, seriesLabel: 'minutes' }))}
          format={(v) => `${Math.round(v)}`}
        />
      </ChartCard>

      <section className="sm-panel">
        <div className="at-filters">
          <input type="search" className="form-input sm-search" placeholder="Search employee name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employees" />
        </div>
        <div className="sm-panel-head at-table-head">
          <h3>Employee overtime summary</h3>
          <span className="sm-muted">{rows.length} of {report.employees.length} employees</span>
        </div>
        {rows.length === 0 ? (
          <p className="sm-empty">{report.employees.length ? 'No employees match your search.' : 'Nobody has overtime in this period yet.'}</p>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table ot-emp-table">
              <thead>
                <tr><th scope="col">Employee</th>{combined && <th scope="col">Company</th>}<th scope="col">Days</th><th scope="col">Overtime</th><th scope="col">Hours</th><th scope="col">Rate</th><th scope="col">Earnings</th><th scope="col">VAT</th><th scope="col"><span className="sr-only">Details</span></th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.employeeId}>
                    <td data-label="Employee"><span className="at-stack"><span className="at-emp-name">{e.fullName}</span><span className="at-sub"><span className="sm-mono">{e.employeeId}</span> · {e.position}</span></span></td>
                    {combined && <td data-label="Company">{e.companyName}</td>}
                    <td data-label="Days" className="at-time">{e.days}</td>
                    <td data-label="Overtime" className="at-time">{formatOvertime(e.minutes)}</td>
                    <td data-label="Hours" className="at-time">{e.hours.toFixed(2)}</td>
                    <td data-label="Rate" className="at-time">{e.rates.map((r) => formatCedis(r)).join(' / ')}/h</td>
                    <td data-label="Earnings" className="at-time"><strong>{formatCedis(e.pay)}</strong></td>
                    <td data-label="VAT" className="at-time">
                      {e.vat.mode === 'none' ? '—' : (
                        <span className="at-stack">
                          <span>{e.vat.mode === 'deduct' ? '−' : '+'}{formatCedis(e.vat.amount)}</span>
                          <span className="at-sub">{e.vat.mode === 'deduct' ? `gets ${formatCedis(e.vat.employeeGets)}` : `company pays ${formatCedis(e.vat.companyCost)}`}</span>
                        </span>
                      )}
                    </td>
                    <td data-label="Details" className="at-actions"><button type="button" className="sm-actions-btn" onClick={() => setOpen(e.employeeId)}>Daily overtime</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sm-panel">
        <div className="sm-panel-head">
          <h3>Records not counted ({report.excluded.length})</h3>
          <button type="button" className="hr-link" onClick={() => setShowExcluded((v) => !v)} aria-expanded={showExcluded}>{showExcluded ? 'Hide' : 'Show'}</button>
        </div>
        {showExcluded && (report.excluded.length ? (
          <ul className="ot-excluded">
            {report.excluded.slice(0, 100).map(({ record: r, reason }) => (
              <li key={r.key}>
                <strong>{r.fullName}</strong> <span className="sm-mono">{r.employeeId}</span> · {formatAccraDate(r.date, { day: 'numeric', month: 'short' })} · {reason}
                {canCorrect && reason !== 'Approved leave' && <button type="button" className="hr-link" onClick={() => setCorrecting(r)}>Correct</button>}
              </li>
            ))}
          </ul>
        ) : <p className="sm-empty">Every attended record could be evaluated.</p>)}
      </section>

      {openRow && (
        <EmployeeDrawer row={openRow} canCorrect={canCorrect} onCorrect={(r) => setCorrecting(r)} onClose={() => setOpen(null)} />
      )}
      {correcting && (
        <CorrectionModal
          roster={roster}
          initial={{ employeeId: correcting.employeeId, date: correcting.date }}
          user={user}
          onClose={() => setCorrecting(null)}
          onSaved={() => { setCorrecting(null); setVersion((v) => v + 1); onChanged?.() }}
        />
      )}
    </div>
  )
}
