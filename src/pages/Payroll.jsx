import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { listPayPeriods } from '../utils/payPeriod'
import { formatCedis, formatOvertime } from '../services/overtimeService'
import { getPaymentMethodLabel } from '../constants/paymentMethods'
import { CATEGORIES } from '../constants/employeeCategories'
import { recordExport } from '../services/auditStore'
import { downloadBlob } from '../utils/exportFiles'
import {
  EXPORT_KINDS,
  PAYROLL_CATEGORIES,
  addPayrollAdjustment,
  approveOvertime,
  approvePayroll,
  buildPayroll,
  canApprovePayroll,
  canEditPayroll,
  canExportPayroll,
  employeeBreakdownRows,
  exportBlob,
  exportTables,
  markPayrollPaid,
  payrollVersion,
  previewLine,
  savePeriodInputs,
  subscribePayroll,
  totalsOf,
  withdrawOvertime,
} from '../services/payrollService'
import { OVERRIDE_GROUPS, RUN_STATUS, TAX_METHODS } from '../services/payroll/payrollRules'
import { payslipModel, payslipPdf, printPayslip } from '../services/payroll/payslip'
import SalaryProfileModal from '../components/payroll/SalaryProfileModal'
import { SourceBadge } from '../components/payroll/StructureFields'
import '../styles/payroll.css'

const usePayrollStore = () => useSyncExternalStore(subscribePayroll, payrollVersion, payrollVersion)

function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
)

function StatusChip({ status }) {
  return <span className={`py-status py-status-${RUN_STATUS[status]?.tone ?? 'draft'}`}>{RUN_STATUS[status]?.label ?? status}</span>
}

/* ------------------------------------------------------------- payslip */

