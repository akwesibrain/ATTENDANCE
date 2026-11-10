/** Building blocks shared by the settings sections. */

export function SectionCard({ title, description, readOnly, readOnlyReason, children, onSave, onCancel, dirty, flash, error, saveLabel = 'Save changes' }) {
  return (
    <section className="st-card" aria-labelledby={`st-${title.replace(/\W+/g, '-')}`}>
      <header className="st-card-head">
        <div>
          <h3 id={`st-${title.replace(/\W+/g, '-')}`}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {readOnly && <span className="st-readonly" title={readOnlyReason}>Read-only</span>}
      </header>
      {readOnly && readOnlyReason && <p className="st-readonly-note">{readOnlyReason}</p>}
      {flash && <div className="at-flash" role="status"><span>{flash}</span></div>}
      {error && <p className="at-form-alert" role="alert">{error}</p>}
      <div className="st-card-body">{children}</div>
      {!readOnly && onSave && (
        <footer className="st-card-foot">
          {dirty && <span className="st-unsaved">Unsaved changes</span>}
          <button type="button" className="btn btn-secondary at-btn" onClick={onCancel} disabled={!dirty}>Cancel</button>
          <button type="button" className="btn btn-primary at-btn" onClick={onSave} disabled={!dirty}>{saveLabel}</button>
        </footer>
      )}
    </section>
  )
}

export function Field({ id, label, hint, error, children, full, applied }) {
  return (
    <div className={`st-field${full ? ' is-full' : ''}`}>
      <label className="sh-form-label" htmlFor={id}>
        {label}
        {applied === false && <span className="st-recorded" title="Saved and shown, but not enforced by this prototype">Recorded only</span>}
      </label>
      {children}
      {hint && <span className="st-hint">{hint}</span>}
      {error && <span className="sh-form-error" role="alert">{error}</span>}
    </div>
  )
}

/** A fixed rule shown as a value, not an input. */
export function Locked({ label, value, hint }) {
  return (
    <div className="st-field">
      <span className="sh-form-label">{label} <span className="st-lock">Locked</span></span>
      <span className="st-locked-value">{value}</span>
      {hint && <span className="st-hint">{hint}</span>}
    </div>
  )
}

export function Toggle({ id, checked, onChange, disabled, label }) {
  return (
    <label className="st-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>{label}</span>
    </label>
  )
}

export function ConfirmChange({ title, lines, onConfirm, onCancel, confirmLabel = 'Confirm and save' }) {
  return (
    <div className="sm-modal-overlay" role="presentation">
      <div className="nt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="st-confirm-title" style={{ marginTop: '12vh' }}>
        <h3 id="st-confirm-title">{title}</h3>
        <ul className="hu-change-list">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="sm-alert-actions">
          <button type="button" className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Back</button>
        </div>
      </div>
    </div>
  )
}

export function StatusRow({ label, value, tone = 'ok', detail }) {
  return (
    <div className="st-status-row">
      <span className="st-status-label">{label}</span>
      <span className={`at-badge at-tone-${tone}`}>{value}</span>
      {detail && <span className="st-hint">{detail}</span>}
    </div>
  )
}
