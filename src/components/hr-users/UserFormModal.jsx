import { useEffect, useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import {
  ROLES,
  describeGrantChange,
  mockCreateHrUser,
  mockUpdateHrUser,
  roleDefaults,
  validateUser,
} from '../../services/permissionsService'
import PermissionMatrix from './PermissionMatrix'

function FieldError({ message }) {
  if (!message) return null
  return <span className="sh-form-error" role="alert">{message}</span>
}

/**
 * Add or edit an HR user. Role, company or permission changes go through a
 * confirmation step that spells out what changes.
 */
export default function UserFormModal({ user, actor, onClose, onSaved }) {
  const isEdit = Boolean(user)
  const [data, setData] = useState(() =>
    isEdit
      ? { name: user.name, email: user.email, roleId: user.roleId, companyIds: user.companyIds, grants: user.grants }
      : { name: '', email: '', roleId: 'hr-officer', companyIds: [COMPANIES[0].id], grants: roleDefaults('hr-officer') },
  )
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const onEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const role = ROLES[data.roleId]
  const companies = role?.scope === 'all' ? COMPANIES.map((c) => c.id) : data.companyIds
  const validation = validateUser({ ...data, companyIds: companies }, { editingId: user?.id })
  const errors = showErrors ? { ...validation, ...serverErrors } : serverErrors
  const sensitiveChange = isEdit && (
    user.roleId !== data.roleId ||
    JSON.stringify(user.companyIds) !== JSON.stringify(companies) ||
    JSON.stringify(user.grants) !== JSON.stringify(data.grants)
  )

  const update = (field, value) => {
    setData((d) => {
      const next = { ...d, [field]: value }
      if (field === 'roleId') {
        next.grants = roleDefaults(value)
        // HR Officers are limited to one company.
        if (ROLES[value]?.scope === 'single') next.companyIds = d.companyIds.slice(0, 1).length ? d.companyIds.slice(0, 1) : [COMPANIES[0].id]
      }
      return next
    })
    setServerErrors({})
  }

  const save = () => {
    const result = isEdit ? mockUpdateHrUser(user.id, { ...data, companyIds: companies }, actor) : mockCreateHrUser({ ...data, companyIds: companies }, actor)
    if (result.errors) {
      setServerErrors(result.errors)
      setConfirming(false)
      return
    }
    onSaved(result.user)
  }

  const submit = (event) => {
    event.preventDefault()
    setShowErrors(true)
    if (Object.keys(validation).length) return
    if (sensitiveChange) setConfirming(true)
    else save()
  }

  const cls = (f) => `sh-form-input${errors[f] ? ' has-error' : ''}`
  const changeText = isEdit ? describeGrantChange(user.grants, data.grants) : ''

  return (
    <div className="sm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sm-modal" role="dialog" aria-modal="true" aria-labelledby="hu-form-title" style={{ maxWidth: 820 }}>
        <div className="sm-modal-head">
          <div>
            <h3 id="hu-form-title">{isEdit ? `Edit ${user.name}` : 'Add HR user'}</h3>
            <p>{isEdit ? user.email : 'The user receives a demo invitation; no email is sent.'}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <form className="sm-modal-body" onSubmit={submit} noValidate>
          <div className="sh-form-grid">
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hu-name">Full name</label>
              <input id="hu-name" className={cls('name')} value={data.name} onChange={(e) => update('name', e.target.value)} autoComplete="off" />
              <FieldError message={errors.name} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hu-email">Email address</label>
              <input id="hu-email" type="email" className={cls('email')} value={data.email} onChange={(e) => update('email', e.target.value)} autoComplete="off" />
              <FieldError message={errors.email} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hu-role">Role</label>
              <select id="hu-role" className={`sh-form-select${errors.roleId ? ' has-error' : ''}`} value={data.roleId} onChange={(e) => update('roleId', e.target.value)} disabled={isEdit && user.id === actor.id}>
                {Object.entries(ROLES).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
              </select>
              <span className="at-sub">{role?.description}</span>
              <FieldError message={errors.roleId} />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="hu-company">{role?.scope === 'multi' ? 'Companies managed' : 'Company'}</label>
              {role?.scope === 'all' ? (
                <span className="hu-scope-all">Box For Less &amp; Double A (always both)</span>
              ) : role?.scope === 'multi' ? (
                <div className="hu-company-checks" id="hu-company" role="group" aria-label="Companies managed">
                  {COMPANIES.map((c) => (
                    <label key={c.id} className="at-check">
                      <input
                        type="checkbox"
                        checked={data.companyIds.includes(c.id)}
                        onChange={(e) => update('companyIds', e.target.checked ? [...data.companyIds, c.id] : data.companyIds.filter((x) => x !== c.id))}
                      />
                      {c.name}
                    </label>
                  ))}
                  <span className="at-sub">One HR Manager can look after both companies; their records stay separated.</span>
                </div>
              ) : (
                <select id="hu-company" className={`sh-form-select${errors.companyIds ? ' has-error' : ''}`} value={data.companyIds[0] ?? ''} onChange={(e) => update('companyIds', [e.target.value])}>
                  {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <FieldError message={errors.companyIds} />
            </div>
          </div>

          <div className="hu-matrix-head">
            <span className="sh-form-label">Permissions</span>
            <button type="button" className="hr-link" onClick={() => update('roleId', data.roleId)}>Reset to role defaults</button>
          </div>
          <PermissionMatrix roleId={data.roleId} grants={data.grants} onChange={(g) => update('grants', g)} />
          {errors.grants && (
            <ul className="at-form-alert hu-problems" role="alert">
              {errors.grants.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {errors.form && <p className="at-form-alert" role="alert">{errors.form}</p>}

          <div className="sm-alert-actions">
            <button type="submit" className="btn btn-primary">{isEdit ? 'Save changes' : 'Create user'}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>

        {confirming && (
          <div className="nt-confirm-overlay" role="presentation">
            <div className="nt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="hu-confirm-title">
              <h3 id="hu-confirm-title">Confirm access change</h3>
              <ul className="hu-change-list">
                {user.roleId !== data.roleId && <li>Role: {user.role} → {role.label}</li>}
                {JSON.stringify(user.companyIds) !== JSON.stringify(companies) && (
                  <li>Company: {user.companyIds.map((c) => COMPANIES.find((x) => x.id === c)?.name).join(' & ')} → {companies.map((c) => COMPANIES.find((x) => x.id === c)?.name).join(' & ')}</li>
                )}
                {changeText && <li>{changeText}</li>}
              </ul>
              <p className="nt-confirm-lead">The change applies the next time {user.name} opens any page, and is recorded in their activity.</p>
              <div className="sm-alert-actions">
                <button type="button" className="btn btn-primary" onClick={save}>Confirm change</button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Back</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
