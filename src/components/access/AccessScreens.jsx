import { useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import { demoSignIn, listHrUsers } from '../../services/permissionsService'

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
          Demo only. There is no real sign-in, password or MFA here, and this prototype is not secure.
          In production every restriction must be enforced by the backend.
        </p>
      </div>
    </div>
  )
}

const companyNames = (ids) => ids.map((id) => COMPANIES.find((c) => c.id === id)?.name).join(' & ')

/** Demo sign-in for the single HR account (no password; not authentication). */
export function DemoSignIn({ onSignedIn, onExit, reason }) {
  const [error, setError] = useState('')
  const users = listHrUsers()
  return (
    <Shell title="Sign in to the HR portal" onExit={onExit}>
      {reason && <p className="ac-reason" role="status">{reason}</p>}
      <ul className="ac-users">
        {users.map((u) => {
          const blocked = u.status !== 'active'
          const why = 'Account not active'
          return (
            <li key={u.id}>
              <button
                type="button"
                className="ac-user"
                disabled={blocked}
                onClick={() => {
                  const result = demoSignIn(u.id)
                  if (result.error) setError(result.error)
                  else onSignedIn(result.user)
                }}
              >
                <span className="hr-avatar hr-avatar-fallback" aria-hidden="true">{u.initials}</span>
                <span className="ac-user-text">
                  <strong>{u.name}</strong>
                  <span>{u.role} · {companyNames(u.companyIds)}</span>
                </span>
                {blocked && <span className="ac-blocked">{why}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p className="at-form-alert" role="alert">{error}</p>}
    </Shell>
  )
}

export function SessionExpired({ onSignIn, onExit }) {
  return (
    <Shell title="Your session has expired" onExit={onExit}>
      <p className="ac-lead">For your security you have been signed out. Nothing on screen was kept. (Demo state.)</p>
      <button type="button" className="btn btn-primary" onClick={onSignIn}>Sign in again (demo)</button>
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
