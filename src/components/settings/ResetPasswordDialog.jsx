import { useEffect, useState } from 'react'
import { passwordResetUrl, resetHrPassword } from '../../services/onboardingService'
import LinkResult from '../hr/LinkResult'
import CopyValue from './CopyValue'

/**
 * HR resets another HR user's password: by a one-time link the person uses to
 * choose a password, or by a temporary password shown here once.
 */
export default function ResetPasswordDialog({ target, onClose, onDone }) {
  const [mode, setMode] = useState('link')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const firstName = target.name.split(' ')[0]

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const reset = async () => {
    setBusy(true)
    setError('')
    try {
      const outcome = await resetHrPassword(target.id, mode)
      if (outcome.errors) { setError(outcome.error); return }
      setResult({ mode, ...outcome })
      onDone(mode === 'link'
        ? `${target.name}'s password was reset. They choose a new one with the link.`
        : `${target.name}'s password was reset to a temporary one.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sm-modal-overlay" role="presentation">
      <div className="nt-confirm pw-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pw-reset-title" style={{ marginTop: '10vh' }}>
        <h3 id="pw-reset-title">{result ? `New password for ${target.name}` : `Reset ${target.name}'s password?`}</h3>

        {!result && (
          <>
            <ul className="hu-change-list">
              <li>Their current password stops working straight away.</li>
              <li>They are signed out on every device.</li>
              <li>Their authenticator app stays as it is.</li>
            </ul>
            <fieldset className="pw-choice">
              <legend className="sh-form-label">How will they get a new password?</legend>
              <label className={`pw-option${mode === 'link' ? ' is-selected' : ''}`}>
                <input type="radio" name="pw-mode" value="link" checked={mode === 'link'} onChange={() => setMode('link')} />
                <span>
                  <strong>Send a reset link</strong>
                  <span className="st-hint">You copy a one-time link and send it to them. They choose their own password within 24 hours. You never see it.</span>
                </span>
              </label>
              <label className={`pw-option${mode === 'temporary' ? ' is-selected' : ''}`}>
                <input type="radio" name="pw-mode" value="temporary" checked={mode === 'temporary'} onChange={() => setMode('temporary')} />
                <span>
                  <strong>Set a temporary password</strong>
                  <span className="st-hint">A random password is shown here once. You give it to them, and they change it in Settings → My password.</span>
                </span>
              </label>
            </fieldset>
            {error && <p className="at-form-alert" role="alert">{error}</p>}
            <div className="sm-alert-actions">
              <button type="button" className="btn btn-primary" onClick={reset} disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Back</button>
            </div>
          </>
        )}

        {result?.mode === 'link' && (
          <>
            <p className="sm-muted">Send this link to {firstName}. They open it, choose a new password, then sign in with their authenticator app as usual.</p>
            <LinkResult url={passwordResetUrl(result.token)} expiresAt={result.expiresAt} />
          </>
        )}

        {result?.mode === 'temporary' && (
          <>
            <p className="sm-muted">This is shown only once. Give it to {firstName} privately. They should change it in Settings → My password after signing in.</p>
            <CopyValue value={result.password} label="Temporary password" copyLabel="Copy password" />
          </>
        )}

        {result && (
          <div className="sm-alert-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}