function PayslipModal({ line, period, onClose }) {
  useEscape(onClose)
  const m = payslipModel(line, period)
  const fileBase = `payslip-${line.staffId}-${period.key}`
  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal py-payslip-modal" role="dialog" aria-modal="true" aria-labelledby="py-slip-title">
        <div className="sm-modal-head">
          <div><h3 id="py-slip-title">Payslip preview</h3><p>{line.fullName} · {period.label}</p></div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="sm-modal-body">
          <article className="py-slip">
            <header className="py-slip-head">
              <div><h4>Payslip</h4><span>{m.period}</span></div>
              <div className="py-slip-co"><strong>{line.companyName}</strong><span>{m.status}</span></div>
            </header>
            <dl className="py-slip-emp">{m.employee.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <div className="py-slip-cols">
              {[['Earnings', m.earnings, 'Gross earnings', m.gross], ['Deductions', m.deductions, 'Total deductions', m.totalDeductions]].map(([title, items, totalLabel, total]) => (
                <table key={title} className="py-slip-table">
                  <thead><tr><th scope="col">{title}</th><th scope="col" className="py-num">GH₵</th></tr></thead>
                  <tbody>{items.map((i) => <tr key={i.label}><td>{i.label}{i.note && <small>{i.note}</small>}</td><td className="py-num">{formatCedis(i.amount)}</td></tr>)}</tbody>
                  <tfoot><tr><td>{totalLabel}</td><td className="py-num">{formatCedis(total)}</td></tr></tfoot>
                </table>
              ))}
            </div>
            {m.adjustments.length > 0 && (
              <table className="py-slip-table">
                <thead><tr><th scope="col">Adjustments after approval</th><th scope="col" className="py-num">GH₵</th></tr></thead>
                <tbody>{m.adjustments.map((a, i) => <tr key={i}><td>{a.label}<small>{a.note}</small></td><td className="py-num">{formatCedis(a.amount)}</td></tr>)}</tbody>
              </table>
            )}
            <div className="py-slip-net"><span>Take-home pay</span><strong>{formatCedis(m.takeHome)}</strong></div>
            <div className="py-slip-employer"><span>Employer SSNIT ({m.employerRate}% of basic) — paid by the company, not deducted</span><strong>{formatCedis(m.employerSsnit)}</strong></div>
            {m.employerOvertimeVat > 0 && <div className="py-slip-employer"><span>{m.employerOvertimeVatNote}</span><strong>{formatCedis(m.employerOvertimeVat)}</strong></div>}
            <p className="py-slip-foot">Tax method: {m.taxMethod} · {m.rules}</p>
          </article>
        </div>
        <div className="sm-modal-foot py-foot">
          <button type="button" className="btn btn-secondary" onClick={() => printPayslip(line, period)}>Print</button>
          <button type="button" className="btn btn-primary" onClick={() => downloadBlob(`${fileBase}.pdf`, payslipPdf(line, period))}>Download PDF</button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- drawer */

const INPUT_FIELDS = [
  ['bonus', 'Bonus', 'earn'],
  ['commission', 'Commission', 'earn'],
  ['otherEarnings', 'Other earnings', 'earn'],
  ['loan', 'Loan repayment', 'ded'],
  ['advance', 'Salary advance', 'ded'],
  ['otherDeduction', 'Other deduction', 'ded'],
]

function PayrollDrawer({ line, period, user, onClose, onProfile, onPayslip }) {
  useEscape(onClose)
  const draft = line.status === 'draft'
  const editable = draft && canEditPayroll(user, line.companyId)
  const approver = canApprovePayroll(user, line.companyId)
  const [inputs, setInputs] = useState(() => Object.fromEntries(INPUT_FIELDS.map(([k]) => [k, line.inputs?.[k] ? String(line.inputs[k]) : ''])))
  const [note, setNote] = useState(line.inputs?.note ?? '')
  const [msg, setMsg] = useState('')
  const [adj, setAdj] = useState({ type: 'earning', amount: '', reason: '' })
  const [adjErrors, setAdjErrors] = useState({})
  const changed = INPUT_FIELDS.some(([k]) => Number(inputs[k] || 0) !== Number(line.inputs?.[k] || 0)) || note !== (line.inputs?.note ?? '')
  const live = draft && changed ? { ...line, calc: previewLine(line, { inputs }, period) } : line
  const c = live.calc
  const rows = employeeBreakdownRows(live)

  const saveInputs = () => {
    const r = savePeriodInputs({ user, companyId: line.companyId, period, staffId: line.staffId, inputs: { ...inputs, note } })
    setMsg(r.error ?? 'Saved — take-home recalculated.')
  }
  const saveAdj = () => {
    const r = addPayrollAdjustment({ user, companyId: line.companyId, period, staffId: line.staffId, ...adj })
    if (r.errors) { setAdjErrors(r.errors); return }
    if (r.error) { setMsg(r.error); return }
    setAdj({ type: 'earning', amount: '', reason: '' })
    setAdjErrors({})
    setMsg('Adjustment recorded. The approved figures stay unchanged; the adjustment is shown separately.')
  }

  return (
    <div className="nt-drawer-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="nt-drawer py-drawer" role="dialog" aria-modal="true" aria-labelledby="py-drawer-title">
        <header className="nt-drawer-head">
          <div>
            <h3 id="py-drawer-title">{line.fullName}</h3>
            <p className="nt-muted">{line.staffId} · {line.companyName} · {line.categoryLabel} · <StatusChip status={line.status} /></p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="nt-drawer-body">
          <div className="ot-mini-stats">
            <div><span>Gross</span><strong>{formatCedis(c.gross)}</strong></div>
            <div><span>Deductions</span><strong>{formatCedis(c.totalDeductions)}</strong></div>
            <div><span>Take-home</span><strong className="py-net">{formatCedis(live.adjustedTakeHome !== undefined && !changed ? live.adjustedTakeHome : c.takeHome)}</strong></div>
          </div>

          {draft && (
            <div className="py-sources">
              {OVERRIDE_GROUPS.map((g) => <span key={g.key}>{g.label}: <SourceBadge source={line.sources?.[g.key] ?? 'none'} /></span>)}
            </div>
          )}
          {!line.hasStructure && <p className="hu-warning">No salary structure applies to this employee. Set the {line.categoryLabel} salary in Salary Structures, or give an individual override.</p>}

          <section>
            <h4 className="py-sub">Calculation{draft && changed ? ' — preview, not saved' : ''}</h4>
            <div className="sm-table-wrap">
              <table className="sm-table py-break">
                <tbody>
                  {rows.map(([section, item, amount], i) => (
                    <tr key={i} className={section === 'Total' ? 'py-break-total' : section.startsWith('Employer') ? 'py-break-employer' : ''}>
                      <td className="py-break-sec">{section}</td>
                      <td>{item}</td>
                      <td className="py-num">{section === 'Deductions' ? '−' : ''}{formatCedis(amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="py-hint">
              Gross = basic + allowances + bonus + commission + approved overtime + other earnings. Take-home = gross − (Tier 2 + employee SSNIT + VAT + other deductions).
              {` Tier 2 = ${c.tier2Rate ?? 0}% of basic (set by HR). VAT on salary = ${c.salaryVat?.rate ?? 0}% of basic + allowances.`}
              {c.taxMethod === 'manual' ? ' SSNIT entered manually by HR.' : ''}
            </p>
          </section>

          <section>
            <h4 className="py-sub">Overtime</h4>
            {!c.overtime.eligible ? <p className="sm-muted">Not eligible for overtime pay.</p> : (
              <div className="py-ot">
                <span>Recorded: <strong>{formatOvertime(line.overtimeRecorded?.minutes ?? 0)}</strong></span>
                <span>Approved: <strong>{c.overtime.approved ? formatOvertime(c.overtime.minutes) : '—'}</strong></span>
                <span>Pay: <strong>{formatCedis(c.overtime.pay)}</strong> {c.overtime.rateSource === 'company' ? '(company rate, per day)' : `(${formatCedis(c.overtime.rate)}/h)`}</span>
                {line.overtimeChanged && <span className="py-warn">Attendance changed after approval — re-approve to pay the new figure.</span>}
                {draft && approver && (line.overtimeRecorded?.minutes > 0) && (
                  <span className="py-ot-actions">
                    {(!c.overtime.approved || line.overtimeChanged) && <button type="button" className="btn btn-primary at-btn" onClick={() => approveOvertime({ user, companyId: line.companyId, period, staffIds: [line.staffId] })}>Approve {formatOvertime(line.overtimeRecorded.minutes)}</button>}
                    {c.overtime.approved && <button type="button" className="btn btn-secondary at-btn" onClick={() => withdrawOvertime({ user, companyId: line.companyId, period, staffId: line.staffId })}>Withdraw approval</button>}
                  </span>
                )}
              </div>
            )}
          </section>

          {draft ? (
            <section>
              <h4 className="py-sub">This period&apos;s earnings and deductions</h4>
              <div className="py-inputs">
                {INPUT_FIELDS.map(([k, label, kind]) => (
                  <div className="py-field" key={k}>
                    <label className="py-label" htmlFor={`py-in-${k}`}>{label} <span className="sm-muted">({kind === 'earn' ? 'adds' : 'deducts'})</span></label>
                    <input id={`py-in-${k}`} className="form-input" type="number" inputMode="decimal" min="0" step="0.01" value={inputs[k]} onChange={(e) => setInputs((v) => ({ ...v, [k]: e.target.value }))} disabled={!editable} />
                  </div>
                ))}
                <div className="py-field py-inputs-note">
                  <label className="py-label" htmlFor="py-in-note">Note</label>
                  <input id="py-in-note" className="form-input" value={note} onChange={(e) => setNote(e.target.value)} disabled={!editable} placeholder="e.g. Advance agreed 4 Nov" />
                </div>
              </div>
              {editable && <div className="py-actions"><button type="button" className="btn btn-primary" onClick={saveInputs} disabled={!changed}>Save and recalculate</button></div>}
            </section>
          ) : (
            <section>
              <h4 className="py-sub">Controlled adjustment</h4>
              <p className="py-hint">This payroll is {line.status}. Its figures are frozen. Add an adjustment with a reason; it is shown separately on the payslip and in the log.</p>
              {line.adjustments.length > 0 && (
                <ul className="py-log">{line.adjustments.map((a) => <li key={a.id}><strong>{a.type === 'earning' ? '+' : '−'}{formatCedis(a.amount)}</strong> · {a.reason} <span className="sm-muted">— {a.by}, {new Date(a.at).toLocaleString('en-GH')}</span></li>)}</ul>
              )}
              {approver && (
                <div className="py-inputs">
                  <div className="py-field">
                    <label className="py-label" htmlFor="py-adj-type">Type</label>
                    <select id="py-adj-type" className="sm-select" value={adj.type} onChange={(e) => setAdj((a) => ({ ...a, type: e.target.value }))}>
                      <option value="earning">Add to pay</option>
                      <option value="deduction">Deduct from pay</option>
                    </select>
                  </div>
                  <div className="py-field">
                    <label className="py-label" htmlFor="py-adj-amt">Amount (GH₵)</label>
                    <input id="py-adj-amt" className="form-input" type="number" min="0" step="0.01" value={adj.amount} onChange={(e) => setAdj((a) => ({ ...a, amount: e.target.value }))} aria-invalid={Boolean(adjErrors.amount)} />
                    {adjErrors.amount && <p className="py-error">{adjErrors.amount}</p>}
                  </div>
                  <div className="py-field py-inputs-note">
                    <label className="py-label" htmlFor="py-adj-reason">Reason</label>
                    <input id="py-adj-reason" className="form-input" value={adj.reason} onChange={(e) => setAdj((a) => ({ ...a, reason: e.target.value }))} aria-invalid={Boolean(adjErrors.reason)} />
                    {adjErrors.reason && <p className="py-error">{adjErrors.reason}</p>}
                  </div>
                  <div className="py-actions"><button type="button" className="btn btn-primary" onClick={saveAdj}>Record adjustment</button></div>
                </div>
              )}
            </section>
          )}
          {msg && <p className="py-notice" role="status">{msg}</p>}

          <div className="py-actions py-drawer-actions">
            {draft && <button type="button" className="btn btn-secondary" onClick={onProfile}>Salary profile &amp; overrides</button>}
            <button type="button" className="btn btn-primary" onClick={onPayslip}>Payslip</button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------- export */

function ExportModal({ payroll, period, lines, onClose }) {
  useEscape(onClose)
  const [kind, setKind] = useState('all')
  const [format, setFormat] = useState('xlsx')
  const [categoryId, setCategoryId] = useState(PAYROLL_CATEGORIES[0])
  const [staffId, setStaffId] = useState(lines[0]?.staffId ?? '')
  const run = () => {
    const scoped = { ...payroll, lines: kind === 'company' || kind === 'statutory' || kind === 'all' || kind === 'overtime' ? lines : payroll.lines }
    const tables = exportTables({ kind, payroll: scoped, period, categoryId, staffId })
    if (!tables.length || (tables[0].rows.length === 0)) return
    const ext = format
    const scope = kind === 'employee' ? staffId : kind === 'category' ? categoryId : kind
    downloadBlob(`payroll-${scope}-${period.key}.${ext}`, exportBlob(tables, format, `Workforce Pro · Payroll · ${period.label}`))
    recordExport({ action: 'Payroll exported', category: 'Payroll', source: 'Payroll', companyIds: payroll.companyIds, affected: `${period.label} period`, description: `${EXPORT_KINDS.find((k) => k.id === kind).label} (${format.toUpperCase()}).` })
    onClose()
  }
  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal py-export" role="dialog" aria-modal="true" aria-labelledby="py-export-title">
        <div className="sm-modal-head">
          <div><h3 id="py-export-title">Export payroll</h3><p>{period.label} · amounts in GH₵</p></div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="sm-modal-body">
          <fieldset className="py-choice">
            <legend>What to export</legend>
            {EXPORT_KINDS.map((k) => (
              <label key={k.id} className={kind === k.id ? 'is-on' : ''}>
                <input type="radio" name="py-kind" checked={kind === k.id} onChange={() => setKind(k.id)} />
                <span><strong>{k.label}</strong></span>
              </label>
            ))}
          </fieldset>
          {kind === 'category' && (
            <div className="py-field">
              <label className="py-label" htmlFor="py-exp-cat">Category</label>
              <select id="py-exp-cat" className="sm-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {PAYROLL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORIES[c].label}</option>)}
              </select>
            </div>
          )}
          {kind === 'employee' && (
            <div className="py-field">
              <label className="py-label" htmlFor="py-exp-emp">Employee</label>
              <select id="py-exp-emp" className="sm-select" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {payroll.lines.map((l) => <option key={l.staffId} value={l.staffId}>{l.fullName} ({l.staffId})</option>)}
              </select>
            </div>
          )}
          <div className="py-field">
            <span className="py-label">Format</span>
            <div className="py-segment" role="radiogroup" aria-label="Format">
              {[['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV'], ['pdf', 'PDF']].map(([f, label]) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} className={format === f ? 'is-on' : ''} onClick={() => setFormat(f)}>{label}</button>
              ))}
            </div>
          </div>
          {['all', 'statutory', 'overtime'].includes(kind) && lines.length !== payroll.lines.length && <p className="py-hint">Exports the {lines.length} employees matching your current filters.</p>}
        </div>
        <div className="sm-modal-foot py-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={run} disabled={!payroll.lines.length}>Export</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- page */

export default function Payroll({ user, company, companies = [], onNavigate }) {
  const store = usePayrollStore()
  const periods = useMemo(() => listPayPeriods(12), [])
  const [periodKey, setPeriodKey] = useState(periods[0].key)
  const period = periods.find((p) => p.key === periodKey) ?? periods[0]
  const [companyFilter, setCompanyFilter] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const [profile, setProfile] = useState(null)
  const [slip, setSlip] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState('')
  const scopeId = company?.id || companyFilter

  const payroll = useMemo(
    () => buildPayroll({ user, companyId: scopeId, period }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, scopeId, period.key, store],
  )
  const combined = payroll.companyIds.length > 1
  const term = search.trim().toLowerCase()
  const lines = payroll.lines
    .map((l) => ({ ...l, paymentMethodLabel: getPaymentMethodLabel(l.paymentMethod) || l.paymentMethod }))
    .filter((l) => (!category || l.categoryId === category)
      && (!status || l.status === status)
      && (!term || l.fullName.toLowerCase().includes(term) || l.staffId.toLowerCase().includes(term)))
  const totals = totalsOf(lines)
  const openLine = open ? payroll.lines.find((l) => l.staffId === open) : null
  const withLabel = (l) => (l ? { ...l, paymentMethodLabel: getPaymentMethodLabel(l.paymentMethod) || l.paymentMethod } : l)

  const act = (fn, done) => {
    const r = fn()
    if (r.error) setNotice(r.error)
    else setNotice(done(r))
    setConfirm(null)
  }

  return (
    <div className="sm-page py-page">
      <div className="sm-head">
        <div>
          <h2>Payroll</h2>
          <p>Salaries from each category&apos;s structure (or the employee&apos;s override), approved overtime from Attendance, Tier 2 and SSNIT — {period.label} period (26th–25th).</p>
        </div>
        <div className="at-head-actions">
          <button type="button" className="btn btn-secondary at-btn" onClick={() => onNavigate?.('payroll-settings')}>Salary structures</button>
          {canExportPayroll(user) && <button type="button" className="btn btn-primary at-btn" onClick={() => setExporting(true)} disabled={!payroll.lines.length}>Export payroll</button>}
        </div>
      </div>

      {notice && <p className="py-notice" role="status">{notice} <button type="button" className="hr-link" onClick={() => setNotice('')}>Dismiss</button></p>}

      <div className="sm-controls py-controls">
        <label className="sr-only" htmlFor="py-period">Payroll period</label>
        <select id="py-period" className="sm-select" value={period.key} onChange={(e) => setPeriodKey(e.target.value)}>
          {periods.map((p) => <option key={p.key} value={p.key}>{p.label} period</option>)}
        </select>
        {!company?.id && companies.length > 1 && (
          <>
            <label className="sr-only" htmlFor="py-company">Company</label>
            <select id="py-company" className="sm-select" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
              <option value="">All my companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="py-cat">Category</label>
        <select id="py-cat" className="sm-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {PAYROLL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORIES[c].label}</option>)}
        </select>
        <label className="sr-only" htmlFor="py-status-f">Payroll status</label>
        <select id="py-status-f" className="sm-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {Object.entries(RUN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="search" className="form-input sm-search" placeholder="Search name or Staff ID…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employees" />
      </div>

      <div className="py-runs">
        {payroll.companyIds.map((cid) => {
          const run = payroll.runs[cid]
          const cl = payroll.lines.filter((l) => l.companyId === cid)
          const t = totalsOf(cl)
          const name = cl[0]?.companyName ?? companies.find((c) => c.id === cid)?.name ?? cid
          const approver = canApprovePayroll(user, cid)
          const pendingIds = cl.filter((l) => l.status === 'draft' && (l.calc.overtime.pending || l.overtimeChanged)).map((l) => l.staffId)
          return (
            <section key={cid} className="py-run" aria-label={`${name} payroll status`}>
              <div className="py-run-head">
                <strong>{name}</strong>
                <StatusChip status={run.status} />
              </div>
              <p className="sm-muted">
                {run.status === 'draft' ? 'Recalculates automatically when salaries, overtime or deductions change.'
                  : `Approved ${new Date(run.approvedAt).toLocaleString('en-GH')} by ${run.approvedBy}${run.status === 'paid' ? ` · paid ${new Date(run.paidAt).toLocaleDateString('en-GH')}` : ''}. Figures are frozen.`}
              </p>
              <div className="py-run-figs"><span>{t.employees} employees</span><span>Take-home {formatCedis(t.takeHome)}</span>{t.noStructure > 0 && <span className="py-warn">{t.noStructure} without salary structure</span>}</div>
              {approver && run.status === 'draft' && (
                <div className="py-run-actions">
                  {pendingIds.length > 0 && <button type="button" className="btn btn-secondary at-btn" onClick={() => act(() => approveOvertime({ user, companyId: cid, period, staffIds: pendingIds }), (r) => `Approved overtime for ${r.count} employee${r.count === 1 ? '' : 's'} at ${name}. Take-home recalculated.`)}>Approve overtime ({pendingIds.length})</button>}
                  <button type="button" className="btn btn-primary at-btn" disabled={!cl.length} onClick={() => setConfirm({ kind: 'approve', cid, name, count: cl.length, pending: pendingIds.length, noStructure: t.noStructure })}>Approve payroll</button>
                </div>
              )}
              {approver && run.status === 'approved' && (
                <div className="py-run-actions"><button type="button" className="btn btn-primary at-btn" onClick={() => setConfirm({ kind: 'paid', cid, name })}>Mark as paid</button></div>
              )}
            </section>
          )
        })}
      </div>

      <div className="sm-stats" role="status" aria-label="Payroll summary">
        <div className="sm-stat"><span className="sm-stat-label">Employees</span><span className="sm-stat-value">{totals.employees}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Gross earnings</span><span className="sm-stat-value">{formatCedis(totals.gross)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Overtime earnings</span><span className="sm-stat-value">{formatCedis(totals.overtime)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Total deductions</span><span className="sm-stat-value">{formatCedis(totals.deductions)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Take-home</span><span className="sm-stat-value sm-stat-accent">{formatCedis(totals.takeHome)}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Employer SSNIT (cost)</span><span className="sm-stat-value">{formatCedis(totals.employerSsnit)}</span></div>
        {totals.salaryVat > 0 && <div className="sm-stat"><span className="sm-stat-label">VAT on salary</span><span className="sm-stat-value">{formatCedis(totals.salaryVat)}</span></div>}
        {totals.overtimeVatDeducted > 0 && <div className="sm-stat"><span className="sm-stat-label">VAT on overtime (deducted)</span><span className="sm-stat-value">{formatCedis(totals.overtimeVatDeducted)}</span></div>}
        {totals.employerOvertimeVat > 0 && <div className="sm-stat"><span className="sm-stat-label">VAT on overtime (company cost)</span><span className="sm-stat-value">{formatCedis(totals.employerOvertimeVat)}</span></div>}
        {totals.pendingOvertime > 0 && <div className="sm-stat"><span className="sm-stat-label">Overtime awaiting approval</span><span className="sm-stat-value sm-stat-warn">{totals.pendingOvertime}</span></div>}
      </div>

      <section className="sm-panel">
        <div className="sm-panel-head at-table-head">
          <h3>Payroll</h3>
          <span className="sm-muted">{lines.length} of {payroll.lines.length} employees · click a row for the full calculation</span>
        </div>
        {lines.length === 0 ? (
          <p className="sm-empty">{payroll.lines.length ? 'No employees match your filters.' : 'Nobody is on payroll for this period.'}</p>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table py-table">
              <thead>
                <tr>
                  <th scope="col">Staff ID</th><th scope="col">Employee</th>{combined && <th scope="col">Company</th>}<th scope="col">Category</th><th scope="col">Salary structure</th>
                  <th scope="col" className="py-num">Basic</th><th scope="col" className="py-num">Allowances</th><th scope="col" className="py-num">OT hours</th><th scope="col" className="py-num">OT earnings</th>
                  <th scope="col" className="py-num">Gross</th><th scope="col" className="py-num">Tier 2</th><th scope="col" className="py-num">Emp. SSNIT</th><th scope="col" className="py-num">VAT</th><th scope="col" className="py-num">Other ded.</th><th scope="col" className="py-num">Total ded.</th>
                  <th scope="col" className="py-num">Take-home</th><th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.companyId}-${l.staffId}`} className="py-row" tabIndex={0} onClick={() => setOpen(l.staffId)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(l.staffId) } }} aria-label={`${l.fullName}, take-home ${formatCedis(l.adjustedTakeHome)}. Open calculation.`}>
                    <td data-label="Staff ID" className="sm-mono">{l.staffId}</td>
                    <td data-label="Employee"><span className="at-emp-name">{l.fullName}</span></td>
                    {combined && <td data-label="Company">{l.companyName}</td>}
                    <td data-label="Category">{l.categoryLabel}</td>
                    <td data-label="Salary structure"><span className={l.hasStructure ? '' : 'py-warn'}>{l.structureLabel}</span>{l.status === 'draft' && Object.values(l.sources).includes('override') && <> <SourceBadge source="override" /></>}</td>
                    <td data-label="Basic" className="py-num">{formatCedis(l.calc.basicPay)}</td>
                    <td data-label="Allowances" className="py-num">{formatCedis(l.calc.allowanceTotal)}</td>
                    <td data-label="OT hours" className="py-num">{l.calc.overtime.hours.toFixed(2)}{l.status === 'draft' && (l.calc.overtime.pending || l.overtimeChanged) && <span className="py-pending" title="Overtime awaiting approval"> •</span>}</td>
                    <td data-label="OT earnings" className="py-num">{formatCedis(l.calc.overtime.pay)}</td>
                    <td data-label="Gross" className="py-num">{formatCedis(l.calc.gross)}</td>
                    <td data-label="Tier 2" className="py-num">{formatCedis(l.calc.paye)}{l.calc.tier2Rate === null && <span className="py-tag" title="Tier 2 percentage not set">!</span>}</td>
                    <td data-label="Emp. SSNIT" className="py-num">{formatCedis(l.calc.ssnitEmployee)}{l.calc.taxMethod === 'manual' && <span className="py-tag" title={TAX_METHODS.manual.label}>M</span>}</td>
                    <td data-label="VAT" className="py-num">{formatCedis(l.calc.vatDeducted ?? 0)}</td>
                    <td data-label="Other ded." className="py-num">{formatCedis(l.calc.otherDeductionsTotal)}</td>
                    <td data-label="Total ded." className="py-num">{formatCedis(l.calc.totalDeductions)}</td>
                    <td data-label="Take-home" className="py-num"><strong>{formatCedis(l.adjustedTakeHome)}</strong></td>
                    <td data-label="Status"><StatusChip status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={combined ? 5 : 4}>Total ({totals.employees})</th>
                  <td className="py-num">{formatCedis(totals.basic)}</td>
                  <td className="py-num">{formatCedis(totals.allowances)}</td>
                  <td className="py-num">{totals.overtimeHours.toFixed(2)}</td>
                  <td className="py-num">{formatCedis(totals.overtime)}</td>
                  <td className="py-num">{formatCedis(totals.gross)}</td>
                  <td className="py-num">{formatCedis(totals.paye)}</td>
                  <td className="py-num">{formatCedis(totals.ssnitEmployee)}</td>
                  <td className="py-num">{formatCedis(totals.vatDeducted)}</td>
                  <td className="py-num">{formatCedis(totals.otherDeductions)}</td>
                  <td className="py-num">{formatCedis(totals.deductions)}</td>
                  <td className="py-num"><strong>{formatCedis(totals.takeHome)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="at-rules">! = Tier 2 percentage not set for the salary structure. M = SSNIT entered manually by HR. VAT = VAT on salary (basic + allowances) + VAT on overtime when deducted. • = overtime recorded but not yet approved (not paid). Employer SSNIT is a company cost and is never deducted from take-home pay.</p>
      </section>

      {openLine && !profile && !slip && (
        <PayrollDrawer key={openLine.staffId} line={withLabel(openLine)} period={period} user={user} onClose={() => setOpen(null)} onProfile={() => setProfile(openLine)} onPayslip={() => setSlip(withLabel(openLine))} />
      )}
      {profile && (
        <SalaryProfileModal user={user} line={profile} period={period} onClose={() => setProfile(null)} onSaved={() => { setProfile(null); setNotice(`Salary profile saved for ${profile.fullName}. Draft payroll recalculated.`) }} />
      )}
      {slip && <PayslipModal line={slip} period={period} onClose={() => setSlip(null)} />}
      {exporting && <ExportModal payroll={payroll} period={period} lines={lines} onClose={() => setExporting(false)} />}

      {confirm && (
        <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(null) }}>
          <div className="sm-modal py-confirm" role="alertdialog" aria-modal="true" aria-labelledby="py-c-title">
            <div className="sm-modal-head"><h3 id="py-c-title">{confirm.kind === 'approve' ? `Approve ${confirm.name} payroll — ${period.label}` : `Mark ${confirm.name} payroll as paid`}</h3></div>
            <div className="sm-modal-body">
              {confirm.kind === 'approve' ? (
                <>
                  <p>{confirm.count} payslips will be frozen with today&apos;s figures. After approval, figures change only through controlled adjustments with a reason.</p>
                  {confirm.pending > 0 && <p className="py-warn">{confirm.pending} employee{confirm.pending === 1 ? ' has' : 's have'} overtime that is not approved. It will NOT be paid in this payroll.</p>}
                  {confirm.noStructure > 0 && <p className="py-warn">{confirm.noStructure} employee{confirm.noStructure === 1 ? ' has' : 's have'} no salary structure and will be paid GH₵0.00.</p>}
                </>
              ) : <p>Record that {confirm.name}&apos;s approved {period.label} payroll has been paid. Payslips will show “Paid”.</p>}
            </div>
            <div className="sm-modal-foot py-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => (confirm.kind === 'approve'
                ? act(() => approvePayroll({ user, companyId: confirm.cid, period }), () => `${confirm.name} ${period.label} payroll approved and frozen.`)
                : act(() => markPayrollPaid({ user, companyId: confirm.cid, period }), () => `${confirm.name} ${period.label} payroll marked as paid.`))}
              >{confirm.kind === 'approve' ? 'Approve and freeze' : 'Mark as paid'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
