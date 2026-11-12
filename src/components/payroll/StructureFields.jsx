import { PAY_TYPES, TAX_METHODS } from '../../services/payroll/payrollRules'
import { formatCedis } from '../../services/overtimeService'

/**
 * Field groups for a salary structure. Shared by the category editor and the
 * individual salary profile so both use exactly the same inputs.
 * Each editor gets { value: structure, onChange(patch), errors, idPrefix }.
 */

function Money({ id, value, onChange, error, label, suffix = 'GH₵', placeholder = '0.00' }) {
  return (
    <div className="py-field">
      <label className="py-label" htmlFor={id}>{label}</label>
      <div className={`py-money${error ? ' has-error' : ''}`}>
        <span aria-hidden="true">{suffix}</span>
        <input id={id} className="form-input" type="number" inputMode="decimal" min="0" step="0.01" placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : undefined} />
      </div>
      {error && <p className="py-error" id={`${id}-err`}>{error}</p>}
    </div>
  )
}

function KindSelect({ id, value, onChange, percentOf = 'basic' }) {
  return (
    <select id={id} className="sm-select py-kind" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Amount or percentage">
      <option value="amount">GH₵ amount</option>
      <option value="percent">% of {percentOf}</option>
    </select>
  )
}

export function PayEditor({ value, onChange, errors = {}, idPrefix }) {
  return (
    <div className="py-grid">
      <div className="py-field">
        <label className="py-label" htmlFor={`${idPrefix}-paytype`}>Salary payment type</label>
        <div className="py-segment" role="radiogroup" id={`${idPrefix}-paytype`} aria-label="Salary payment type">
          {Object.entries(PAY_TYPES).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={value.payType === k} className={value.payType === k ? 'is-on' : ''} onClick={() => onChange({ payType: k })}>{t.label}</button>
          ))}
        </div>
      </div>
      <Money id={`${idPrefix}-basic`} label={`${PAY_TYPES[value.payType]?.basicLabel ?? 'Basic salary'} (${PAY_TYPES[value.payType]?.unit})`} value={value.basic} onChange={(v) => onChange({ basic: v })} error={errors.basic} />
    </div>
  )
}

