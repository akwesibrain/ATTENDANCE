import { useEffect, useMemo, useState } from 'react'
import { formatClock, mockGetShift } from '../../services/shiftsService'
import { mockAssignShiftToMany } from '../../services/shiftAssignmentService'

function todayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * HR action: put one or more employees on a shift. Only employees of the
 * shift's company are listed; the service enforces this again. Each change is
 * recorded in the employee's shift history with an effective date.
 */
export default function AssignShiftModal({ shift, employees, onClose, onAssigned }) {
  const [selected, setSelected] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(todayKey())

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  // Current shift for each employee, for the "currently on" note.
  const rows = useMemo(
    () =>
      employees.map((emp) => {
        const current = emp.shiftId ? mockGetShift(emp.shiftId) : null
        return { ...emp, current, onThisShift: emp.shiftId === shift.shiftId }
      }),
    [employees, shift.shiftId],
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(term) ||
        r.employeeId.toLowerCase().includes(term) ||
        r.position.toLowerCase().includes(term),
    )
  }, [rows, search])

  const toggle = (employeeId) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })
  }

  const handleAssign = () => {
    if (selected.size === 0 || !effectiveDate) return
    const [y, m, d] = effectiveDate.split('-').map(Number)
    const result = mockAssignShiftToMany(Array.from(selected), shift.shiftId, {
      companyId: shift.companyId,
      effectiveDate: new Date(y, m - 1, d).toISOString(),
    })
    onAssigned(result)
    onClose()
  }

  return (
    <div
      className="sm-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-shift-title"
        style={{ maxWidth: 560 }}
      >
        <div className="sm-modal-head">
          <div>
            <h3 id="assign-shift-title">Assign employees</h3>
            <p>
              {shift.name} · {formatClock(shift.startTime)} to {formatClock(shift.endTime)}
            </p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sm-modal-body">
          <div className="sh-form-grid">
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="assign-shift-search">Find employees</label>
              <input
                id="assign-shift-search"
                type="search"
                className="sh-form-input"
                placeholder="Name, Staff ID or position"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="sh-form-field">
              <label className="sh-form-label" htmlFor="assign-shift-date">Effective from</label>
              <input
                id="assign-shift-date"
                type="date"
                className="sh-form-input"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="sh-empty">
              {rows.length === 0
                ? 'No employees in this company yet.'
                : 'No employees match your search.'}
            </p>
          ) : (
            <div className="sh-assign-list" role="group" aria-label="Employees">
              {visible.map((row) => (
                <label
                  key={row.employeeId}
                  className="sh-assign-item"
                  style={row.onThisShift ? { cursor: 'default', opacity: 0.6 } : undefined}
                >
                  <input
                    type="checkbox"
                    checked={row.onThisShift || selected.has(row.employeeId)}
                    disabled={row.onThisShift}
                    onChange={() => toggle(row.employeeId)}
                  />
                  <span>
                    <span className="sh-assign-name">{row.fullName}</span>
                    <span className="sm-muted" style={{ display: 'block', fontSize: 12.5 }}>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{row.employeeId}</span>
                      {' · '}
                      {row.position}
                    </span>
                  </span>
                  <span className="sh-assign-meta">
                    {row.onThisShift
                      ? 'On this shift'
                      : row.current
                        ? `Now on ${row.current.name}`
                        : 'No shift'}
                  </span>
                </label>
              ))}
            </div>
          )}

          <p className="sm-muted" style={{ margin: 0, fontSize: 13 }}>
            Moving someone from another shift keeps their earlier assignment in
            their history.
          </p>

          <div className="sm-alert-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAssign}
              disabled={selected.size === 0 || !effectiveDate}
            >
              {selected.size > 0
                ? `Assign ${selected.size} employee${selected.size === 1 ? '' : 's'}`
                : 'Assign employees'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
