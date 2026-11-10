import { useEffect, useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import {
  can,
  invitationStatus,
  mockAcceptInvitation,
  mockExpireInvitation,
  mockSendInvitation,
  mockSetUserActive,
} from '../../services/permissionsService'
import { formatAccraDateTime } from '../../utils/accraTime'
import PermissionMatrix from './PermissionMatrix'
import { AccountStatusBadge, InvitationBadge, RoleBadge } from './UserBadges'

function Detail({ label, children }) {
  return (
    <div className="sm-detail">
      <span className="sm-detail-label">{label}</span>
      <span className="sm-detail-value">{children ?? '—'}</span>
    </div>
  )
}

/** User details: account, invitation (demo), permissions and activity. */
export default function UserDrawer({ user, actor, onClose, onEdit, onChanged }) {
  const [confirm, setConfirm] = useState(null) // 'activate' | 'deactivate'
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const canEdit = can(actor, 'hr-users', 'edit')
  const canManage = can(actor, 'hr-users', 'manage')
  const canInvite = can(actor, 'hr-users', 'create')
  const invite = invitationStatus(user)

  useEffect(() => {
    const onEscape = (e) => { if (e.key === 'Escape' && !confirm) onClose() }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose, confirm])

  const run = (result) => {
    if (result.error) { setError(result.error); return false }
    setError('')
    onChanged()
    return true
  }

  return (
    <div className="nt-drawer-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !confirm) onClose() }}>
      <aside className="nt-drawer" role="dialog" aria-modal="true" aria-labelledby="hu-drawer-title">
        <header className="nt-drawer-head">
          <div>
            <div className="nt-drawer-badges">
              <RoleBadge roleId={user.roleId} />
              <AccountStatusBadge status={user.status} />
              {user.customised && <span className="nt-category">Custom permissions</span>}
            </div>
            <h3 id="hu-drawer-title">{user.name}</h3>
            <p className="nt-muted">{user.email}</p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="nt-drawer-body">
          {error && <p className="at-form-alert" role="alert">{error}</p>}
          {(canEdit || canManage || canInvite) && (
            <section className="nt-actions-panel" aria-label="Account actions">
              <div className="nt-action-row">
                {canEdit && <button type="button" className="sm-actions-btn" onClick={onEdit}>Edit user &amp; permissions</button>}
                {canManage && user.status === 'active' && user.id !== actor.id && (
                  <button type="button" className="sm-actions-btn nt-btn-danger" onClick={() => { setConfirm('deactivate'); setReason('') }}>Deactivate…</button>
                )}
                {canManage && user.status === 'inactive' && (
                  <button type="button" className="sm-actions-btn" onClick={() => { setConfirm('activate'); setReason('') }}>Reactivate…</button>
                )}
              </div>
              {canInvite && user.status === 'pending' && (
                <div className="nt-action-row">
                  {(invite === 'draft' || invite === 'expired') && (
                    <button type="button" className="sm-actions-btn nt-btn-primary" onClick={() => run(mockSendInvitation(user.id, actor))}>
                      {invite === 'draft' ? 'Send invitation (demo)' : 'Re-send invitation (demo)'}
                    </button>
                  )}
                  {invite === 'sent' && (
                    <>
                      <button type="button" className="sm-actions-btn" onClick={() => run(mockAcceptInvitation(user.id))}>Simulate acceptance (demo)</button>
                      <button type="button" className="sm-actions-btn" onClick={() => run(mockExpireInvitation(user.id, actor))}>Simulate expiry (demo)</button>
                    </>
                  )}
                  <span className="at-sub">No email is sent. These buttons simulate the invitation flow.</span>
                </div>
              )}
            </section>
          )}

          <section className="sm-section">
            <h4 className="sm-section-title">Account</h4>
            <div className="sm-detail-grid">
              <Detail label="Company access">{user.companyIds.map((c) => COMPANIES.find((x) => x.id === c)?.name).join(' & ')}</Detail>
              <Detail label="Role">{user.role}</Detail>
              <Detail label="Account status"><AccountStatusBadge status={user.status} /></Detail>
              <Detail label="Invitation"><InvitationBadge status={invite} /></Detail>
              <Detail label="Invitation expires">{user.invitation?.expiresAt && invite !== 'accepted' ? formatAccraDateTime(user.invitation.expiresAt) : '—'}</Detail>
              <Detail label="Last login">{user.lastLoginAt ? formatAccraDateTime(user.lastLoginAt) : 'Never'}</Detail>
              <Detail label="Created">{formatAccraDateTime(user.createdAt)}</Detail>
              <Detail label="Created by">{user.createdBy}</Detail>
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Permissions</h4>
            <PermissionMatrix roleId={user.roleId} grants={user.grants} readOnly />
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Account activity ({user.activity.length})</h4>
            <ol className="nt-history">
              {user.activity.slice().reverse().map((a) => (
                <li key={a.id}>
                  <div className="nt-history-head"><strong>{a.action}</strong><span className="nt-muted">{a.by} · {formatAccraDateTime(a.at)}</span></div>
                  {a.note && <p>{a.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {confirm && (
          <div className="nt-confirm-overlay" role="presentation">
            <div className="nt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="hu-act-title">
              <h3 id="hu-act-title">{confirm === 'deactivate' ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}</h3>
              <p className="nt-confirm-lead">
                {confirm === 'deactivate'
                  ? 'They lose access to every HR page immediately. Their history and past actions are kept.'
                  : 'They regain the access shown in their permissions.'}
              </p>
              <div className="sh-form-field">
                <label className="sh-form-label" htmlFor="hu-reason">Reason (required)</label>
                <textarea id="hu-reason" className="sh-form-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              {error && <p className="at-form-alert" role="alert">{error}</p>}
              <div className="sm-alert-actions">
                <button
                  type="button"
                  className={`btn ${confirm === 'deactivate' ? 'btn-secondary nt-btn-danger' : 'btn-primary'}`}
                  onClick={() => { if (run(mockSetUserActive(user.id, confirm === 'activate', reason, actor))) setConfirm(null) }}
                >
                  {confirm === 'deactivate' ? 'Deactivate account' : 'Reactivate account'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setConfirm(null); setError('') }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
