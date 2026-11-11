import { useMemo, useState } from 'react'
import { getPaymentMethodLabel } from '../../constants/paymentMethods'
import {
  mockGetAssignmentWithShop,
  requiresShop,
} from '../../services/shopAssignmentService'
import { formatClock } from '../../services/shiftsService'
import { defaultHoursFor } from '../../services/settingsService'
import { employeeDetailsLocked, employeeJoinedOn } from '../../services/registrationService'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'
import { formatTenure, tenureBetween } from '../../utils/tenure'
import EmployeeDetailsModal from './EmployeeDetailsModal'
import LeaveModal from './LeaveModal'
import { CATEGORIES, categoryForPosition } from '../../constants/employeeCategories'
import { currentOrNextLeave } from '../../services/leaveService'

const PAGE_SIZE = 8

function initials(name) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
}

function CardIcon({ name }) {
  const paths = {
    id: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <circle cx="8" cy="10" r="2" />
        <path d="M5 16c.6-1.6 1.7-2.5 3-2.5s2.4.9 3 2.5M14 9h5M14 13h5" />
      </>
    ),
    phone: (
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    ),
    mail: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 6L2 7" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    alert: (
      <>
        <path d="M12 2 2 20h20L12 2z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function EmployeeCard({ emp, onAssignShop, onViewAttendance, onEditDetails, onLeave }) {
  const isField = requiresShop(emp.position)
  const assignment = isField ? mockGetAssignmentWithShop(emp.staffId) : null
  const needsAssignment = isField && !assignment
  const joinedOn = employeeJoinedOn(emp)
  const tenure = tenureBetween(joinedOn, accraTodayKey())
  const { current: onLeaveNow, next: nextLeave } = currentOrNextLeave(emp.staffId)

  return (
    <article className="emp-card">
      <div className="emp-card-banner" aria-hidden="true" />
      <div className="emp-card-body">
        <div className="emp-card-head">
          {emp.faceImage ? (
            <img className="emp-card-photo" src={emp.faceImage} alt={`${emp.fullName}`} />
          ) : (
            <span className="emp-card-photo emp-card-photo-fallback">
              {initials(emp.fullName)}
            </span>
          )}
          <span className={`emp-card-status emp-card-status-${emp.status === 'ACTIVE' ? 'active' : 'inactive'}`}>
            {emp.status}
          </span>
        </div>
        <h3 className="emp-card-name">{emp.fullName}</h3>
        <p className="emp-card-position">{emp.position}</p>
        <span className={`emp-card-category emp-cat-${categoryForPosition(emp.position)}`}>{CATEGORIES[categoryForPosition(emp.position)].single}</span>
        {onLeaveNow && (
          <p className="emp-card-leave is-now">
            <CardIcon name="calendar" /> On {onLeaveNow.leaveType.toLowerCase()} until {formatAccraDate(onLeaveNow.endDate)}
          </p>
        )}
        {!onLeaveNow && nextLeave && (
          <p className="emp-card-leave">
            <CardIcon name="calendar" /> {nextLeave.leaveType} from {formatAccraDate(nextLeave.startDate)}
          </p>
        )}

        {isField && (
          <div className={`emp-card-shop${needsAssignment ? ' is-required' : ''}`}>
            {assignment ? (
              <>
                <span className="emp-card-icon"><CardIcon name="pin" /></span>
                <span className="emp-card-shop-text">
                  <span className="emp-card-shop-name">{assignment.shopName}</span>
                  <span className="emp-card-shop-address">{assignment.address}</span>
                </span>
              </>
            ) : (
              <>
                <span className="emp-card-icon emp-card-icon-warn"><CardIcon name="pin" /></span>
                <span className="emp-card-shop-text">
                  <span className="emp-card-shop-required">Shop Assignment Required</span>
                  {onAssignShop && (
                    <button
                      type="button"
                      className="emp-card-assign-link"
                      onClick={() => onAssignShop(emp)}
                    >
                      Assign shop
                    </button>
                  )}
                </span>
              </>
            )}
          </div>
        )}

        <ul className="emp-card-details">
          <li>
            <span className="emp-card-icon"><CardIcon name="id" /></span>
            <span className="emp-card-mono">{emp.staffId}</span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="phone" /></span>
            <span>{emp.phone || '—'}</span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="mail" /></span>
            <span className="emp-card-ellipsis" title={emp.email || ''}>{emp.email || '—'}</span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="pin" /></span>
            <span className="emp-card-ellipsis" title={emp.address || ''}>{emp.address || '—'}</span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="clock" /></span>
            <span>
              {(() => { const h = defaultHoursFor(emp.companyId); return `${formatClock(h.startTime)} to ${formatClock(h.endTime)}, Monday to Friday` })()}
            </span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="card" /></span>
            <span>{getPaymentMethodLabel(emp.paymentMethod) || '—'}</span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="calendar" /></span>
            <span className="emp-card-wrap">
              Joined {joinedOn ? formatAccraDate(joinedOn) : '—'}
              {!emp.joinedOn && joinedOn && <span className="emp-card-note"> (registration date)</span>}
            </span>
          </li>
          <li>
            <span className="emp-card-icon"><CardIcon name="clock" /></span>
            <span className="emp-card-wrap">{tenure ? `${formatTenure(tenure)} with the company` : '—'}</span>
          </li>
        </ul>

        <div className="emp-card-emergency">
          <span className="emp-card-emergency-title"><CardIcon name="alert" /> Emergency contact</span>
          {emp.emergencyContactName || emp.emergencyContactPhone ? (
            <>
              <span className="emp-card-wrap emp-card-emergency-name">{emp.emergencyContactName || 'Name not given'}</span>
              {emp.emergencyContactPhone
                ? <a className="emp-card-emergency-phone" href={`tel:${emp.emergencyContactPhone.replace(/\s+/g, '')}`}>{emp.emergencyContactPhone}</a>
                : <span className="emp-card-note">Phone not given</span>}
            </>
          ) : <span className="emp-card-note">Not provided</span>}
        </div>
        {employeeDetailsLocked(emp) ? (
          <p className="emp-card-locked">
            <CardIcon name="lock" /> Confirmed by {emp.detailsUpdatedBy ?? 'HR'} on {formatAccraDate(emp.detailsUpdatedAt.slice(0, 10))}
          </p>
        ) : onEditDetails && (
          <button type="button" className="sm-actions-btn emp-card-edit" onClick={() => onEditDetails(emp)}>
            Add date joined &amp; emergency contact
          </button>
        )}
        {onLeave && (
          <button type="button" className="sm-actions-btn emp-card-edit" onClick={() => onLeave(emp)}>
            {onLeaveNow ? 'Leave · end early or view' : 'Record leave'}
          </button>
        )}
        {onViewAttendance && (
          <button type="button" className="hr-link emp-card-history" onClick={() => onViewAttendance(emp)}>
            Attendance history →
          </button>
        )}
      </div>
    </article>
  )
}