function LinesEditor({ lines, onChange, errors, idPrefix, errorKey, addLabel, emptyText }) {
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <div className="py-lines">
      {lines.length === 0 && <p className="py-hint">{emptyText}</p>}
      {lines.map((l, i) => (
        <div className="py-line" key={l.id}>
          {l.standard
            ? <span className="py-line-name">{l.name}</span>
            : <input className="form-input py-line-name" value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Name, e.g. Uniform allowance" aria-label="Name" aria-invalid={Boolean(errors[`${errorKey}.${i}.name`])} />}
          <KindSelect id={`${idPrefix}-${l.id}-kind`} value={l.kind} onChange={(kind) => set(i, { kind })} />
          <input className="form-input py-line-value" type="number" inputMode="decimal" min="0" step="0.01" value={l.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} aria-label={`${l.name || 'Line'} value`} aria-invalid={Boolean(errors[`${errorKey}.${i}.value`])} />
          {!l.standard
            ? <button type="button" className="py-icon-btn" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Remove ${l.name || 'line'}`}>×</button>
            : <span className="py-icon-gap" aria-hidden="true" />}
          {(errors[`${errorKey}.${i}.name`] || errors[`${errorKey}.${i}.value`]) && <p className="py-error py-line-err">{errors[`${errorKey}.${i}.name`] || errors[`${errorKey}.${i}.value`]}</p>}
        </div>
      ))}
      <button type="button" className="hr-link py-add" onClick={() => onChange([...lines, { id: `custom-${Date.now().toString(36)}`, name: '', kind: 'amount', value: '' }])}>+ {addLabel}</button>
    </div>
  )
}

export function AllowancesEditor({ value, onChange, errors = {}, idPrefix }) {
  return <LinesEditor lines={value.allowances} onChange={(allowances) => onChange({ allowances })} errors={errors} idPrefix={`${idPrefix}-al`} errorKey="allowances" addLabel="Add a custom allowance" emptyText="No allowances." />
}

export function DeductionsEditor({ value, onChange, errors = {}, idPrefix }) {
  return <LinesEditor lines={value.deductions} onChange={(deductions) => onChange({ deductions })} errors={errors} idPrefix={`${idPrefix}-de`} errorKey="deductions" addLabel="Add a deduction (welfare, union dues…)" emptyText="No standing deductions. Loans and advances are entered per payroll period." />
}

export function OvertimeEditor({ value, onChange, errors = {}, idPrefix, companyRate }) {
  const fixed = value.overtimeRate !== null && value.overtimeRate !== undefined
  return (
    <div className="py-grid">
      <label className="py-check">
        <input type="checkbox" checked={value.overtimeEligible !== false} onChange={(e) => onChange({ overtimeEligible: e.target.checked })} />
        <span>Eligible for overtime pay</span>
      </label>
      {value.overtimeEligible !== false && (
        <div className="py-field">
          <span className="py-label">Overtime rate</span>
          <div className="py-radios">
            <label><input type="radio" name={`${idPrefix}-otmode`} checked={!fixed} onChange={() => onChange({ overtimeRate: null })} /> Company rate{companyRate ? ` (${formatCedis(companyRate)}/h, Settings)` : ''}</label>
            <label><input type="radio" name={`${idPrefix}-otmode`} checked={fixed} onChange={() => onChange({ overtimeRate: '' })} /> Fixed rate for this {idPrefix.startsWith('ov') ? 'employee' : 'category'}</label>
          </div>
          {fixed && <Money id={`${idPrefix}-otrate`} label="Hourly overtime rate" suffix="GH₵/h" value={value.overtimeRate} onChange={(v) => onChange({ overtimeRate: v })} error={errors.overtimeRate} />}
        </div>
      )}
    </div>
  )
}

export function TaxEditor({ value, onChange, errors = {}, idPrefix, rules }) {
  const tax = value.tax
  const setTax = (patch) => onChange({ tax: { ...tax, ...patch } })
  return (
    <div className="py-grid">
      <div className="py-field">
        <span className="py-label">Method — one per employee, never both</span>
        <div className="py-segment" role="radiogroup" aria-label="Tax method">
          {Object.entries(TAX_METHODS).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={tax.method === k} className={tax.method === k ? 'is-on' : ''} onClick={() => setTax({ method: k })}>{t.label}</button>
          ))}
        </div>
      </div>
      {tax.method === 'statutory' ? (
        <p className="py-hint">
          PAYE from the Ghana monthly tax bands on (gross − employee SSNIT); employee SSNIT {rules?.ssnitEmployeeRate ?? 5.5}% of basic.
          Employer SSNIT {rules?.ssnitEmployerRate ?? 13}% is calculated separately and never deducted from pay.
        </p>
      ) : (
        <>
          {[['paye', 'PAYE', 'gross'], ['ssnit', 'Employee SSNIT', 'basic']].map(([k, label, of]) => (
            <div className="py-field" key={k}>
              <label className="py-label" htmlFor={`${idPrefix}-${k}`}>{label}</label>
              <div className="py-inline">
                <KindSelect id={`${idPrefix}-${k}-kind`} value={tax[k].kind} onChange={(kind) => setTax({ [k]: { ...tax[k], kind } })} percentOf={of} />
                <input id={`${idPrefix}-${k}`} className="form-input py-line-value" type="number" inputMode="decimal" min="0" step="0.01" value={tax[k].value ?? ''} onChange={(e) => setTax({ [k]: { ...tax[k], value: e.target.value } })} aria-invalid={Boolean(errors[`tax.${k}`])} />
              </div>
              {errors[`tax.${k}`] && <p className="py-error">{errors[`tax.${k}`]}</p>}
            </div>
          ))}
          <p className="py-hint">Manual figures replace the automatic PAYE and employee SSNIT for this {idPrefix.startsWith('ov') ? 'employee' : 'category'}. Employer SSNIT is still shown separately.</p>
        </>
      )}
    </div>
  )
}

export const GROUP_EDITORS = {
  pay: PayEditor,
  allowances: AllowancesEditor,
  overtime: OvertimeEditor,
  tax: TaxEditor,
  deductions: DeductionsEditor,
}

/** One-line summary of a group, for read-only "Category Default" display. */
export function groupSummary(key, s, companyRate) {
  if (key === 'pay') return `${PAY_TYPES[s.payType].label} · ${formatCedis(s.basic)} ${PAY_TYPES[s.payType].unit}`
  if (key === 'allowances') {
    const on = s.allowances.filter((a) => Number(a.value) > 0)
    return on.length ? on.map((a) => `${a.name} ${a.kind === 'percent' ? `${a.value}%` : formatCedis(a.value)}`).join(' · ') : 'None'
  }
  if (key === 'overtime') return s.overtimeEligible === false ? 'Not eligible' : s.overtimeRate === null ? `Company rate${companyRate ? ` (${formatCedis(companyRate)}/h)` : ''}` : `${formatCedis(s.overtimeRate)}/h`
  if (key === 'tax') return s.tax.method === 'statutory' ? TAX_METHODS.statutory.label : `Manual — PAYE ${s.tax.paye.kind === 'percent' ? `${s.tax.paye.value}%` : formatCedis(s.tax.paye.value)}, SSNIT ${s.tax.ssnit.kind === 'percent' ? `${s.tax.ssnit.value}%` : formatCedis(s.tax.ssnit.value)}`
  if (key === 'deductions') return s.deductions.length ? s.deductions.map((d) => `${d.name} ${d.kind === 'percent' ? `${d.value}%` : formatCedis(d.value)}`).join(' · ') : 'None'
  return ''
}

export function SourceBadge({ source }) {
  const label = source === 'override' ? 'Individual Override' : source === 'category' ? 'Category Default' : 'Not set'
  return <span className={`py-source py-source-${source}`}>{label}</span>
}
