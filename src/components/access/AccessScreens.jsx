import { useCallback, useEffect, useRef, useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import { supabase } from '../../services/backend/client'
import { startLiveRefresh } from '../../services/backend/cache'
import {
  confirmMfaEnrollment,
  getSessionUser,
  recordSignIn,
  sessionStatus,
  signIn,
  signOut,
  startMfaEnrollment,
  verifyMfa,
} from '../../services/permissionsService'
import { securitySettings } from '../../services/settingsService'

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
      </div>
    </div>
  )
}

const companyNames = (ids) => ids.map((id) => COMPANIES.find((c) => c.id === id)?.name).join(' & ')

function CodeField({ value, onChange }) {
  return (
    <div className="form-field">
      <label className="form-label" htmlFor="mfa-code">6-digit code</label>
      <input
        id="mfa-code"
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
      />
    </div>
  )
}

function SubmitButton({ busy, disabled, children }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
      {busy ? 'Please wait…' : children}
    </button>
  )
}

function useSubmit(action) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const problem = await action()
      if (problem) setError(problem)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function SignInForm({ onDone, onExit, reason }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit(async () => {
    const problem = await signIn(email, password)
    if (problem) return problem
    await onDone()
    return null
  })
  return (
    <Shell title="Sign in to the HR portal" onExit={onExit}>
      {reason && <p className="ac-reason" role="status">{reason}</p>}
      <form onSubmit={run}>
        <div className="form-field">
          <label className="form-label" htmlFor="hr-email">Email</label>
          <input id="hr-email" className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="hr-password">Password</label>
          <input id="hr-password" className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <p className="at-form-alert" role="alert">{error}</p>}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="ac-note">Forgot your password? Ask another HR user to reset it in Settings → HR users.</p>
    </Shell>
  )
}

function MfaVerify({ onDone, onExit }) {
  const [code, setCode] = useState('')
  const { busy, error, run } = useSubmit(async () => {
    const problem = await verifyMfa(code)
    if (problem) return problem
    await onDone({ signedIn: true })
    return null
  })
  return (
    <Shell title="Enter your authenticator code" onExit={onExit}>
      <p className="ac-lead">Open your authenticator app and enter the current code.</p>
      <form onSubmit={run}>
        <CodeField value={code} onChange={setCode} />
        {error && <p className="at-form-alert" role="alert">{error}</p>}
        <SubmitButton busy={busy} disabled={code.length !== 6}>Continue</SubmitButton>
      </form>
      <p className="ac-note">Lost or changed your phone? Ask another HR user to reset your authenticator in Settings → HR users.</p>
    </Shell>
  )
}

function MfaEnroll({ onDone, onExit }) {
  const [setup, setSetup] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => {
    let active = true
    startMfaEnrollment()
      .then((result) => { if (active) setSetup(result) })
      .catch((failure) => { if (active) setLoadError(failure.message) })
    return () => { active = false }
  }, [])
  const { busy, error, run } = useSubmit(async () => {
    const problem = await confirmMfaEnrollment(setup.factorId, code)
    if (problem) return problem
    await onDone({ signedIn: true })
    return null
  })
  return (
    <Shell title="Set up two-step sign-in" onExit={onExit}>
      {loadError && <p className="at-form-alert" role="alert">{loadError}</p>}
      {!setup && !loadError && <p className="ac-lead" role="status">Preparing…</p>}
      {setup && (
        <>
          <p className="ac-lead">
            HR accounts need an authenticator app, such as Google Authenticator or Authy. Scan this code, then enter the 6 digits the app shows.
          </p>
          <img src={setup.qrCode} alt="QR code for your authenticator app" width="200" height="200" style={{ background: '#fff', display: 'block', margin: '0 auto 12px' }} />
          <p className="ac-lead" style={{ wordBreak: 'break-all' }}>Or type this key: <code>{setup.secret}</code></p>
          <form onSubmit={run}>
            <CodeField value={code} onChange={setCode} />
            {error && <p className="at-form-alert" role="alert">{error}</p>}
            <SubmitButton busy={busy} disabled={code.length !== 6}>Finish setup</SubmitButton>
          </form>
        </>
      )}
    </Shell>
  )
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll']
const IDLE_CHECK_MS = 30000

/**
 * Shows the sign-in steps until the session is complete, then the portal.
 * Signs out after the idle time set in Settings → Security.
 */
export function HrGate({ onExit, children }) {
  const [state, setState] = useState({ status: 'loading', reason: null })
  const lastActivity = useRef(0)

  const check = useCallback(async ({ signedIn = false } = {}) => {
    try {
      const status = await sessionStatus()
      if (status === 'ready' && signedIn) recordSignIn()
      if (status === 'ready') lastActivity.current = Date.now()
      setState({ status, reason: status === 'no-access' ? 'This account does not have access to the HR portal.' : null })
    } catch (failure) {
      setState({ status: 'error', reason: failure.message })
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- check() only sets state after it awaits the session.
    check()
    // Signed out elsewhere, or the session was revoked.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setState((s) => (s.status === 'ready' ? { status: 'signed-out', reason: null } : s))
    })
    return () => data.subscription.unsubscribe()
  }, [check])

  const ready = state.status === 'ready'
  useEffect(() => {
    if (!ready) return undefined
    const stopRefresh = startLiveRefresh()
    const touch = () => { lastActivity.current = Date.now() }
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, touch, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > securitySettings().sessionTimeoutMinutes * 60000) {
        setState({ status: 'expired', reason: null })
        signOut()
      }
    }, IDLE_CHECK_MS)
    return () => {
      stopRefresh()
      clearInterval(timer)
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, touch))
    }
  }, [ready])

  switch (state.status) {
    case 'ready':
      return children(getSessionUser())
    case 'loading':
      return <Shell title="Loading…"><p className="ac-lead" role="status">Opening the HR portal.</p></Shell>
    case 'mfa-enroll':
      return <MfaEnroll onDone={check} onExit={onExit} />
    case 'mfa-verify':
      return <MfaVerify onDone={check} onExit={onExit} />
    case 'expired':
      return <SessionExpired onSignIn={() => setState({ status: 'signed-out', reason: null })} onExit={onExit} />
    case 'error':
      return (
        <Shell title="The HR portal could not load" onExit={onExit}>
          <p className="at-form-alert" role="alert">{state.reason}</p>
          <button type="button" className="btn btn-primary" onClick={() => { setState({ status: 'loading', reason: null }); check() }}>Try again</button>
        </Shell>
      )
    default:
      return <SignInForm onDone={check} onExit={onExit} reason={state.reason} />
  }
}

function SessionExpired({ onSignIn, onExit }) {
  return (
    <Shell title="Your session has expired" onExit={onExit}>
      <p className="ac-lead">For your security you have been signed out after a period of inactivity.</p>
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
