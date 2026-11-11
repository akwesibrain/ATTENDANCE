import { useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import { loginLockMinutesLeft, signInWithPassword } from '../../services/permissionsService'

function Shell({ title, children, onExit }) {
  return (
    <div className="ac-shell">
      <div className="ac-card" role="main">
        <div className="ac-brand">WorkForce Pro · HR Portal</div>
        <h1>{title}</h1>
        {children}
        {onExit && (
          <button type="button" className="hr-link ac-exit" onClick={onExit}>← Leave the HR portal</button>
        )}
        <p className="ac-note">
          Demo sign-in: the password is checked in the browser, so this prototype is not secure. In production,
          sign-in, MFA and every restriction must be enforced by the backend.
        </p>
      </div>
    </div>
  )
}

const companyNames = (ids) => ids.map((id) => COMPANIES.find((c) => c.id === id)?.name).join(' & ')

/**
 * HR portal login: email or phone number + password. Errors are announced and
 * shown next to the form; the same message is used whatever was wrong.
 */
export function HrLogin({ onSignedIn, onExit, reason }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = loginLockMinutesLeft()

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const result = await signInWithPassword(identifier, password)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      setPassword('')
      return
    }
    onSignedIn(result.user)
  }

  return (
    <Shell title="Sign in to the HR portal" onExit={onExit}>
      {reason && <p className="ac-reason" role="status">{reason}</p>}
      <p className="ac-lead">Use the email address or phone number on your HR account.</p>
      <form className="ac-form" onSubmit={submit} noValidate>
        <div className="ac-field">
          <label className="sh-form-label" htmlFor="ac-id">Email or phone number</label>
          <input
            id="ac-id"
            className="sh-form-input"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'ac-error' : undefined}
            required
          />
        </div>
        <div className="ac-field">
          <label className="sh-form-label" htmlFor="ac-pw">Password</label>
          <div className="ac-password">
            <input
              id="ac-pw"
              className="sh-form-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'ac-error' : undefined}
              required
            />
            <button type="button" className="sm-actions-btn ac-show" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword} aria-controls="ac-pw">
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {(error || locked > 0) && (
          <p id="ac-error" className="at-form-alert" role="alert">
            {error || `Too many incorrect attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.`}
          </p>
        )}
        <button type="submit" className="btn btn-primary ac-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Shell>
  )
}

export function SessionExpired({ onSignIn, onExit }) {
  return (
    <Shell title="Your session has expired" onExit={onExit}>
      <p className="ac-lead">For your security you have been signed out. Nothing on screen was kept. (Demo state.)</p>
      <button type="button" className="btn btn-primary" onClick={onSignIn}>Sign in again</button>
    </Shell>
  )
}

/** Shown in place of a page the user may not open, even via a direct link. */
export function AccessDenied({ moduleLabel, user, onHome }) {
  return (
    <section className="hr-panel ac-denied" role="alert">
      <span className="ac-denied-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
      <h2>You don&apos;t have access to {moduleLabel}</h2>
      <p>
        This page is not available to {user.role} ({companyNames(user.companyIds)}).
      </p>
      <button type="button" className="btn btn-secondary" onClick={onHome}>Go to the dashboard</button>
    </section>
  )
}
