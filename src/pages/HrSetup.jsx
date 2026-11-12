import { useEffect, useState } from 'react'
import { supabase } from '../services/backend/client'
import { completeHrSetup, getHrSetup } from '../services/onboardingService'
import { LINK_UNUSABLE, MIN_PASSWORD_LENGTH, validateNewPassword } from '../../supabase/functions/_shared/rules/onboarding.js'
import '../styles/registration.css'

/**
 * The page an HR invite link opens. A new person chooses their password and
 * goes on to set up their authenticator app; someone who already has a
 * sign-in just gains HR access.
 */
export default function HrSetup({ token }) {
  const [invite, setInvite] = useState(null)
  const [closed, setClosed] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    getHrSetup(token)
      .then(setInvite)
      .catch((failure) => setClosed(failure.status === 404 ? LINK_UNUSABLE : failure.message))
  }, [token])

  const problem = validateNewPassword(password, confirm)

  const finish = async (e) => {
    e?.preventDefault()
    setTouched(true)
    if (busy || (!invite.hasAccount && problem) || (invite.hasAccount && !password)) return
    setBusy(true)
    setError('')
    try {
      if (invite.hasAccount) {
        // Signing in first proves this person owns the existing account.
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: invite.email, password })
        if (signInError) { setError('That password is not right for this email.'); return }
      }
      const result = await completeHrSetup(token, invite.hasAccount ? {} : { password, confirm })
      if (invite.hasAccount && !result.errors) { window.location.assign('/hr'); return }
      if (result.errors) {
        if (result.error === LINK_UNUSABLE) setClosed(LINK_UNUSABLE)
        else setError(result.error)
        return
      }
      if (!result.passwordSet) { setJoined(true); return }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: result.email, password })
      if (signInError) { setJoined(true); return }
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

          {!closed && !invite && <p className="step-description" role="status">Opening your invite…</p>}

          {joined && (
            <>
              <h2 className="step-title">You have HR access</h2>
              <p className="step-description">Sign in at the HR portal with {invite.email} and your password.</p>
              <div className="step-actions">
                <a className="btn btn-primary" href="/hr">Go to the HR portal</a>
              </div>
            </>
          )}

          {invite && !closed && !joined && (
            <>
              <p className="step-eyebrow">HR portal · invited by {invite.invitedBy}</p>
              <h2 className="step-title">Welcome, {invite.name.split(' ')[0]}</h2>

              {invite.hasAccount ? (
                <>
                  <form onSubmit={finish} noValidate>
                    <p className="step-description">
                      You already have a sign-in for <strong>{invite.email}</strong>. Enter its password to add HR access to it.
                    </p>
                    <div className="form-grid">
                      <div className="form-field">
                        <label className="form-label" htmlFor="hs-existing">Your existing password</label>
                        <input id="hs-existing" type="password" className="form-input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </div>
                    </div>
                    {touched && !password && <p className="form-error" role="alert">Enter your password.</p>}
                    {error && <div className="submit-error" role="alert"><span>{error}</span></div>}
                    <div className="step-actions">
                      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Accept'}</button>
                    </div>
                  </form>
                </>
              ) : (
                <form onSubmit={finish} noValidate>
                  <p className="step-description">
                    You will sign in with <strong>{invite.email}</strong>. Choose a password of at least {MIN_PASSWORD_LENGTH} characters.
                    Next you will set up an authenticator app.
                  </p>
                  <div className="form-grid">
                    <div className="form-field">
                      <label className="form-label" htmlFor="hs-password">Password</label>
                      <input id="hs-password" type="password" className="form-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    </div>
                    <div className="form-field">
                      <label className="form-label" htmlFor="hs-confirm">Type it again</label>
                      <input id="hs-confirm" type="password" className="form-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && Boolean(problem)} />
                    </div>
                  </div>
                  {touched && problem && <p className="form-error" role="alert">{problem}</p>}
                  {error && <div className="submit-error" role="alert"><span>{error}</span></div>}
                  <div className="step-actions">
                    <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set password and continue'}</button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}
