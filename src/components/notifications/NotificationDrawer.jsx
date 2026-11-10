import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NOTIFICATION_CATEGORIES,
  RESOLUTION_ACTIONS,
} from '../../constants/notificationTypes'
import { sourceLabel } from '../../constants/attendanceLabels'
import { canManageNotifications, hrUsersForCompany } from '../../constants/hrUser'
import {
  isOpen,
  mockAddComment,
  mockAssign,
  mockDismiss,
  mockReopen,
  mockResolve,
  mockSetRead,
  mockStartReview,
} from '../../services/notificationsService'
import { mockGetAttendanceRecord, listAttendanceRoster } from '../../services/attendanceRecordsService'
import { RESULT_LABELS } from '../sales-monitoring/labels'
import { StatusBadge, VerificationBadge } from '../attendance/AttendanceBadges'
import { clockText } from '../attendance/format'
import { formatAccraDate, formatAccraDateTime, formatAccraTime } from '../../utils/accraTime'
import { NotificationStatusBadge, SeverityBadge } from './NotificationBadges'

function Detail({ label, children }) {
  return (
    <div className="sm-detail">
      <span className="sm-detail-label">{label}</span>
      <span className="sm-detail-value">{children ?? '—'}</span>
    </div>
  )
}

function titleCase(value) {
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const NAV_FOR_CATEGORY = {
  attendance: { nav: 'attendance', label: 'Go to Attendance' },
  'sales-monitoring': { nav: 'sales-monitoring', label: 'Go to Sales Rep Monitoring' },
  'employee-shift': { nav: 'employees', label: 'Go to Employees' },
  'system-data': { nav: 'attendance', label: 'Go to Attendance' },
}

/** Confirmation dialog for resolve / dismiss / reopen (required fields). */
function ConfirmDialog({ kind, notification, onCancel, onConfirm, error }) {
  const [actionTaken, setActionTaken] = useState('')
  const [text, setText] = useState('')
  const firstRef = useRef(null)
  useEffect(() => firstRef.current?.focus(), [])

  const copy = {
    resolve: {
      title: 'Resolve this exception?',
      lead: 'Record what was done. The resolution, your name and the time are kept in the history.',
      label: 'Resolution notes',
      button: 'Confirm resolve',
    },
    dismiss: {
      title: 'Dismiss this notification?',
      lead: 'Dismissing closes it without action. A reason is required and kept in the history; nothing is deleted.',
      label: 'Reason for dismissing',
      button: 'Confirm dismiss',
    },
    reopen: {
      title: 'Reopen this notification?',
      lead: 'It returns to Under Review. The earlier decision stays in the history.',
      label: 'Reason for reopening',
      button: 'Confirm reopen',
    },
  }[kind]

  return (
    <div className="nt-confirm-overlay" role="presentation">
      <div className="nt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="nt-confirm-title">
        <h3 id="nt-confirm-title">{copy.title}</h3>
        <p className="nt-muted">
          {notification.title} · {notification.employeeName} ({notification.employeeId})
        </p>
        <p className="nt-confirm-lead">{copy.lead}</p>
        {kind === 'resolve' && (
          <div className="sh-form-field">
            <label className="sh-form-label" htmlFor="nt-action">Action taken</label>
            <select
              id="nt-action"
              ref={firstRef}
              className="sh-form-select"
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
            >
              <option value="">Choose an action…</option>
              {RESOLUTION_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        <div className="sh-form-field">
          <label className="sh-form-label" htmlFor="nt-confirm-text">{copy.label}</label>
          <textarea
            id="nt-confirm-text"
            ref={kind === 'resolve' ? undefined : firstRef}
            className="sh-form-input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
        {error && <p className="at-form-alert" role="alert">{error}</p>}
        <div className="sm-alert-actions">
          <button
            type="button"
            className={`btn ${kind === 'dismiss' ? 'btn-secondary nt-btn-danger' : 'btn-primary'}`}
            onClick={() => onConfirm({ actionTaken, text })}
          >
            {copy.button}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Notification detail drawer. Shows only evidence that exists in the mock
 * data: the live attendance record, the related SMS event's recorded fields
 * and the assigned shop. Employee GPS coordinates are never shown or invented.
 */
export default function NotificationDrawer({ notification, user, onClose, onChanged, onOpenAttendance, onNavigate }) {
  const n = notification
  const canAct = canManageNotifications(user)
  const [assignee, setAssignee] = useState('')
  const [comment, setComment] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [confirmError, setConfirmError] = useState('')

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape' && !confirm) onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose, confirm])

  const record = useMemo(
    () => (n.relatedDate ? mockGetAttendanceRecord(n.employeeId, n.relatedDate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n.id, n.history.length],
  )
  const employee = useMemo(
    () => listAttendanceRoster(n.companyId).find((e) => e.employeeId === n.employeeId) ?? null,
    [n.companyId, n.employeeId],
  )
  const smsEvent = record?.smsEvents.find((e) => e.eventId === n.smsEventId) ?? null
  const shop = record?.shop ?? null
  const schedule = record?.schedule ?? null
  const officers = hrUsersForCompany(n.companyId)
  const open = isOpen(n)
  // Historical Import was removed; its old notifications point to Attendance.
  const nav = n.importBatchId
    ? { nav: 'attendance', label: 'Go to Attendance' }
    : NAV_FOR_CATEGORY[n.category]

  const run = (result) => {
    if (result.error) {
      setError(result.error)
      return false
    }
    setError('')
    onChanged()
    return true
  }

  const handleConfirm = ({ actionTaken, text }) => {
    let result
    if (confirm === 'resolve') result = mockResolve(n.id, { actionTaken, notes: text }, user)
    else if (confirm === 'dismiss') result = mockDismiss(n.id, { reason: text }, user)
    else result = mockReopen(n.id, text, user)
    if (result.error) {
      setConfirmError(result.error)
      return
    }
    setConfirm(null)
    setConfirmError('')
    onChanged()
  }

  const history = n.history.slice().reverse()

  return (
    <div
      className="nt-drawer-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirm) onClose()
      }}
    >
      <aside className="nt-drawer" role="dialog" aria-modal="true" aria-labelledby="nt-drawer-title">
        <header className="nt-drawer-head">
          <div>
            <div className="nt-drawer-badges">
              <SeverityBadge severity={n.severity} />
              <NotificationStatusBadge status={n.status} />
              <span className="nt-category">{NOTIFICATION_CATEGORIES[n.category]}</span>
              {!n.read && <span className="nt-unread-tag">Unread</span>}
            </div>
            <h3 id="nt-drawer-title">{n.title}</h3>
            <p className="nt-muted">
              {n.companyName} · {n.id} · Event {formatAccraDateTime(n.occurredAt)}
            </p>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="nt-drawer-body">
          <p className="nt-description">{n.description}</p>
          {n.conditionClearedAt && open && (
            <p className="nt-cleared">
              The condition behind this notification was no longer detected on{' '}
              {formatAccraDateTime(n.conditionClearedAt)}. Review and resolve if no further action is needed.
            </p>
          )}

          {/* Status outcome */}
          {n.status === 'resolved' && n.resolution && (
            <div className="nt-outcome nt-outcome-resolved">
              <strong>Resolved — {n.resolution.actionTaken}</strong>
              <span>{n.resolution.notes}</span>
              <span className="nt-muted">{n.resolution.by} · {formatAccraDateTime(n.resolution.at)}</span>
            </div>
          )}
          {n.status === 'dismissed' && n.dismissal && (
            <div className="nt-outcome nt-outcome-dismissed">
              <strong>Dismissed</strong>
              <span>{n.dismissal.reason}</span>
              <span className="nt-muted">{n.dismissal.by} · {formatAccraDateTime(n.dismissal.at)}</span>
            </div>
          )}

          {/* HR actions */}
          {canAct && (
            <section className="nt-actions-panel" aria-label="HR actions">
              <div className="nt-action-row">
                <button type="button" className="sm-actions-btn" onClick={() => run(mockSetRead(n.id, !n.read, user))}>
                  Mark as {n.read ? 'unread' : 'read'}
                </button>
                {open && n.status === 'new' && (
                  <button type="button" className="sm-actions-btn" onClick={() => run(mockStartReview(n.id, user))}>
                    Start review
                  </button>
                )}
                {open && (
                  <>
                    <button type="button" className="sm-actions-btn nt-btn-primary" onClick={() => setConfirm('resolve')}>
                      Resolve…
                    </button>
                    <button type="button" className="sm-actions-btn" onClick={() => setConfirm('dismiss')}>
                      Dismiss…
                    </button>
                  </>
                )}
                {!open && (
                  <button type="button" className="sm-actions-btn" onClick={() => setConfirm('reopen')}>
                    Reopen…
                  </button>
                )}
              </div>
              <div className="nt-action-row">
                <label className="sr-only" htmlFor="nt-assign">Assign to</label>
                <select
                  id="nt-assign"
                  className="sm-select nt-inline-select"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">
                    {n.assignedTo ? `Assigned: ${n.assignedTo.name}` : 'Assign…'}
                  </option>
                  {officers.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="sm-actions-btn"
                  disabled={!assignee}
                  onClick={() => {
                    if (run(mockAssign(n.id, assignee, user))) setAssignee('')
                  }}
                >
                  Assign
                </button>
              </div>
              {error && <p className="at-form-alert" role="alert">{error}</p>}
            </section>
          )}

          <section className="sm-section">
            <h4 className="sm-section-title">Employee</h4>
            <div className="sm-detail-grid">
              <Detail label="Employee">{n.employeeName}</Detail>
              <Detail label="Employee ID">{n.employeeId ?? 'Not matched'}</Detail>
              <Detail label="Company">{n.companyName}</Detail>
              <Detail label="Position">{n.position}</Detail>
              <Detail label="Assigned shop">
                {shop?.shopName ?? (employee?.shopId ? employee.shopId : employee?.isFieldRole ? 'Not assigned' : 'Not applicable')}
              </Detail>
              <Detail label="Working hours">
                {schedule ? `${schedule.startTime}–${schedule.endTime}` : 'Standard working hours'}
              </Detail>
              <Detail label="Assigned to">{n.assignedTo ? `${n.assignedTo.name} (${n.assignedTo.role})` : 'Unassigned'}</Detail>
              <Detail label="Event time">{formatAccraDateTime(n.occurredAt)}</Detail>
            </div>
          </section>

          {record && (
            <section className="sm-section">
              <h4 className="sm-section-title">Related attendance record — {formatAccraDate(record.date)}</h4>
              <div className="sm-detail-grid">
                <Detail label="Attendance status"><StatusBadge status={record.status} /></Detail>
                <Detail label="Verification"><VerificationBadge verification={record.verification} /></Detail>
                <Detail label="Clock-in">{clockText(record.clockIn, record.clockInUnknown)}</Detail>
                <Detail label="Clock-out">{record.atWork ? 'Still at work' : clockText(record.clockOut, record.clockOutUnknown)}</Detail>
                <Detail label="Expected hours">{formatAccraTime(record.expectedStart)} – {formatAccraTime(record.expectedEnd)}</Detail>
                <Detail label="Source">{sourceLabel(record.source)}{record.manualType ? ` (${record.manualType === 'created' ? 'manually created' : 'corrected'})` : ''}</Detail>
              </div>
              <div className="nt-section-actions">
                <button type="button" className="hr-link" onClick={() => onOpenAttendance(record)}>
                  Open full attendance record →
                </button>
              </div>
            </section>
          )}

          {smsEvent && (
            <section className="sm-section">
              <h4 className="sm-section-title">Related SMS verification event</h4>
              <div className="sm-detail-grid">
                <Detail label="Check">Verification {smsEvent.verificationNumber} of 3</Detail>
                <Detail label="Result">
                  <span className={`sm-result sm-result-${smsEvent.result}`}>{RESULT_LABELS[smsEvent.result] ?? smsEvent.result}</span>
                </Detail>
                <Detail label="SMS sent at">{formatAccraTime(smsEvent.dispatchedAt)}</Detail>
                <Detail label="SMS delivery">{titleCase(smsEvent.deliveryStatus)}</Detail>
                <Detail label="Employee response">{smsEvent.respondedAt ? formatAccraTime(smsEvent.respondedAt) : 'No response'}</Detail>
              </div>
            </section>
          )}

          <section className="sm-section">
            <h4 className="sm-section-title">Verification evidence</h4>
            {smsEvent && smsEvent.respondedAt ? (
              <div className="sm-detail-grid">
                <Detail label="Face match">{titleCase(smsEvent.faceVerificationStatus)}</Detail>
                <Detail label="Liveness">{titleCase(smsEvent.livenessStatus)}</Detail>
                <Detail label="GPS verification">{titleCase(smsEvent.gpsVerificationStatus)}</Detail>
                <Detail label="Distance from shop">
                  {smsEvent.distanceFromShop != null ? `${smsEvent.distanceFromShop} m (geofence ${shop?.geofenceRadius ?? 150} m)` : 'Not recorded'}
                </Detail>
                <Detail label="GPS accuracy">{smsEvent.gpsAccuracy != null ? `±${smsEvent.gpsAccuracy} m` : 'Not recorded'}</Detail>
                <Detail label="Employee coordinates">Not stored in this demo</Detail>
              </div>
            ) : record && record.face.status !== 'none' ? (
              <div className="sm-detail-grid">
                <Detail label="Face verification">{record.face.label}</Detail>
                <Detail label="GPS verification">{record.gps.label}</Detail>
              </div>
            ) : (
              <p className="sm-empty at-flush" style={{ padding: 14 }}>
                No face or GPS evidence exists for this notification.
              </p>
            )}
            <p className="at-section-note">
              Verification results are simulated demo data, not genuine biometric or GPS evidence.
            </p>
          </section>

          {canAct && (
            <section className="sm-section">
              <h4 className="sm-section-title">Add internal comment</h4>
              <div className="at-section-pad">
                <label className="sr-only" htmlFor="nt-comment">Internal comment</label>
                <textarea
                  id="nt-comment"
                  className="sm-alert-note"
                  placeholder="Visible to HR only…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div>
                  <button
                    type="button"
                    className="sm-actions-btn"
                    disabled={comment.trim().length < 3}
                    onClick={() => {
                      if (run(mockAddComment(n.id, comment, user))) setComment('')
                    }}
                  >
                    Add comment
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className="sm-section">
            <h4 className="sm-section-title">Action history ({history.length})</h4>
            <ol className="nt-history">
              {history.map((h) => (
                <li key={h.id} className={h.isComment ? 'is-comment' : ''}>
                  <div className="nt-history-head">
                    <strong>{h.action}</strong>
                    <span className="nt-muted">{h.by} · {formatAccraDateTime(h.at)}</span>
                  </div>
                  {h.note && <p>{h.note}</p>}
                </li>
              ))}
            </ol>
          </section>

          {nav && (
            <div className="nt-section-actions">
              <button type="button" className="hr-link" onClick={() => onNavigate(nav.nav)}>
                {nav.label} →
              </button>
              {n.category !== 'employee-shift' && n.employeeId && (
                <button type="button" className="hr-link" onClick={() => onNavigate('employees')}>
                  Go to Employees →
                </button>
              )}
            </div>
          )}
        </div>

        {confirm && (
          <ConfirmDialog
            kind={confirm}
            notification={n}
            error={confirmError}
            onCancel={() => {
              setConfirm(null)
              setConfirmError('')
            }}
            onConfirm={handleConfirm}
          />
        )}
      </aside>
    </div>
  )
}
