import { useEffect, useMemo, useState } from 'react'
import { formatCedis } from '../../services/overtimeService'
import { overtimeRateFor } from '../../services/settingsService'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'
import {
  canEditPayroll,
  categoryDefaultFor,
  dateKeyOf,
  overrideVersions,
  previewLine,
  saveOverride,
} from '../../services/payrollService'
import { OVERRIDE_GROUPS, normaliseStructure, validateStructure } from '../../services/payroll/payrollRules'
import { statutoryRulesFor } from '../../services/payroll/statutory'
import { GROUP_EDITORS, SourceBadge, groupSummary } from './StructureFields'

/**
 * Individual salary profile. Each group shows where its value comes from
 * (Category Default / Individual Override). Saving adds an effective-dated
 * override version for THIS employee only; the category is never changed.
 */
export default function SalaryProfileModal({ user, line, period, onClose, onSaved }) {
  const editable = canEditPayroll(user, line.companyId)
  const dateKey = dateKeyOf(period.end)
  const base = useMemo(() => categoryDefaultFor(line, dateKey), [line, dateKey])
  const companyRate = overtimeRateFor(line.companyId)
  const rules = statutoryRulesFor(dateKey)
  const current = line.structure
  const [on, setOn] = useState(() => Object.fromEntries(OVERRIDE_GROUPS.map((g) => [g.key, line.sources[g.key] === 'override'])))
  const [draft, setDraft] = useState(() => structuredClone(current))
  const [effectiveFrom, setEffectiveFrom] = useState(() => dateKeyOf(period.start) > accraTodayKey() ? accraTodayKey() : dateKeyOf(period.start))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const history = overrideVersions(line.staffId)

  useEffect(() => {
    const onEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  // The structure this profile would produce: overridden groups from the draft, the rest from the category.
  const merged = useMemo(() => {
    const out = structuredClone(base.structure)
    OVERRIDE_GROUPS.forEach((g) => { if (on[g.key]) g.fields.forEach((f) => { out[f] = draft[f] }) })
    return out
  }, [base, on, draft])
  const fieldErrors = validateStructure(merged)
  const preview = Object.keys(fieldErrors).length ? null : previewLine(line, { structure: normaliseStructure(merged) }, period)

  const toggle = (key, value) => {
    setOn((o) => ({ ...o, [key]: value }))
    // Turning an override on starts from the category default.
    if (value && line.sources[key] !== 'override') {
      const g = OVERRIDE_GROUPS.find((x) => x.key === key)
      setDraft((d) => ({ ...d, ...Object.fromEntries(g.fields.map((f) => [f, structuredClone(base.structure[f])])) }))
    }
  }

  const save = () => {
    const fields = {}
    OVERRIDE_GROUPS.forEach((g) => { if (on[g.key]) g.fields.forEach((f) => { fields[f] = draft[f] }) })
    const e = validateStructure(merged)
    if (Object.keys(e).length) { setErrors(e); return }
    const result = saveOverride({ user, employee: line, fields: normaliseFields(fields), effectiveFrom, reason })
    if (result.errors) { setErrors(result.errors); return }
    if (result.error) { setErrors({ form: result.error }); return }
    onSaved?.()
  }

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal py-profile" role="dialog" aria-modal="true" aria-labelledby="py-profile-title">
        <div className="sm-modal-head">
          <div>
            <h3 id="py-profile-title">Salary profile — {line.fullName}</h3>
            <p className="sm-muted">{line.staffId} · {line.categoryLabel} · {line.companyName}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="sm-modal-body py-profile-body">
          {!base.template && <p className="hu-warning">There is no {line.categoryLabel} salary structure for {line.companyName} yet. Set one in Salary Structures &amp; Categories, or override every group here.</p>}
          <div className="py-editor-grid">
            <div className="py-editor-form">
              {OVERRIDE_GROUPS.map((g) => {
                const Editor = GROUP_EDITORS[g.key]
                const source = on[g.key] ? 'override' : base.template ? 'category' : 'none'
                return (
                  <section className="py-group" key={g.key}>
                    <header>
                      <h4>{g.label}</h4>
                      <SourceBadge source={source} />
                    </header>
                    <label className="py-check">
                      <input type="checkbox" checked={on[g.key]} onChange={(e) => toggle(g.key, e.target.checked)} disabled={!editable} />
                      <span>Override for this employee</span>
                    </label>
                    {on[g.key]
                      ? <Editor value={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} errors={errors} idPrefix={`ov-${g.key}`} companyRate={companyRate} rules={rules} />
                      : <p className="py-default">{groupSummary(g.key, base.structure, companyRate)}</p>}
                  </section>
                )
              })}
              <div className="py-grid">
                <div className="py-field">
                  <label className="py-label" htmlFor="py-ov-eff">Effective from</label>
                  <input id="py-ov-eff" type="date" className="form-input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} aria-invalid={Boolean(errors.effectiveFrom)} />
                  {errors.effectiveFrom && <p className="py-error">{errors.effectiveFrom}</p>}
                </div>
                <div className="py-field">
                  <label className="py-label" htmlFor="py-ov-reason">Reason (kept in the salary history)</label>
                  <input id="py-ov-reason" className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Senior warehouse lead, agreed 1 Nov" aria-invalid={Boolean(errors.reason)} />
                  {errors.reason && <p className="py-error">{errors.reason}</p>}
                </div>
              </div>
              {errors.form && <p className="py-error" role="alert">{errors.form}</p>}
              <p className="py-hint">Approved payroll keeps the figures it was approved with. This change never alters the {line.categoryLabel} structure or anyone else&apos;s salary.</p>
            </div>

            <aside className="py-preview" aria-live="polite">
              <h4>{period.label} with these settings</h4>
              {preview ? (
                <dl className="py-sum">
                  <div><dt>Basic</dt><dd>{formatCedis(preview.basicPay)}</dd></div>
                  <div><dt>Allowances</dt><dd>{formatCedis(preview.allowanceTotal)}</dd></div>
                  <div><dt>Overtime ({preview.overtime.hours} h)</dt><dd>{formatCedis(preview.overtime.pay)}</dd></div>
                  <div className="py-sum-total"><dt>Gross earnings</dt><dd>{formatCedis(preview.gross)}</dd></div>
                  <div><dt>PAYE</dt><dd>−{formatCedis(preview.paye)}</dd></div>
                  <div><dt>Employee SSNIT</dt><dd>−{formatCedis(preview.ssnitEmployee)}</dd></div>
                  <div><dt>Other deductions</dt><dd>−{formatCedis(preview.otherDeductionsTotal)}</dd></div>
                  <div className="py-sum-net"><dt>Take-home</dt><dd>{formatCedis(preview.takeHome)}</dd></div>
                  <div className="py-sum-was"><dt>Currently</dt><dd>{formatCedis(line.calc.takeHome)}</dd></div>
                </dl>
              ) : <p className="py-hint">Fix the highlighted fields to see the preview.</p>}

              <h4 className="py-history-title">Salary history</h4>
              {history.length === 0 && !base.template ? <p className="sm-muted">No history yet.</p> : (
                <ol className="py-timeline">
                  {history.map((v) => (
                    <li key={v.id}>
                      <strong>{Object.keys(v.fields).length ? 'Individual override' : 'Override removed'}</strong> from {formatAccraDate(v.effectiveFrom)}
                      <span>{v.reason} — {v.savedBy}, {new Date(v.savedAt).toLocaleDateString('en-GH')}</span>
                    </li>
                  ))}
                  {base.template && (
                    <li>
                      <strong>Category default</strong> from {formatAccraDate(base.template.effectiveFrom)}
                      <span>{formatCedis(base.template.structure.basic)} · {base.template.appliesTo === 'all' ? 'all employees' : 'new registrations'}</span>
                    </li>
                  )}
                </ol>
              )}
            </aside>
          </div>
        </div>
        <div className="sm-modal-foot py-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!editable}>
            {Object.values(on).some(Boolean) ? 'Save salary profile' : 'Use category defaults only'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Store numbers as numbers in the override. */
function normaliseFields(fields) {
  if (!Object.keys(fields).length) return {}
  const n = normaliseStructure({ ...fields })
  return Object.fromEntries(Object.keys(fields).map((k) => [k, n[k]]))
}
