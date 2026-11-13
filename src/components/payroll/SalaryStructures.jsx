import { useMemo, useState } from 'react'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'
import { formatCedis } from '../../services/overtimeService'
import { overtimeRateFor, vatRateFor } from '../../services/settingsService'
import {
  PAY_TYPES,
  canEditPayroll,
  listCategoryStructures,
  payrollLog,
  previewStructure,
  previewStructureChange,
  saveCategoryStructure,
} from '../../services/payrollService'
import { emptyStructure, normaliseStructure, validateStructure } from '../../services/payroll/payrollRules'
import { GH_STATUTORY_VERSIONS, statutoryRulesFor } from '../../services/payroll/statutory'
import { AllowancesEditor, DeductionsEditor, OvertimeEditor, PayEditor, TaxEditor } from './StructureFields'
import '../../styles/payroll.css'

/** Editable copy of a structure (numbers as text while typing). */
const draftOf = (structure) => structuredClone(structure ?? emptyStructure())

function ConfirmSave({ companyName, category, first, onCancel, onConfirm, companyId, saving }) {
  const today = accraTodayKey()
  const [appliesTo, setAppliesTo] = useState(first ? 'all' : 'new')
  const [effectiveFrom, setEffectiveFrom] = useState(today)
  const preview = previewStructureChange({ companyId, categoryId: category.categoryId, appliesTo, effectiveFrom })
  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="sm-modal py-confirm" role="dialog" aria-modal="true" aria-labelledby="py-confirm-title">
        <div className="sm-modal-head">
          <h3 id="py-confirm-title">Save {category.label} salary — {companyName}</h3>
        </div>
        <div className="sm-modal-body">
          {first ? (
            <p>This is the first salary structure for <strong>{category.label}</strong> at {companyName}. It becomes the default for every {category.label.toLowerCase()} employee and for new registrations.</p>
          ) : (
            <fieldset className="py-choice">
              <legend>Who gets the new salary?</legend>
              <label className={appliesTo === 'new' ? 'is-on' : ''}>
                <input type="radio" name="py-applies" checked={appliesTo === 'new'} onChange={() => setAppliesTo('new')} />
                <span><strong>A. Future registrations only</strong><small>Employees who join on or after the date below. Existing staff keep their current salary.</small></span>
              </label>
              <label className={appliesTo === 'all' ? 'is-on' : ''}>
                <input type="radio" name="py-applies" checked={appliesTo === 'all'} onChange={() => setAppliesTo('all')} />
                <span><strong>B. Existing employees too</strong><small>Everyone in the category from the effective date. Earlier periods keep the old salary.</small></span>
              </label>
            </fieldset>
          )}
          <div className="py-field">
            <label className="py-label" htmlFor="py-eff">Effective date</label>
            <input id="py-eff" type="date" className="form-input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div className="py-impact" role="status">
            {appliesTo === 'all' || first ? (
              <>
                <strong>{preview.affected} employee{preview.affected === 1 ? '' : 's'} will be affected</strong>
                <span>{preview.withOverrides ? `${preview.withOverrides} of them have an individual override — their overridden values stay as they are.` : 'None of them has an individual override.'}</span>
              </>
            ) : (
              <>
                <strong>0 existing employees will change</strong>
                <span>Applies to new {category.label.toLowerCase()} registered from {formatAccraDate(effectiveFrom || today)}. {preview.total} current employee{preview.total === 1 ? '' : 's'} keep their salary.</span>
              </>
            )}
            {preview.frozenPeriods.length > 0 && <span className="py-warn">Approved payroll for {preview.frozenPeriods.join(', ')} stays unchanged. Use a controlled adjustment if those payslips must change.</span>}
            <span>Draft payroll is recalculated as soon as you save.</span>
          </div>
        </div>
        <div className="sm-modal-foot py-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!effectiveFrom || saving} onClick={() => onConfirm({ appliesTo: first ? 'all' : appliesTo, effectiveFrom })}>
            {first || appliesTo === 'all' ? `Save and apply to ${preview.affected}` : 'Save for new registrations'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Group({ title, hint, children }) {
  return (
    <section className="py-group">
      <header><h4>{title}</h4>{hint && <span className="sm-muted">{hint}</span>}</header>
      {children}
    </section>
  )
}

function PreviewCard({ structure, companyRate, companyId }) {
  const [otHours, setOtHours] = useState('5')
  const errors = validateStructure(structure)
  const valid = !Object.keys(errors).length
  const calc = valid ? previewStructure(normaliseStructure(structure), { overtimeHours: otHours, companyRate, companyId }) : null
  return (
    <aside className="py-preview" aria-live="polite">
      <h4>Live take-home preview</h4>
      <p className="sm-muted">One full month{structure.payType === 'daily' ? ' (22 days)' : structure.payType === 'hourly' ? ' (176 hours)' : ''}, with example overtime.</p>
      <div className="py-field">
        <label className="py-label" htmlFor="py-prev-ot">Example approved overtime (hours)</label>
        <input id="py-prev-ot" className="form-input" type="number" min="0" step="0.5" value={otHours} onChange={(e) => setOtHours(e.target.value)} />
      </div>
      {!calc ? <p className="py-hint">Fix the highlighted fields to see the preview.</p> : (
        <dl className="py-sum">
          <div><dt>Basic</dt><dd>{formatCedis(calc.basicPay)}</dd></div>
          <div><dt>Allowances</dt><dd>{formatCedis(calc.allowanceTotal)}</dd></div>
          <div><dt>Overtime{calc.overtime.eligible ? ` (${calc.overtime.hours} h)` : ''}</dt><dd>{calc.overtime.eligible ? formatCedis(calc.overtime.pay) : 'Not eligible'}</dd></div>
          <div className="py-sum-total"><dt>Gross earnings</dt><dd>{formatCedis(calc.gross)}</dd></div>
          <div><dt>Tier 2{calc.tier2Rate !== null ? ` (${calc.tier2Rate}% of basic)` : ' (not set)'}</dt><dd>−{formatCedis(calc.paye)}</dd></div>
          <div><dt>Employee SSNIT</dt><dd>−{formatCedis(calc.ssnitEmployee)}</dd></div>
          {calc.salaryVat.amount > 0 && <div><dt>VAT on salary ({calc.salaryVat.rate}% of basic + allowances)</dt><dd>−{formatCedis(calc.salaryVat.amount)}</dd></div>}
          {calc.overtimeVatDeduction > 0 && <div><dt>VAT on overtime ({calc.overtime.vat.rate}%)</dt><dd>−{formatCedis(calc.overtimeVatDeduction)}</dd></div>}
          {calc.otherDeductionsTotal > 0 && <div><dt>Other deductions</dt><dd>−{formatCedis(calc.otherDeductionsTotal)}</dd></div>}
          <div className="py-sum-net"><dt>Take-home</dt><dd>{formatCedis(calc.takeHome)}</dd></div>
          <div className="py-sum-employer"><dt>Employer SSNIT (company cost)</dt><dd>{formatCedis(calc.employerSsnit)}</dd></div>
          {calc.employerOvertimeVat > 0 && <div className="py-sum-employer"><dt>VAT on overtime ({calc.overtime.vat.rate}%, company cost)</dt><dd>{formatCedis(calc.employerOvertimeVat)}</dd></div>}
        </dl>
      )}
    </aside>
  )
}

export default function SalaryStructures({ user, company }) {
  const companyId = company.id
  const companyName = company.name
  const editable = canEditPayroll(user, companyId)
  const [version, setVersion] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const categories = useMemo(() => listCategoryStructures(companyId), [companyId, version])
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState('')
  const companyRate = overtimeRateFor(companyId)
  const rules = statutoryRulesFor(accraTodayKey())
  const open = categories.find((c) => c.categoryId === openId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const log = useMemo(() => payrollLog([companyId]).slice(0, 12), [companyId, version])

  const start = (c) => {
    setOpenId(c.categoryId)
    setDraft(draftOf(c.latest?.structure ?? c.current?.structure))
    setErrors({})
    setNotice('')
  }
  const patch = (p) => {
    const next = { ...draft, ...p }
    setDraft(next)
    if (Object.keys(errors).length) setErrors(validateStructure(next))
  }
  const trySave = () => {
    const e = validateStructure(draft)
    setErrors(e)
    if (!Object.keys(e).length) setConfirming(true)
  }
  const confirm = ({ appliesTo, effectiveFrom }) => {
    const result = saveCategoryStructure({ user, companyId, categoryId: open.categoryId, structure: draft, appliesTo, effectiveFrom })
    if (result.errors) { setErrors(result.errors); setConfirming(false); return }
    if (result.error) { setNotice(result.error); setConfirming(false); return }
    setConfirming(false)
    setVersion((v) => v + 1)
    setNotice(`${open.label} salary saved for ${companyName} — ${result.version.appliesTo === 'all' ? `applies to existing employees from ${formatAccraDate(effectiveFrom)}` : `applies to new registrations from ${formatAccraDate(effectiveFrom)}`}. Draft payroll has been recalculated.`)
  }

  return (
    <div className="sm-page py-page">
      <div className="sm-head">
        <div>
          <h2>Salary Structures &amp; Categories</h2>
          <p>Set each category&apos;s salary once for <strong>{companyName}</strong>. Employees inherit it automatically — including new registrations — unless HR gives them an individual override.</p>
        </div>
      </div>

      <p className="hu-warning" role="note">Structures are kept per company. {companyName}&apos;s salaries are never applied to the other company. Switch company at the top of the page.</p>

      {notice && <p className="py-notice" role="status">{notice}</p>}

      <div className="py-cards">
        {categories.map((c) => {
          const s = c.current?.structure
          return (
            <button key={c.categoryId} type="button" className={`py-card${openId === c.categoryId ? ' is-open' : ''}`} onClick={() => start(c)} aria-expanded={openId === c.categoryId}>
              <span className="py-card-title">{c.label}</span>
              {s ? (
                <>
                  <span className="py-card-amount">{formatCedis(s.basic)}</span>
                  <span className="py-card-sub">{PAY_TYPES[s.payType].label} · {PAY_TYPES[s.payType].unit} · from {formatAccraDate(c.current.effectiveFrom)}</span>
                </>
              ) : (
                <>
                  <span className="py-card-amount py-card-empty">Not set</span>
                  <span className="py-card-sub">Set a salary to pay this category</span>
                </>
              )}
              {c.newHireVersion && <span className="py-chip">New hires: {formatCedis(c.newHireVersion.structure.basic)} from {formatAccraDate(c.newHireVersion.effectiveFrom)}</span>}
              <span className="py-card-foot">{c.employees} employee{c.employees === 1 ? '' : 's'}{c.withOverrides ? ` · ${c.withOverrides} override${c.withOverrides === 1 ? '' : 's'}` : ''}</span>
            </button>
          )
        })}
      </div>

      {open && draft && (
        <section className="sm-panel py-editor" aria-labelledby="py-editor-title">
          <div className="sm-panel-head">
            <h3 id="py-editor-title">{open.label} — {companyName}</h3>
            <button type="button" className="hr-link" onClick={() => setOpenId(null)}>Close</button>
          </div>
          <div className="py-editor-grid">
            <div className="py-editor-form">
              <Group title="Basic salary"><PayEditor value={draft} onChange={patch} errors={errors} idPrefix="cat" /></Group>
              <Group title="Allowances" hint="Exact GH₵ amounts, or a % of basic"><AllowancesEditor value={draft} onChange={patch} errors={errors} idPrefix="cat" /></Group>
              <Group title="Overtime" hint="Only HR-approved overtime is paid"><OvertimeEditor value={draft} onChange={patch} errors={errors} idPrefix="cat" companyRate={companyRate} /></Group>
              <Group title="Tier 2 and employee SSNIT"><TaxEditor value={draft} onChange={patch} errors={errors} idPrefix="cat" rules={rules} /></Group>
              <Group title="Other deductions"><DeductionsEditor value={draft} onChange={patch} errors={errors} idPrefix="cat" /></Group>
              <div className="py-actions">
                {Object.keys(errors).length > 0 && <p className="py-error" role="alert">Check the highlighted fields.</p>}
                <button type="button" className="btn btn-secondary" onClick={() => start(open)}>Reset</button>
                <button type="button" className="btn btn-primary" onClick={trySave} disabled={!editable} title={editable ? undefined : 'You can view but not change payroll'}>Save salary structure</button>
              </div>
            </div>
            <PreviewCard structure={draft} companyRate={companyRate} companyId={companyId} />
          </div>

          {open.versions.length > 0 && (
            <div className="py-history">
              <h4>History</h4>
              <div className="sm-table-wrap">
                <table className="sm-table">
                  <thead><tr><th scope="col">Effective from</th><th scope="col">Applies to</th><th scope="col">Basic</th><th scope="col">Tax</th><th scope="col">Saved</th></tr></thead>
                  <tbody>
                    {open.versions.map((v) => (
                      <tr key={v.id}>
                        <td data-label="Effective from">{formatAccraDate(v.effectiveFrom)}</td>
                        <td data-label="Applies to">{v.appliesTo === 'all' ? 'All employees' : 'New registrations'}</td>
                        <td data-label="Basic">{formatCedis(v.structure.basic)} {PAY_TYPES[v.structure.payType].unit}</td>
                        <td data-label="Tax">{v.structure.tax.method === 'statutory' ? 'Statutory' : 'Manual'}</td>
                        <td data-label="Saved">{new Date(v.savedAt).toLocaleString('en-GH')} · {v.savedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="sm-panel">
        <div className="sm-panel-head"><h3>Deductions in use</h3><span className="sm-muted">{rules.label} · effective {formatAccraDate(rules.effectiveFrom)}</span></div>
        <div className="py-rules">
          <ul className="py-rule-list">
            <li><strong>Tier 2</strong> the percentage HR sets in each category&apos;s salary structure, of basic salary — deducted.</li>
            <li><strong>VAT on salary</strong> {vatRateFor(companyId)}% (Settings → Overtime Pay &amp; VAT) of basic + allowances — deducted.</li>
            <li><strong>VAT on overtime</strong> {vatRateFor(companyId)}% of approved overtime pay — deducted, unless Settings says otherwise.</li>
            <li><strong>Employee SSNIT</strong> {rules.ssnitEmployeeRate}% of basic salary — deducted.</li>
            <li><strong>Employer SSNIT</strong> {rules.ssnitEmployerRate}% of basic salary — company cost, shown separately, never deducted.</li>
            <li className="py-warn">Check these figures with the company&apos;s accountant before running live payroll. {GH_STATUTORY_VERSIONS.length} SSNIT rule version{GH_STATUTORY_VERSIONS.length === 1 ? '' : 's'} configured.</li>
          </ul>
        </div>
      </section>

      {log.length > 0 && (
        <section className="sm-panel">
          <div className="sm-panel-head"><h3>Recent payroll changes</h3><span className="sm-muted">{companyName}</span></div>
          <ul className="py-log">
            {log.map((l) => <li key={l.id}><strong>{l.action}</strong> · {l.detail} <span className="sm-muted">— {l.by}, {new Date(l.at).toLocaleString('en-GH')}</span></li>)}
          </ul>
        </section>
      )}

      {confirming && open && (
        <ConfirmSave companyId={companyId} companyName={companyName} category={open} first={open.versions.length === 0} onCancel={() => setConfirming(false)} onConfirm={confirm} />
      )}
    </div>
  )
}
