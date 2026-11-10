import { useMemo, useState } from 'react'
import { authorisedCompanies } from '../../constants/hrUser'
import {
  listAttendanceRoster,
  listAttendanceRecords,
  saveManualEntries,
  previewManualEntries,
  recordOrigin,
} from '../../services/attendanceRecordsService'
import { companyDisplayName } from '../../services/settingsService'
import { accraTodayKey, addDaysToKey, dayOfWeekForKey, formatAccraDate } from '../../utils/accraTime'
import { StatusBadge } from './AttendanceBadges'
import { clockText } from './format'

let rowSeq = 1
const newRow = (date = '') => ({ id: rowSeq++, date, clockInTime: '', clockOutTime: '', remarks: '', replace: false })
const MAX_RANGE_DAYS = 62

/**
 * Manual Attendance Entry — HR types attendance from the paper notebook for
 * one employee, one or many dates at a time. Only the dates HR adds are
 * saved; nothing else is touched or marked absent. Saved days become normal
 * attendance records labelled "Manual Entry" (never face/GPS/SMS verified).
 */
export default function ManualEntry({ user, defaultCompanyId, onSaved, onViewHistory }) {
  const companies = authorisedCompanies(user)
  const today = accraTodayKey()
  const [companyId, setCompanyId] = useState(companies.some((c) => c.id === defaultCompanyId) ? defaultCompanyId : companies[0]?.id ?? '')
  const [employeeId, setEmployeeId] = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const [rows, setRows] = useState([])
  const [range, setRange] = useState({ from: '', to: '' })
  const [picked, setPicked] = useState([])
  const [showRange, setShowRange] = useState(false)
  const [fill, setFill] = useState({ clockInTime: '', clockOutTime: '' })
  const [replaceReason, setReplaceReason] = useState('')
  const [errors, setErrors] = useState({})
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState(null)

  const roster = useMemo(() => listAttendanceRoster(companyId).sort((a, b) => a.fullName.localeCompare(b.fullName)), [companyId])
  const term = empSearch.trim().toLowerCase()
  const options = roster.filter((e) => !term || e.fullName.toLowerCase().includes(term) || e.employeeId.toLowerCase().includes(term))
  const employee = roster.find((e) => e.employeeId === employeeId) ?? null

  // Live check of every row (status, existing record, errors). Read-only.
  const preview = useMemo(
    () => (employee && rows.length ? previewManualEntries(employee.employeeId, rows, user) : []),
    [employee, rows, user],
  )
  const byId = new Map(preview.map((p, i) => [rows[i].id, p]))
  const counts = {
    new: preview.filter((p) => p.state === 'new' && !Object.keys(p.errors).length).length,
    replace: preview.filter((p) => p.state.startsWith('exists') && p.replace && !Object.keys(p.errors).length).length,
    review: preview.filter((p) => p.state.startsWith('exists') && !p.replace).length,
    invalid: preview.filter((p) => Object.keys(p.errors).length).length,
  }
  const canSave = employee && rows.length > 0 && counts.invalid === 0 && counts.review === 0 && (counts.replace === 0 || replaceReason.trim().length >= 10)

  const resetForEmployee = (id) => {
    setEmployeeId(id)
    setRows([])
    setPicked([])
    setErrors({})
    setSaved(null)
    setReplaceReason('')
  }

  const updateRow = (id, patch) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setErrors({})
    setSaved(null)
  }
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id))
  const addRow = () => setRows((rs) => [...rs, newRow()])

  const rangeDates = useMemo(() => {
    if (!range.from || !range.to || range.from > range.to) return []
    const out = []
    for (let d = range.from; d <= range.to && out.length < MAX_RANGE_DAYS; d = addDaysToKey(d, 1)) out.push(d)
    return out
  }, [range])
  const listed = new Set(rows.map((r) => r.date))
  // Existing records for the range, computed once per range (not per render).
  const rangeExisting = useMemo(() => {
    if (!employee || !rangeDates.length) return new Map()
    return new Map(listAttendanceRecords({ companyId: employee.companyId, dates: rangeDates })
      .filter((r) => r.employeeId === employee.employeeId)
      .map((r) => [r.date, r]))
  }, [employee, rangeDates])

  const addPicked = () => {
    const fresh = picked.filter((d) => !listed.has(d)).sort()
    setRows((rs) => [...rs, ...fresh.map((d) => newRow(d))].sort((a, b) => (a.date || '9').localeCompare(b.date || '9')))
    setPicked([])
    setShowRange(false)
  }

  const applyFill = () => {
    setRows((rs) => rs.map((r) => ({
      ...r,
      clockInTime: r.clockInTime || fill.clockInTime,
      clockOutTime: r.clockOutTime || fill.clockOutTime,
    })))
  }

  const save = async () => {
    const result = await saveManualEntries({ employeeId, entries: rows, replaceReason })
    setConfirming(false)
    if (result.errors) {
      setErrors(result.errors)
      return
    }
    const dates = rows.map((r) => r.date).sort()
    setSaved({ ...result, count: rows.length, first: dates[0], last: dates[dates.length - 1] })
    setRows([])
    setReplaceReason('')
    onSaved?.(result)
  }

  if (!companies.length) return <p className="sm-empty">Your account has no company access.</p>

  return (
    <section className="sm-panel me-panel" aria-labelledby="me-title">
      <div className="sm-panel-head">
        <div>
          <h3 id="me-title">Manual Attendance Entry</h3>
          <p className="me-sub">Enter attendance from the paper notebook — one or many dates for one employee. Only the dates you add are saved; other dates are never marked absent by this.</p>
        </div>
      </div>

      <div className="me-body">
        {saved && (
          <div className="at-flash" role="status">
            <span>
              Saved {saved.count} day{saved.count === 1 ? '' : 's'} for {employee?.fullName} ({saved.created} new{saved.replaced ? `, ${saved.replaced} replaced after review` : ''}). You can add more dates for this employee below.
            </span>
            <button type="button" className="hr-link" onClick={() => onViewHistory?.({ employeeId, companyId, date: saved.last })}>View attendance history →</button>
          </div>
        )}
        {errors.form && <p className="at-form-alert" role="alert">{errors.form}</p>}

        <div className="me-step">
          <span className="me-step-num" aria-hidden="true">1</span>
          <div className="me-step-body">
            <h4>Employee</h4>
            <div className="me-grid">
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="me-company">Company</label>
                <select id="me-company" className="sh-form-select" value={companyId} disabled={companies.length < 2} onChange={(e) => { setCompanyId(e.target.value); setEmpSearch(''); resetForEmployee('') }}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{companyDisplayName(c.id, c.name)}</option>)}
                </select>
              </div>
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="me-emp-search">Find employee</label>
                <input id="me-emp-search" className="sh-form-input" type="search" placeholder="Name or employee ID" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
              </div>
              <div className="sh-form-field me-span-2">
                <label className="sh-form-label" htmlFor="me-employee">Employee</label>
                <select id="me-employee" className="sh-form-select" value={employeeId} onChange={(e) => resetForEmployee(e.target.value)}>
                  <option value="">Choose an employee… ({options.length})</option>
                  {options.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.fullName} — {e.employeeId} · {e.position}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {employee && (
          <div className="me-step">
            <span className="me-step-num" aria-hidden="true">2</span>
            <div className="me-step-body">
              <h4>Dates and times</h4>
              <div className="me-toolbar">
                <button type="button" className="sm-actions-btn" onClick={addRow}>+ Add a date</button>
                <button type="button" className="sm-actions-btn" onClick={() => setShowRange((v) => !v)} aria-expanded={showRange}>Pick dates from a range</button>
              </div>

              {showRange && (
                <div className="me-range">
                  <div className="me-grid">
                    <div className="sh-form-field">
                      <label className="sh-form-label" htmlFor="me-from">From</label>
                      <input id="me-from" type="date" className="sh-form-input" max={today} value={range.from} onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setPicked([]) }} />
                    </div>
                    <div className="sh-form-field">
                      <label className="sh-form-label" htmlFor="me-to">To</label>
                      <input id="me-to" type="date" className="sh-form-input" min={range.from || undefined} max={today} value={range.to} onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); setPicked([]) }} />
                    </div>
                  </div>
                  {rangeDates.length > 0 && (
                    <>
                      <p className="me-hint">Tick only the days the employee actually attended. Nothing is ticked for you. ({picked.length} selected)</p>
                      <div className="me-days" role="group" aria-label="Dates attended">
                        {rangeDates.map((d) => {
                          const existing = rangeExisting.get(d)
                          const origin = existing?.hasAttendance ? recordOrigin(existing) : null
                          const weekend = [0, 6].includes(dayOfWeekForKey(d))
                          const already = listed.has(d)
                          return (
                            <label key={d} className={`me-day${picked.includes(d) ? ' is-picked' : ''}${weekend ? ' is-weekend' : ''}`}>
                              <input type="checkbox" checked={picked.includes(d)} disabled={already} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d)))} />
                              <span className="me-day-date">{formatAccraDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                              {already ? <span className="me-day-tag">Listed</span> : origin ? <span className="me-day-tag">{origin.label}</span> : null}
                            </label>
                          )
                        })}
                      </div>
                      {range.to && rangeDates.length === MAX_RANGE_DAYS && rangeDates[rangeDates.length - 1] < range.to && <p className="me-hint">Showing the first {MAX_RANGE_DAYS} days. Narrow the range to see the rest.</p>}
                      <div className="sm-alert-actions">
                        <button type="button" className="btn btn-primary at-btn" disabled={!picked.length} onClick={addPicked}>Add {picked.length || ''} selected date{picked.length === 1 ? '' : 's'}</button>
                        <button type="button" className="btn btn-secondary at-btn" onClick={() => setPicked([])} disabled={!picked.length}>Clear selection</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {rows.length === 0 ? (
                <p className="sm-empty">No dates yet. Add a date, or pick the attended dates from a range.</p>
              ) : (
                <>
                  <div className="me-fill">
                    <span className="sh-form-label">Optional: fill empty times</span>
                    <input type="time" className="sh-form-input" aria-label="Clock-in to fill" value={fill.clockInTime} onChange={(e) => setFill((f) => ({ ...f, clockInTime: e.target.value }))} />
                    <input type="time" className="sh-form-input" aria-label="Clock-out to fill" value={fill.clockOutTime} onChange={(e) => setFill((f) => ({ ...f, clockOutTime: e.target.value }))} />
                    <button type="button" className="sm-actions-btn" onClick={applyFill} disabled={!fill.clockInTime && !fill.clockOutTime}>Fill empty rows</button>
                    <span className="me-hint">Only fills blank cells — check each day against the notebook.</span>
                  </div>
                  <div className="sm-table-wrap">
                    <table className="sm-table me-table">
                      <thead>
                        <tr><th scope="col">Date</th><th scope="col">Clock-in</th><th scope="col">Clock-out</th><th scope="col">Remark (optional)</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const p = byId.get(r.id)
                          const e = p?.errors ?? {}
                          const existingOrigin = p?.record?.hasAttendance ? recordOrigin(p.record) : null
                          return (
                            <tr key={r.id} className={Object.keys(e).length ? 'has-error' : ''}>
                              <td data-label="Date">
                                <input type="date" className={`sh-form-input${e.date ? ' has-error' : ''}`} max={today} value={r.date} onChange={(ev) => updateRow(r.id, { date: ev.target.value, replace: false })} aria-label="Attendance date" />
                                {e.date && <span className="sh-form-error">{e.date}</span>}
                              </td>
                              <td data-label="Clock-in">
                                <input type="time" className={`sh-form-input${e.clockInTime ? ' has-error' : ''}`} value={r.clockInTime} onChange={(ev) => updateRow(r.id, { clockInTime: ev.target.value })} aria-label="Clock-in time" />
                                {e.clockInTime && <span className="sh-form-error">{e.clockInTime}</span>}
                              </td>
                              <td data-label="Clock-out">
                                <input type="time" className={`sh-form-input${e.clockOutTime ? ' has-error' : ''}`} value={r.clockOutTime} onChange={(ev) => updateRow(r.id, { clockOutTime: ev.target.value })} aria-label="Clock-out time" />
                                {e.clockOutTime ? <span className="sh-form-error">{e.clockOutTime}</span> : !r.clockOutTime && r.clockInTime ? <span className="me-hint">No clock-out → Incomplete</span> : null}
                              </td>
                              <td data-label="Remark">
                                <input className="sh-form-input" value={r.remarks} maxLength={300} placeholder="e.g. From notebook p. 14" onChange={(ev) => updateRow(r.id, { remarks: ev.target.value })} aria-label="Remark" />
                              </td>
                              <td data-label="Status">
                                {!p || !r.date ? <span className="at-none">—</span> : p.state === 'new' ? (
                                  <span className="at-badge at-tone-ok">New</span>
                                ) : p.state === 'blocked' ? (
                                  <span className="at-badge at-tone-crit">Cannot enter</span>
                                ) : (
                                  <div className="me-existing">
                                    <span className="at-badge at-tone-warn">Already recorded · {existingOrigin?.label}</span>
                                    <span className="me-hint">
                                      <StatusBadge status={p.record.status} /> In {clockText(p.record.clockIn, p.record.clockInUnknown)} · Out {clockText(p.record.clockOut, p.record.clockOutUnknown)}
                                    </span>
                                    <label className="at-check">
                                      <input type="checkbox" checked={r.replace} onChange={(ev) => updateRow(r.id, { replace: ev.target.checked })} />
                                      I&apos;ve reviewed it — replace
                                    </label>
                                  </div>
                                )}
                              </td>
                              <td data-label="Remove" className="at-actions"><button type="button" className="sm-actions-btn" onClick={() => removeRow(r.id)} aria-label={`Remove ${r.date || 'row'}`}>Remove</button></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {counts.replace > 0 && (
                <div className="sh-form-field">
                  <label className="sh-form-label" htmlFor="me-reason">Reason for replacing existing records (required)</label>
                  <textarea id="me-reason" className={`sh-form-input${errors.replaceReason ? ' has-error' : ''}`} rows={2} value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} placeholder="e.g. Kiosk was offline; the notebook shows the correct times." />
                  {errors.replaceReason && <span className="sh-form-error">{errors.replaceReason}</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {employee && rows.length > 0 && (
          <div className="me-foot">
            <span className="me-counts">
              <strong>{counts.new}</strong> new · <strong>{counts.replace}</strong> to replace
              {counts.review > 0 && <> · <strong className="me-warn">{counts.review}</strong> need review</>}
              {counts.invalid > 0 && <> · <strong className="me-warn">{counts.invalid}</strong> with errors</>}
            </span>
            <button type="button" className="btn btn-primary at-btn" disabled={!canSave} onClick={() => setConfirming(true)}>Save {rows.length} attendance record{rows.length === 1 ? '' : 's'}</button>
          </div>
        )}
      </div>

      {confirming && (
        <div className="sm-modal-overlay" role="presentation">
          <div className="nt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="me-confirm-title" style={{ marginTop: '12vh' }}>
            <h3 id="me-confirm-title">Save manual attendance?</h3>
            <ul className="hu-change-list">
              <li>{employee.fullName} ({employee.employeeId}) · {companyDisplayName(companyId)}</li>
              <li>{counts.new} new day{counts.new === 1 ? '' : 's'} recorded as Manual Entry</li>
              {counts.replace > 0 && <li>{counts.replace} existing record{counts.replace === 1 ? '' : 's'} replaced — the previous values are kept in the history</li>}
              <li>Saved as entered by {user.name}; recorded in the audit log</li>
              <li>Dates you did not add are not changed or marked absent</li>
            </ul>
            <div className="sm-alert-actions">
              <button type="button" className="btn btn-primary" onClick={save}>Confirm and save</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Back</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

