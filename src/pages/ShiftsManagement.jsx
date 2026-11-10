import { useMemo, useState } from 'react'
import ShiftFormModal from '../components/shifts/ShiftFormModal'
import AssignShiftModal from '../components/shifts/AssignShiftModal'
import { listAssignableEmployees } from '../components/shifts/assignableEmployees'
import {
  formatClock,
  formatWorkingDays,
  isOvernight,
  mockListShifts,
  mockUpdateShift,
} from '../services/shiftsService'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import { can } from '../constants/hrUser'

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function ShiftCard({ shift, assignedCount, canEdit, onEdit, onAssign, onToggleStatus }) {
  const active = shift.status === 'active'
  const hasBreak = shift.breakStart && shift.breakEnd
  return (
    <article className="sh-card">
      <div className="sh-card-head">
        <div className="sh-card-title">
          <span className="sh-card-icon"><ClockIcon /></span>
          <div>
            <h3 className="sh-card-name">{shift.name}</h3>
            <p className="sh-card-code">{shift.code}</p>
          </div>
        </div>
        <span className={`sh-status sh-status-${active ? 'active' : 'inactive'}`}>
          {active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="sh-times">
        <div className="sh-time-block">
          <span className="sh-time-label">Starts</span>
          <span className="sh-time-value">{formatClock(shift.startTime)}</span>
        </div>
        <span className="sh-time-arrow" aria-hidden="true">→</span>
        <div className="sh-time-block">
          <span className="sh-time-label">Ends</span>
          <span className="sh-time-value">{formatClock(shift.endTime)}</span>
        </div>
        {isOvernight(shift) && <span className="sh-overnight">Ends next day</span>}
      </div>

      <div className="sh-meta">
        <div className="sh-meta-item">
          <span className="sh-meta-label">Working days</span>
          <span className="sh-meta-value">{formatWorkingDays(shift.workingDays)}</span>
        </div>
        <div className="sh-meta-item">
          <span className="sh-meta-label">Break</span>
          <span className="sh-meta-value">
            {hasBreak ? `${formatClock(shift.breakStart)} to ${formatClock(shift.breakEnd)}` : 'None'}
          </span>
        </div>
        <div className="sh-meta-item">
          <span className="sh-meta-label">Grace period</span>
          <span className="sh-meta-value">{shift.graceMinutes} min</span>
        </div>
        <div className="sh-meta-item">
          <span className="sh-meta-label">Expected hours</span>
          <span className="sh-meta-value">{shift.expectedHours} h</span>
        </div>
        <div className="sh-meta-item">
          <span className="sh-meta-label">Employees on shift</span>
          <span className="sh-meta-value">{assignedCount}</span>
        </div>
      </div>

      {shift.description && <p className="sh-card-desc">{shift.description}</p>}

      {canEdit && <div className="sh-card-actions">
        <button type="button" className="btn btn-primary" onClick={onAssign} disabled={!active}>
          Assign employees
        </button>
        <button type="button" className="btn btn-secondary" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-outline" onClick={onToggleStatus}>
          {active ? 'Deactivate' : 'Activate'}
        </button>
      </div>}
    </article>
  )
}

/**
 * Shifts & Working Hours — define each company's shifts and put employees on
 * them. A shift's window also bounds the field verification checks used by
 * Sales Rep Monitoring. Mock-backed.
 */
export default function ShiftsManagement({ company, user }) {
  const canCreate = can(user, 'shifts', 'create')
  const canEdit = can(user, 'shifts', 'edit')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [editing, setEditing] = useState(null) // null | 'new' | shift
  const [assigning, setAssigning] = useState(null)
  const [notice, setNotice] = useState('')

  const refresh = () => setRefreshKey((k) => k + 1)

  const shifts = useMemo(
    () => mockListShifts(company.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, refreshKey],
  )

  const employees = useMemo(
    () => listAssignableEmployees(company.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, refreshKey],
  )

  const countByShift = useMemo(() => {
    const counts = {}
    employees.forEach((e) => {
      if (e.shiftId) counts[e.shiftId] = (counts[e.shiftId] ?? 0) + 1
    })
    return counts
  }, [employees])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return shifts.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false
      if (term && !s.name.toLowerCase().includes(term) && !s.code.toLowerCase().includes(term)) {
        return false
      }
      return true
    })
  }, [shifts, search, statusFilter])

  const shiftIds = new Set(shifts.map((s) => s.shiftId))
  const stats = {
    total: shifts.length,
    active: shifts.filter((s) => s.status === 'active').length,
    assigned: employees.filter((e) => e.shiftId && shiftIds.has(e.shiftId)).length,
    unassigned: employees.filter((e) => !e.shiftId || !shiftIds.has(e.shiftId)).length,
  }

  const toggleStatus = (shift) => {
    const next = shift.status === 'active' ? 'inactive' : 'active'
    const count = countByShift[shift.shiftId] ?? 0
    if (
      next === 'inactive' &&
      count > 0 &&
      !window.confirm(
        `${count} employee${count === 1 ? ' is' : 's are'} on ${shift.name}. ` +
          'They keep this shift until you move them. Deactivate it anyway?',
      )
    ) {
      return
    }
    mockUpdateShift(shift.shiftId, { ...shift, status: next })
    setNotice(`${shift.name} is now ${next}.`)
    refresh()
  }

  return (
    <div className="sh-page">
      <div className="sh-head">
        <div>
          <h2>Shifts and working hours</h2>
          <p>
            Set the working hours for {company.name} and choose who works each
            shift.
          </p>
        </div>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            New shift
          </button>
        )}
      </div>

      <div className="sh-stats" role="status" aria-label="Shift summary">
        <div className="sh-stat">
          <span className="sh-stat-label">Shifts</span>
          <span className="sh-stat-value">{stats.total}</span>
        </div>
        <div className="sh-stat">
          <span className="sh-stat-label">Active shifts</span>
          <span className="sh-stat-value sh-stat-ok">{stats.active}</span>
        </div>
        <div className="sh-stat">
          <span className="sh-stat-label">Employees on a shift</span>
          <span className="sh-stat-value sh-stat-accent">{stats.assigned}</span>
        </div>
        <div className="sh-stat">
          <span className="sh-stat-label">Without a shift</span>
          <span className={`sh-stat-value${stats.unassigned > 0 ? ' sh-stat-warn' : ''}`}>
            {stats.unassigned}
          </span>
        </div>
      </div>

      {notice && (
        <p className="sh-form-note" role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}

      <div className="sh-controls">
        <input
          type="search"
          className="form-input sh-search"
          placeholder="Search shift name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search shifts"
        />
        <select
          className="sh-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="sh-empty">
          {shifts.length === 0
            ? `No shifts for ${company.name} yet. Create the first one to start assigning employees.`
            : 'No shifts match your search.'}
        </p>
      ) : (
        <div className="sh-grid">
          {filtered.map((shift) => (
            <ShiftCard
              key={shift.shiftId}
              shift={shift}
              assignedCount={countByShift[shift.shiftId] ?? 0}
              canEdit={canEdit}
              onEdit={() => setEditing(shift)}
              onAssign={() => setAssigning(shift)}
              onToggleStatus={() => toggleStatus(shift)}
            />
          ))}
        </div>
      )}

      {editing && (
        <ShiftFormModal
          shift={editing === 'new' ? null : editing}
          company={company}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setNotice(`${saved.name} saved.`)
            refresh()
          }}
        />
      )}

      {assigning && (
        <AssignShiftModal
          shift={assigning}
          employees={employees}
          onClose={() => setAssigning(null)}
          onAssigned={({ assigned, skipped }) => {
            setNotice(
              `${assigned} employee${assigned === 1 ? '' : 's'} assigned to ${assigning.name}` +
                (skipped ? `, ${skipped} skipped (different company).` : '.'),
            )
            refresh()
          }}
        />
      )}
    </div>
  )
}
