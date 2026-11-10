import { useMemo, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import {
  LEVEL_LABELS,
  MODULES,
  ROLES,
  can,
  invitationStatus,
  listHrUsers,
  mockAuditLog,
} from '../services/permissionsService'
import { formatAccraDateTime } from '../utils/accraTime'
import PermissionMatrix from '../components/hr-users/PermissionMatrix'
import UserDrawer from '../components/hr-users/UserDrawer'
import UserFormModal from '../components/hr-users/UserFormModal'
import { AccountStatusBadge, InvitationBadge, RoleBadge } from '../components/hr-users/UserBadges'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/attendance.css'
import '../styles/notifications.css'
import '../styles/hr-users.css'

const PAGE_SIZE = 10
const companyNames = (ids) => ids.map((id) => COMPANIES.find((c) => c.id === id)?.name).join(' & ')

function permissionSummary(user) {
  const count = Object.values(user.grants).reduce((s, l) => s + l.length, 0)
  const modules = Object.values(user.grants).filter((l) => l.length).length
  return `${modules} modules · ${count} permissions`
}

/**
 * HR Users & Permissions — Super Administrators manage HR users, roles,
 * company access and permissions. Frontend prototype: no real accounts,
 * email or authentication.
 */
export default function HrUsers({ user: actor, onChanged }) {
  const [tab, setTab] = useState('users')
  const [version, setVersion] = useState(0)
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null) // user | 'new'
  const [flash, setFlash] = useState('')

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const users = useMemo(() => listHrUsers(), [version])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const audit = useMemo(() => mockAuditLog(actor), [version, actor])
  const canCreate = can(actor, 'hr-users', 'create')
  const canAudit = can(actor, 'audit-logs', 'view')

  const changed = (message) => {
    setVersion((v) => v + 1)
    onChanged?.()
    if (message) setFlash(message)
  }

  const term = search.trim().toLowerCase()
  const filtered = users.filter((u) => {
    if (company && !u.companyIds.includes(company)) return false
    if (role && u.roleId !== role) return false
    if (status && u.status !== status) return false
    if (term && !u.name.toLowerCase().includes(term) && !u.email.toLowerCase().includes(term)) return false
    return true
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const pageItems = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const open = openId ? users.find((u) => u.id === openId) : null

  const stats = {
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    inactive: users.filter((u) => u.status === 'inactive').length,
    pending: users.filter((u) => u.status === 'pending' && ['draft', 'sent'].includes(invitationStatus(u))).length,
    bfl: users.filter((u) => u.companyIds.includes('box-for-less')).length,
    daa: users.filter((u) => u.companyIds.includes('double-a')).length,
  }
  const filtersActive = search || company || role || status
  const clear = () => { setSearch(''); setCompany(''); setRole(''); setStatus(''); setPage(1) }

  return (
    <div className="sm-page hu-page">
      <div className="sm-head">
        <div>
          <h2>HR Users &amp; Permissions</h2>
          <p>Manage who can use the HR portal, which company they can see and what they can do.</p>
        </div>
        {canCreate && (
          <div className="at-head-actions">
            <button type="button" className="btn btn-primary at-btn" onClick={() => setEditing('new')}>Add HR user</button>
          </div>
        )}
      </div>

      <p className="hu-warning" role="note">
        Frontend prototype: these checks run in the browser and can be bypassed. In production every restriction
        must also be enforced by the backend on every protected API and data operation.
      </p>

      {flash && (
        <div className="at-flash" role="status"><span>{flash}</span><button type="button" className="hr-link" onClick={() => setFlash('')}>Dismiss</button></div>
      )}

      <div className="sm-stats" role="status" aria-label="HR user summary">
        <div className="sm-stat"><span className="sm-stat-label">Total HR users</span><span className="sm-stat-value">{stats.total}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Active users</span><span className="sm-stat-value sm-stat-ok">{stats.active}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Inactive users</span><span className="sm-stat-value">{stats.inactive}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Pending invitations</span><span className="sm-stat-value sm-stat-accent">{stats.pending}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Box For Less HR users</span><span className="sm-stat-value">{stats.bfl}</span></div>
        <div className="sm-stat"><span className="sm-stat-label">Double A HR users</span><span className="sm-stat-value">{stats.daa}</span></div>
      </div>

      <div className="sm-tabs" role="tablist" aria-label="HR users sections">
        <button type="button" role="tab" aria-selected={tab === 'users'} className={`sm-tab${tab === 'users' ? ' is-active' : ''}`} onClick={() => setTab('users')}>Users</button>
        <button type="button" role="tab" aria-selected={tab === 'roles'} className={`sm-tab${tab === 'roles' ? ' is-active' : ''}`} onClick={() => setTab('roles')}>Roles &amp; permission matrix</button>
        {canAudit && <button type="button" role="tab" aria-selected={tab === 'audit'} className={`sm-tab${tab === 'audit' ? ' is-active' : ''}`} onClick={() => setTab('audit')}>Account activity</button>}
      </div>

      {tab === 'users' && (
        <section className="sm-panel">
          <div className="at-filters">
            <input type="search" className="form-input sm-search" placeholder="Search name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search HR users" />
            <select className="sm-select" value={company} onChange={(e) => { setCompany(e.target.value); setPage(1) }} aria-label="Company">
              <option value="">All companies</option>
              {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="sm-select" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }} aria-label="Role">
              <option value="">All roles</option>
              {Object.entries(ROLES).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
            </select>
            <select className="sm-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Account status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending invitation</option>
            </select>
            <button type="button" className="hr-link at-clear" onClick={clear} disabled={!filtersActive}>Clear filters</button>
          </div>
          <div className="sm-panel-head at-table-head">
            <h3>HR users</h3>
            <span className="sm-muted">{filtered.length} of {users.length}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="sm-empty">
              <p style={{ margin: 0 }}>No HR users match the filters.</p>
              <button type="button" className="hr-link" onClick={clear}>Clear filters</button>
            </div>
          ) : (
            <>
              <div className="sm-table-wrap">
                <table className="sm-table hu-table">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Company</th>
                      <th scope="col">Role</th>
                      <th scope="col">Permissions</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last login</th>
                      <th scope="col">Created</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((u) => (
                      <tr key={u.id}>
                        <td data-label="User">
                          <span className="at-stack">
                            <span className="at-emp-name">{u.name}{u.id === actor.id ? ' (you)' : ''}</span>
                            <span className="at-sub">{u.email}</span>
                          </span>
                        </td>
                        <td data-label="Company">{companyNames(u.companyIds)}</td>
                        <td data-label="Role"><RoleBadge roleId={u.roleId} /></td>
                        <td data-label="Permissions">
                          <span className="at-stack">
                            {permissionSummary(u)}
                            <span className="at-sub">{u.customised ? 'Customised' : 'Role defaults'}</span>
                          </span>
                        </td>
                        <td data-label="Status">
                          <span className="at-stack">
                            <AccountStatusBadge status={u.status} />
                            {u.status === 'pending' && <InvitationBadge status={invitationStatus(u)} />}
                          </span>
                        </td>
                        <td data-label="Last login" className="at-nowrap">{u.lastLoginAt ? formatAccraDateTime(u.lastLoginAt) : 'Never'}</td>
                        <td data-label="Created" className="at-nowrap">{formatAccraDateTime(u.createdAt)}</td>
                        <td data-label="Actions" className="at-actions">
                          <button type="button" className="sm-actions-btn" onClick={() => setOpenId(u.id)}>View</button>
                          {can(actor, 'hr-users', 'edit') && <button type="button" className="sm-actions-btn" style={{ marginLeft: 6 }} onClick={() => setEditing(u)}>Edit</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="at-pagination" aria-label="HR user pages">
                <span className="sm-muted">Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <div className="at-pages">
                  <button type="button" className="sm-actions-btn" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
                  <span className="at-page-num">Page {current} of {pageCount}</span>
                  <button type="button" className="sm-actions-btn" disabled={current === pageCount} onClick={() => setPage(current + 1)}>Next</button>
                </div>
              </nav>
            </>
          )}
        </section>
      )}

      {tab === 'roles' && (
        <section className="sm-panel">
          <div className="sm-panel-head"><h3>Role permission matrix</h3><span className="sm-muted">Defaults and the most each role can be granted</span></div>
          <div className="hu-roles">
            {Object.entries(ROLES).map(([id, r]) => (
              <article key={id} className="hu-role-card">
                <div className="hu-role-card-head">
                  <RoleBadge roleId={id} />
                  <span className="at-sub">{r.scope === 'all' ? 'Both companies (always)' : r.scope === 'multi' ? 'One or both assigned companies' : 'One assigned company'}</span>
                </div>
                <p className="at-sub" style={{ margin: 0 }}>{r.description}</p>
                <PermissionMatrix roleId={id} grants={r.ceiling} readOnly />
              </article>
            ))}
          </div>
          <div className="at-section-pad">
            <p className="sh-form-note" style={{ margin: 0 }}>
              Custom permissions can only switch levels on or off within a role&apos;s column above. Unsafe combinations
              are blocked: any level needs View; corrections and manual attendance entry need Attendance view; only Super
              Administrators can manage HR users or system settings; HR Managers may cover one or both companies (each
              company&apos;s data stays separate); HR Officers cover one company.
            </p>
            <p className="at-sub" style={{ margin: '8px 0 0' }}>
              Modules: {MODULES.map((m) => `${m.label} (${m.levels.map((l) => LEVEL_LABELS[l]).join('/')})`).join(' · ')}
            </p>
          </div>
        </section>
      )}

      {tab === 'audit' && canAudit && (
        <section className="sm-panel">
          <div className="sm-panel-head"><h3>Account activity</h3><span className="sm-muted">{audit.length} entries</span></div>
          {audit.length === 0 ? (
            <p className="sm-empty">No account activity yet.</p>
          ) : (
            <div className="sm-table-wrap">
              <table className="sm-table">
                <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">Activity</th><th scope="col">By</th><th scope="col">Details</th></tr></thead>
                <tbody>
                  {audit.slice(0, 200).map((a) => (
                    <tr key={a.id}>
                      <td className="at-nowrap">{formatAccraDateTime(a.at)}</td>
                      <td>{a.userName}</td>
                      <td><strong>{a.action}</strong></td>
                      <td>{a.by}</td>
                      <td className="at-sub">{a.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {open && (
        <UserDrawer
          key={`${open.id}-${version}`}
          user={open}
          actor={actor}
          onClose={() => setOpenId(null)}
          onEdit={() => { setEditing(open); setOpenId(null) }}
          onChanged={() => changed()}
        />
      )}

      {editing && (
        <UserFormModal
          user={editing === 'new' ? null : editing}
          actor={actor}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setEditing(null)
            changed(editing === 'new' ? `${u.name} was added as a draft. Open the user to send a demo invitation.` : `${u.name} was updated.`)
            setOpenId(u.id)
          }}
        />
      )}
    </div>
  )
}
