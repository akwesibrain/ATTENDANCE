import { useEffect, useState } from 'react'
import { supabase } from '../services/backend/client'
import { completePasswordReset, getPasswordReset } from '../services/onboardingService'
import { LINK_UNUSABLE, MIN_PASSWORD_LENGTH, validateNewPassword } from '../../supabase/functions/_shared/rules/onboarding.js'
import '../styles/registration.css'

/** The page a password reset link opens: the HR user chooses a new password. */
export default function PasswordReset({ token }) {
  const [account, setAccount] = useState(null)
  const [closed, setClosed] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    getPasswordReset(token)
      .then(setAccount)
      .catch((failure) => setClosed(failure.status === 404 ? LINK_UNUSABLE : failure.message))
  }, [token])

  const problem = validateNewPassword(password, confirm)

  const finish = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (busy || problem) return
    setBusy(true)
    setError('')
    try {
      const result = await completePasswordReset(token, { password, confirm })
      if (result.errors) {
        if (result.error === LINK_UNUSABLE) setClosed(LINK_UNUSABLE)
        else setError(result.errors.password ?? result.error)
        return
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: result.email, password })
      if (signInError) { setChanged(true); return }
      // The HR portal asks for the authenticator code next.
      window.location.assign('/hr')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="registration-page">
      <div className="registration-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">WA</span>
          Workforce Attendance
        </header>
        <section className="card">
          {closed && (
            <>
              <h2 className="step-title">Link closed</h2>
              <p className="step-description">{closed}</p>
            </>
          )}

          {!closed && !account && <p className="step-description" role="status">Opening your reset link…</p>}

          {changed && (
            <>
              <h2 className="step-title">Password changed</h2>
              <p className="step-description">Sign in at the HR portal with {account.email} and your new password.</p>
              <div className="step-actions">
                <a className="btn btn-primary" href="/hr">Go to the HR portal</a>
              </div>
            </>
          )}

          {account && !closed && !changed && (
            <form onSubmit={finish} noValidate>
              <p className="step-eyebrow">HR portal · password reset</p>
              <h2 className="step-title">Choose a new password, {account.name.split(' ')[0]}</h2>
              <p className="step-description">
                You sign in with <strong>{account.email}</strong>. Use at least {MIN_PASSWORD_LENGTH} characters.
                Your authenticator app stays the same.
              </p>
              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label" htmlFor="pr-password">New password</label>
                  <input id="pr-password" type="password" className="form-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="pr-confirm">Type it again</label>
                  <input id="pr-confirm" type="password" className="form-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && Boolean(problem)} />
                </div>
              </div>
              {touched && problem && <p className="form-error" role="alert">{problem}</p>}
              {error && <div className="submit-error" role="alert"><span>{error}</span></div>}
              <div className="step-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
