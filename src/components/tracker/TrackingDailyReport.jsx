import { memo, useEffect, useMemo, useState } from 'react'
import { useCacheVersion } from '../../services/backend/cache'
import { TRACKER_GROUPS } from '../../services/liveTrackerService'
import {
  TRACKING_RESULT,
  fetchTrackingDailyReport,
  minutesText,
  percentText,
  summariseReportRows,
  trackingDailyReport,
  trackingReportToCsv,
} from '../../services/trackingReportService'
import { can } from '../../services/permissionsService'
import { recordExport } from '../../services/auditStore'
import { accraTodayKey, formatAccraDate, formatAccraTime } from '../../utils/accraTime'

// Status badge classes from sales-monitoring.css (word + shape, colour reinforces).
const TONE_CLASS = { ok: 'sm-status-on-duty', warn: 'sm-status-missed', crit: 'sm-status-location', muted: 'sm-status-not-checked-in' }

/** Sales Reps / Supervisors: "2 of 4 proven · 1 flagged"; Merchandisers: none. */
function shopVisitsText(r) {
  if (!r.shops) return '—'
  const { listed, proven, flagged } = r.shops
  if (!listed) return r.visits ? `${r.visits} visit${r.visits === 1 ? '' : 's'} · no shop list` : 'No shop list'
  return `${proven} of ${listed} proven${flagged ? ` · ${flagged} flagged` : ''}`
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Daily report for everyone the Live Tracker applies to (Supervisors, Sales
 * Reps, Merchandisers): time tracked, live coverage, signal lost and distance
 * for a chosen day. Memoised so map camera movements don't re-render it.
 */
const TrackingDailyReport = memo(function TrackingDailyReport({ company, user, refreshKey }) {
  const dataVersion = useCacheVersion()
  const today = accraTodayKey()
  const [dateKey, setDateKey] = useState(today)
  const [role, setRole] = useState('')
  const [serverState, setServerState] = useState({ key: '', report: null })

  const requestKey = `${company.id}|${dateKey}`
  const pollTrigger = dateKey === today ? refreshKey : 0

  useEffect(() => {
    let cancelled = false
    fetchTrackingDailyReport(company.id, dateKey)
      .then((report) => {
        if (!cancelled) setServerState({ key: requestKey, report })
      })
      .catch(() => {
        // Keep cached fallback on transient network hiccup.
      })
    return () => { cancelled = true }
  }, [company.id, dateKey, requestKey, pollTrigger])

  const cachedReport = useMemo(
    () => trackingDailyReport(company.id, dateKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, dateKey, dataVersion],
  )
  const baseReport = serverState.key === requestKey && serverState.report ? serverState.report : cachedReport
  const filteredRows = useMemo(
    () => (role ? baseReport.rows.filter((r) => r.category === role) : baseReport.rows),
    [baseReport.rows, role],
  )
  const report = useMemo(
    () => (role ? summariseReportRows(dateKey, filteredRows) : baseReport),
    [role, dateKey, filteredRows, baseReport],
  )
  const rows = report.rows
  const t = report.totals
  const canExport = can(user, 'reports', 'export')

  const exportCsv = () => {
    download(`live-tracker-daily-${company.id}-${dateKey}.csv`, trackingReportToCsv({ ...report, rows }))
    recordExport({
      action: 'Live Tracker daily report exported',
      category: 'Attendance',
      source: 'Live Tracker',
      companyIds: [company.id],
      affected: `${formatAccraDate(dateKey)}`,
      description: `Daily tracking CSV (${rows.length} employees).`,
    })
  }

  return (
    <section className="sm-panel lt-report" aria-labelledby="lt-report-title">
      <div className="sm-panel-head lt-report-head">
        <div>
          <h3 id="lt-report-title">Daily tracking report</h3>
          <span className="sm-muted">Supervisors, Sales Reps and Merchandisers · {formatAccraDate(dateKey)}{dateKey === today ? ' (so far)' : ''}</span>
        </div>
        <div className="lt-report-controls">
          <label className="sr-only" htmlFor="lt-report-date">Day</label>
          <input id="lt-report-date" type="date" className="form-input" value={dateKey} max={today} onChange={(e) => setDateKey(e.target.value || today)} />
          <label className="sr-only" htmlFor="lt-report-role">Role</label>
          <select id="lt-report-role" className="form-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {Object.entries(TRACKER_GROUPS).map(([id, g]) => <option key={id} value={id}>{g.label}</option>)}
          </select>
          {canExport && <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>}
        </div>
      </div>

      <div className="sm-stats lt-report-stats">
        <div className="sm-stat"><span className="sm-stat-label">Staff covered</span><span className="sm-stat-value">{t.staff}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Clocked in</span><span className="sm-stat-value">{t.clockedIn}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Tracked with the app</span><span className="sm-stat-value sm-stat-accent">{t.tracked}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Average live coverage</span><span className={`sm-stat-value${t.averageCoverage == null ? '' : ' sm-stat-ok'}`}>{percentText(t.averageCoverage)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Distance travelled</span><span className="sm-stat-value">{t.distanceKm} km</span></div>
        <div className="sm-stat"><span className="sm-stat-label">No or poor signal</span><span className={`sm-stat-value${t.noSignal ? ' sm-stat-crit' : ''}`}>{t.noSignal}</span></div>
      </div>

      {rows.length === 0 ? (
        <p className="sm-empty">No Supervisors, Sales Reps or Merchandisers for {company.name}{role ? ' in this role' : ''}.</p>
      ) : (
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Clock in – out</th>
                <th scope="col">Time tracked</th>
                <th scope="col">Live coverage</th>
                <th scope="col">Signal lost</th>
                <th scope="col">Distance</th>
                <th scope="col">Shop visits</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const res = TRACKING_RESULT[r.result] ?? TRACKING_RESULT['not-clocked-in']
                return (
                  <tr key={r.employeeId}>
                    <td data-label="Employee">{r.fullName}<span className="at-sub"> · {TRACKER_GROUPS[r.category].single} · <span className="sm-mono">{r.employeeId}</span></span></td>
                    <td data-label="Clock in – out">{r.clockIn ? `${formatAccraTime(r.clockIn)} – ${r.clockOut ? formatAccraTime(r.clockOut) : r.stillClockedIn ? 'now' : 'no clock-out'}` : '—'}</td>
                    <td data-label="Time tracked">{minutesText(r.trackedMinutes)}</td>
                    <td data-label="Live coverage">
                      {r.coverage == null ? '—' : (
                        <span className="lt-cover">
                          <span className="lt-cover-bar" aria-hidden="true"><span style={{ width: `${Math.round(r.coverage * 100)}%` }} /></span>
                          {percentText(r.coverage)}
                        </span>
                      )}
                    </td>
                    <td data-label="Signal lost">{r.signalLost == null ? '—' : r.signalLost === 0 ? 'Never' : `${r.signalLost}× · longest ${minutesText(r.longestGapMinutes)}`}</td>
                    <td data-label="Distance">{r.distanceKm == null ? '—' : `${r.distanceKm} km`}</td>
                    <td data-label="Shop visits">{shopVisitsText(r)}</td>
                    <td data-label="Result"><span className={`sm-status ${TONE_CLASS[res.tone]}`}>{res.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="lt-report-note">
        Live coverage is the share of clocked-in time when the phone was sending its location (each update counts for up to 5 minutes).
        Signal lost counts gaps longer than 5 minutes — often no mobile data, Location off or the app closed, not necessarily misconduct.
        Distance leaves out readings less accurate than 100 m. A shop visit is proven when live tracking shows a stay of 10+ minutes
        at the shop (within 100 m, an allowance for GPS error). There is no pass/fail distance. No positions are shown in this report.
      </p>
    </section>
  )
})

export default TrackingDailyReport
