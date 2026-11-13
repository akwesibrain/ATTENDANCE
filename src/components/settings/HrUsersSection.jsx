import { useCallback, useEffect, useState } from 'react'
import { can } from '../../services/permissionsService'
import { cancelInvite, hrSetupUrl, inviteHrUser, listHrAccess, resendInvite, resetHrAuthenticator, setHrUserStatus } from '../../services/onboardingService'
import { formatAccraDateTime } from '../../utils/accraTime'
import LinkResult from '../hr/LinkResult'
import { ConfirmChange, Field, SectionCard } from './SettingsKit'
import ResetPasswordDialog from './ResetPasswordDialog'

const BLANK = { name: '', email: '', phone: '' }

/**
 * Who can use the HR portal. HR invites people by a one-time link; they choose
 * their own password and set up an authenticator app. Everyone has full HR
 * Manager access to every company.
 */
export default function HrUsersSection({ user }) {
  const readOnly = !can(user, 'settings', 'edit')
  const [access, setAccess] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [flash, setFlash] = useState('')
  const [link, setLink] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [resetting, setResetting] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listHrAccess().then((data) => { setAccess(data); setLoadError('') }).catch((failure) => setLoadError(failure.message))
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (action, onDone) => {
    setBusy(true)
    setErrors({})
    setFlash('')
    try {
      const result = await action()
      if (result.errors) { setErrors(result.errors); return }
      onDone(result)
      load()
    } finally {
      setBusy(false)
    }
  }

  const invite = (e) => {
    e.preventDefault()
    run(() => inviteHrUser(form), (r) => {
      setLink({ name: form.name.trim(), ...r })
      setForm(BLANK)
    })
  }

  const relink = (inv) => run(() => resendInvite(inv.id), (r) => setLink({ name: inv.name, ...r }))

  const confirm = () => {
    const { kind, target } = confirming
    setConfirming(null)
    if (kind === 'authenticator') {
      run(() => resetHrAuthenticator(target.id), () => setFlash(`${target.name}'s authenticator was reset. They set up a new one at their next sign-in.`))
    } else if (kind === 'cancel') {
      run(() => cancelInvite(target.id), () => {
        if (link?.name === target.name) setLink(null)
        setFlash(`The invite for ${target.name} was cancelled. Its link no longer works.`)
      })
    } else {
      const status = kind === 'remove' ? 'inactive' : 'active'
      run(() => setHrUserStatus(target.id, status), () => setFlash(status === 'inactive'
        ? `${target.name} can no longer use the HR portal.`
        : `${target.name} can use the HR portal again.`))
    }
  }

  const users = access?.users ?? []
  const invites = access?.invites ?? []

  return (
    <SectionCard
      title="HR users"
      description="People who can use the HR portal. Each one signs in with their own email, password and authenticator app, and has full HR Manager access to every company."
      readOnly={readOnly}
      readOnlyReason={readOnly ? 'Managing HR users needs Settings → Edit.' : null}
      flash={flash}
      error={errors.form ?? loadError}
    >
      {!readOnly && (
        <form className="st-grid hol-form" onSubmit={invite} noValidate>
          <Field id="hu-name" label="Full name" error={errors.name}>
            <input id="hu-name" className="sh-form-input" maxLength={80} autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field id="hu-email" label="Email" hint="They sign in with this." error={errors.email}>
            <input id="hu-email" type="email" className="sh-form-input" maxLength={120} autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field id="hu-phone" label="Phone (optional)" hint="The setup link is texted here." error={errors.phone}>
            <input id="hu-phone" className="sh-form-input" inputMode="tel" maxLength={20} autoComplete="off" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="st-field hol-add">
            <button type="submit" className="btn btn-primary at-btn" disabled={busy}>Invite</button>
          </div>
        </form>
      )}

      {link && (
        <div className="hu-link">
          <h4 className="sm-section-title">Setup link for {link.name}</h4>
          <p className="sm-muted">They open it, choose a password, then set up their authenticator app.</p>
          <LinkResult url={hrSetupUrl(link.token)} {...link} />
          <div className="sm-alert-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setLink(null)}>Done</button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <>
          <h4 className="sm-section-title hol-title">Invited</h4>
          <ul className="hol-list">
            {invites.map((inv) => (
              <li key={inv.id} className="hol-item">
                <span className="hol-name">{inv.name}<span className="sm-muted"> · {inv.email}</span></span>
                <span className="hol-date">{inv.expiresAt ? `Link expires ${formatAccraDateTime(inv.expiresAt)}` : 'Link expired'}</span>
                <span className="at-badge at-tone-warn">Invited</span>
                {!readOnly ? (
                  <span className="wd-actions">
                    <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => relink(inv)}>Send new link</button>
                    <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => setConfirming({ kind: 'cancel', target: inv })}>Cancel invite</button>
                  </span>
                ) : <span className="hol-spacer" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="sm-section-title hol-title">People with access</h4>
      {!access && !loadError && <p className="sm-muted" role="status">Loading…</p>}
      {access && (
        <ul className="hol-list">
          {users.map((u) => {
            const active = u.status === 'active'
            const isMe = u.id === user.id
            return (
              <li key={u.id} className={`hol-item${active ? '' : ' is-past'}`}>
                <span className="hol-name">{u.name}{isMe ? ' (you)' : ''}<span className="sm-muted"> · {u.email}</span></span>
                <span className="hol-date">{u.lastLoginAt ? `Last signed in ${formatAccraDateTime(u.lastLoginAt)}` : 'Not signed in yet'}</span>
                <span className={`at-badge at-tone-${active ? 'ok' : 'muted'}`}>{active ? 'Active' : 'Removed'}</span>
                {!readOnly && !isMe ? (
                  <span className="wd-actions">
                    {active && (
                      <>
                        <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => { setFlash(''); setResetting(u) }}>Reset password</button>
                        <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => setConfirming({ kind: 'authenticator', target: u })}>Reset authenticator</button>
                      </>
                    )}
                    <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => setConfirming({ kind: active ? 'remove' : 'restore', target: u })}>
                      {active ? 'Remove access' : 'Restore access'}
                    </button>
                  </span>
                ) : <span className="hol-spacer" aria-hidden="true" />}
              </li>
            )
          })}
        </ul>
      )}

      {confirming && (
        <ConfirmChange
          title={{
            remove: `Remove ${confirming.target.name}'s access?`,
            restore: `Restore ${confirming.target.name}'s access?`,
            cancel: `Cancel the invite for ${confirming.target.name}?`,
            authenticator: `Reset ${confirming.target.name}'s authenticator?`,
          }[confirming.kind]}
          lines={{
            remove: ['They are signed out on their next action and cannot sign in again.', 'Their past actions stay in the audit log.'],
            restore: ['They can sign in again with their existing password and authenticator app.'],
            cancel: ['Their setup link stops working straight away.'],
            authenticator: [
              'Use this when they lost or changed their phone.',
              'Their authenticator app is removed and they are signed out on every device.',
              'At their next sign-in they scan a new QR code. Their password stays the same.',
            ],
          }[confirming.kind]}
          confirmLabel={{ remove: 'Remove access', restore: 'Restore access', cancel: 'Cancel invite', authenticator: 'Reset authenticator' }[confirming.kind]}
          onConfirm={confirm}
          onCancel={() => setConfirming(null)}
        />
      )}

      {resetting && (
        <ResetPasswordDialog
          target={resetting}
          onClose={() => setResetting(null)}
          onDone={(message) => { setFlash(message); load() }}
        />
      )}
    </SectionCard>
  )
}