/**
 * Employee directory — card grid grouped by position, with search and
 * pagination. Each card shows the information the employee gave at
 * registration.
 */
export default function EmployeeDirectory({ employees, onAssignShop, onViewAttendance, onEmployeeChanged }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [leaveFor, setLeaveFor] = useState(null)
  const [, setLeaveVersion] = useState(0)
  const [saved, setSaved] = useState('')
  const [page, setPage] = useState(1)

  const [category, setCategory] = useState('')
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const inCategory = category ? employees.filter((e) => categoryForPosition(e.position) === category) : employees
    if (!term) return inCategory
    return inCategory.filter(
      (e) =>
        e.fullName.toLowerCase().includes(term) ||
        e.staffId.toLowerCase().includes(term) ||
        e.position.toLowerCase().includes(term) ||
        (e.phone ?? '').toLowerCase().includes(term) ||
        (e.email ?? '').toLowerCase().includes(term) ||
        (e.emergencyContactName ?? '').toLowerCase().includes(term),
    )
  }, [employees, search, category])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Group the current page by position, preserving order of first appearance.
  const pageGroups = useMemo(() => {
    const map = new Map()
    pageItems.forEach((emp) => {
      const key = emp.position || 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(emp)
    })
    return Array.from(map.entries())
  }, [pageItems])

  const handleSearch = (value) => {
    setSearch(value)
    setPage(1)
  }

  return (
    <div className="emp-directory">
      <div className="emp-directory-head">
        <h2>{filtered.length} Employee{filtered.length === 1 ? '' : 's'}</h2>
        <input
          type="search"
          className="form-input hr-search"
          placeholder="Search name, Staff ID, position, phone or email…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          aria-label="Search employees"
        />
      </div>
      <div className="sm-tabs emp-category-filter" role="tablist" aria-label="Employee category">
        {['', 'warehouse', 'sales-rep', 'merchandiser', 'supervisor', 'office'].map((c) => {
          const n = c ? employees.filter((e) => categoryForPosition(e.position) === c).length : employees.length
          return (
            <button key={c || 'all'} type="button" role="tab" aria-selected={category === c} className={`sm-tab${category === c ? ' is-active' : ''}`} onClick={() => { setCategory(c); setPage(1) }}>
              {c ? CATEGORIES[c].label : 'All'} <span className="sm-tab-count">{n}</span>
            </button>
          )
        })}
      </div>

      {saved && <p className="emp-saved" role="status">{saved}</p>}
      {editing && (
        <EmployeeDetailsModal
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={(emp) => { setEditing(null); setSaved(`Saved ${emp.fullName}'s details.`); onEmployeeChanged(emp) }}
        />
      )}

      {leaveFor && (
        <LeaveModal
          employee={leaveFor}
          onClose={() => setLeaveFor(null)}
          onChanged={() => { setLeaveVersion((v) => v + 1); onEmployeeChanged(leaveFor) }}
        />
      )}

      {filtered.length === 0 ? (
        <p className="hr-empty" style={{ padding: '32px 12px' }}>
          No employees match your search.
        </p>
      ) : (
        pageGroups.map(([position, members]) => (
          <section className="emp-group" key={position}>
            <h3 className="emp-group-title">{position}</h3>
            <div className="emp-grid">
              {members.map((emp) => (
                <EmployeeCard key={emp.staffId} emp={emp} onAssignShop={onAssignShop} onViewAttendance={onViewAttendance} onEditDetails={onEmployeeChanged ? setEditing : null} onLeave={onEmployeeChanged ? setLeaveFor : null} />
              ))}
            </div>
          </section>
        ))
      )}

      {totalPages > 1 && (
        <nav className="emp-pagination" aria-label="Employee pages">
          <button
            type="button"
            className="emp-page-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`emp-page-btn${n === safePage ? ' is-active' : ''}`}
              onClick={() => setPage(n)}
              aria-current={n === safePage ? 'page' : undefined}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className="emp-page-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
          >
            ›
          </button>
        </nav>
      )}
    </div>
  )
}
