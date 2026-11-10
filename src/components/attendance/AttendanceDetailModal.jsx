import { useEffect } from 'react'
import { RESULT_LABELS } from '../sales-monitoring/labels'
import { sourceLabel } from '../../constants/attendanceLabels'
import { GEOFENCE_RADIUS_M } from '../../services/shopsService'
import { DIGITAL_GO_LIVE_DATE } from '../../utils/attendanceRules'
import {
  HISTORICAL_SOURCE_LABEL,
  MATCH_METHOD,
  NOTEBOOK_STATUS,
} from '../../constants/historicalImportLabels'
import {
  accraTodayKey,
  formatAccraDate,
  formatAccraDateTime,
  formatAccraTime,
} from '../../utils/accraTime'
import { formatTenure, tenureBetween } from '../../utils/tenure'
import { SourceTag, StatusBadge, VerificationBadge } from './AttendanceBadges'
import { arrivalText, clockText, durationText, initials } from './format'

function Detail({ label, children }) {
  return (
    <div className="sm-detail">
      <span className="sm-detail-label">{label}</span>
      <span className="sm-detail-value">{children ?? '—'}</span>
    </div>
  )
}

function EventField({ label, value }) {
  return (
    <div className="sm-event-field">
      <span className="sm-event-field-label">{label}</span>
      <span className="sm-event-field-value">{value ?? '—'}</span>
    </div>
  )
}

function titleCase(value) {
  if (!value) return '—'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** An original notebook time: the entered value, plus how it was written. */
function originalTime(t) {
  if (!t) return '—'
  if (t.unreadable) return `Unreadable${t.asWritten ? ` ("${t.asWritten}")` : ''} — Unknown`
  if (!t.time) return 'Not written — Unknown'
  return `${t.time}${t.asWritten ? ` (written "${t.asWritten}")` : ''}`
}

function clockWithDate(iso, unknown) {
  if (unknown) return 'Unknown'
  return iso ? formatAccraDateTime(iso) : 'Not recorded'
}

function ChangeValue({ value }) {
  if (value.clockInUnknown && !value.clockIn) return 'In: Unknown'
  return (
    <>
      In: {clockText(value.clockIn, value.clockInUnknown)}
      <br />
      Out: {value.clockOut ? formatAccraTime(value.clockOut) : value.clockOutUnknown ? 'Unknown' : '—'}
    </>
  )
}

/**
 * Full attendance record: employee, assignment, timings, verification
 * evidence, SMS verification events (past events only) and the correction
 * history. Verification results are simulated demo data.
 */
export default function AttendanceDetailModal({ record, canCorrect, onCorrect, onClose }) {
  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  if (!record) return null
  const r = record
  const historical = r.date < DIGITAL_GO_LIVE_DATE
  const correctable = canCorrect && r.status !== 'on-leave'

  return (
    <div
      className="sm-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sm-modal at-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Attendance record for ${r.fullName} on ${formatAccraDate(r.date)}`}
      >
        <div className="sm-modal-head">
          <div className="sm-profile-head">
            {r.photo ? (
              <img className="sm-profile-photo" src={r.photo} alt="" />
            ) : (
              <span className="sm-profile-photo sm-profile-photo-fallback">
                {initials(r.fullName)}
              </span>
            )}
            <div>
              <h3 className="sm-profile-name">{r.fullName}</h3>
              <p className="sm-profile-meta">
                {r.employeeId} · {formatAccraDate(r.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sm-modal-body">
          <div className="at-detail-summary">
            <StatusBadge status={r.status} />
            {r.isLate && r.status === 'incomplete' && <StatusBadge status="late" />}
            <VerificationBadge verification={r.verification} />
            <SourceTag record={r} />
            {r.atWork && <span className="at-badge at-tone-ok">Currently at work</span>}
          </div>

          {r.notes.length > 0 && (
            <ul className="at-notes">
              {r.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          <section className="sm-section">
            <h4 className="sm-section-title">Employee information</h4>
            <div className="sm-detail-grid">
              <Detail label="Full name">{r.fullName}</Detail>
              <Detail label="Employee ID">{r.employeeId}</Detail>
              <Detail label="Company">{r.companyName}</Detail>
              <Detail label="Job position">{r.position}</Detail>
              <Detail label="Phone number">{r.phone || '—'}</Detail>
              <Detail label="Date joined">
                {r.joinedOn ? (
                  <>
                    {formatAccraDate(r.joinedOn)}
                    <span className="at-sub"> · {formatTenure(tenureBetween(r.joinedOn, accraTodayKey()))}</span>
                  </>
                ) : 'Before digital registration'}
              </Detail>
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Assignment</h4>
            <div className="sm-detail-grid">
              <Detail label="Assigned shop">
                {r.shop ? r.shop.shopName : r.isFieldRole ? 'Not assigned' : 'Not applicable (office role)'}
              </Detail>
              <Detail label="Shop address">{r.shop?.addressLine || '—'}</Detail>
              <Detail label="Working hours">{r.schedule.startTime}–{r.schedule.endTime}</Detail>
              <Detail label="Working days">{r.schedule.workingDaysLabel}</Detail>
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Attendance timing (Africa/Accra)</h4>
            <div className="sm-detail-grid">
              <Detail label="Clock-in">{clockWithDate(r.clockIn, r.clockInUnknown)}</Detail>
              <Detail label="Clock-out">
                {r.atWork ? 'Still at work' : clockWithDate(r.clockOut, r.clockOutUnknown)}
              </Detail>
              <Detail label="Expected start">
                {formatAccraTime(r.expectedStart)}
                <span className="at-sub"> · {r.schedule.graceMinutes} min grace</span>
              </Detail>
              <Detail label="Expected end">{formatAccraTime(r.expectedEnd)}</Detail>
              <Detail label="Arrival difference">{arrivalText(r)}</Detail>
              <Detail label="Lateness">
                {r.lateUnknown
                  ? 'Unknown'
                  : r.isLate
                    ? `Late by ${durationText(r.lateMinutes)}`
                    : r.hasAttendance
                      ? 'Not late'
                      : '—'}
              </Detail>
              <Detail label="Working duration">
                {r.clockOutUnknown || r.clockInUnknown ? 'Unknown' : durationText(r.workingMinutes)}
              </Detail>
              <Detail label="Attendance source">{sourceLabel(r.source)}</Detail>
              {r.leave && (
                <Detail label="Approved leave">
                  {r.leave.leaveType} · {formatAccraDate(r.leave.startDate)} to {formatAccraDate(r.leave.endDate)}
                </Detail>
              )}
              {r.holidayName && <Detail label="Public holiday">{r.holidayName}</Detail>}
            </div>
          </section>

          {r.historical && (
            <section className="sm-section">
              <h4 className="sm-section-title">Historical source — {HISTORICAL_SOURCE_LABEL}</h4>
              <div className="sm-detail-grid">
                <Detail label="Import batch">{r.historical.batchName}</Detail>
                <Detail label="Notebook reference">
                  {r.historical.notebookReference}
                  {r.historical.pageReference ? ` · page ${r.historical.pageReference}` : ''}
                </Detail>
                <Detail label="Source">{r.historical.sourceDescription}</Detail>
                <Detail label="Attachment">{r.historical.attachmentName ?? 'None'}</Detail>
                <Detail label="Name as written">
                  {r.historical.rawName}
                  {r.historical.rawEmployeeId ? ` (${r.historical.rawEmployeeId})` : ''}
                </Detail>
                <Detail label="Notebook status">{NOTEBOOK_STATUS[r.historical.recordedStatus]}</Detail>
                <Detail label="Original arrival">{originalTime(r.historical.arrival)}</Detail>
                <Detail label="Original departure">{originalTime(r.historical.departure)}</Detail>
                <Detail label="Notebook remarks">{r.historical.remarks ?? '—'}</Detail>
                <Detail label="Employee match">
                  {r.historical.match ? `${MATCH_METHOD[r.historical.match.method] ?? r.historical.match.method} · ${r.historical.match.confirmedBy}` : '—'}
                </Detail>
                <Detail label="Imported by">
                  {r.historical.importedBy} · {formatAccraDateTime(r.historical.importedAt)}
                </Detail>
                <Detail label="Approved by">
                  {r.historical.approvedBy} · {formatAccraDateTime(r.historical.approvedAt)}
                </Detail>
              </div>
              <p className="at-section-note">
                Original notebook values are kept unchanged. Any correction is recorded separately in
                the correction history below.
              </p>
            </section>
          )}

          <section className="sm-section">
            <h4 className="sm-section-title">Verification</h4>
            <div className="sm-detail-grid">
              <Detail label="Face verification">{r.face.label}</Detail>
              <Detail label="GPS verification">{r.gps.label}</Detail>
              <Detail label="Distance from assigned shop">
                {r.distanceFromShop != null
                  ? `${r.distanceFromShop} m (geofence ${r.shop?.geofenceRadius ?? GEOFENCE_RADIUS_M} m)`
                  : '—'}
              </Detail>
              <Detail label="GPS accuracy">
                {r.gpsAccuracy != null ? `±${r.gpsAccuracy} m` : '—'}
              </Detail>
            </div>
            <p className="at-section-note">
              {historical
                ? 'Historical manually recorded entries carry no face, GPS or QR evidence and were not digitally clocked, so they are never shown as verified.'
                : 'Verification results in this demo are simulated. They are not genuine biometric or GPS evidence.'}
            </p>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Verification event history</h4>
            <div className="at-section-pad">
              {r.isFieldRole && !historical && (
                <p className="at-section-note at-flush">
                  Field roles get three SMS verification checks per working day. Only checks that have
                  already happened are shown. Future verification times are never displayed.
                </p>
              )}

              {r.scanEvents.length > 0 && (
                <ul className="at-scan-list">
                  {r.scanEvents.map((e) => (
                    <li key={`${e.label}-${e.at}`}>
                      <span className="at-scan-time">{formatAccraTime(e.at)}</span>
                      <span>{e.label}</span>
                      <span className="at-sub">{e.outcome}</span>
                    </li>
                  ))}
                </ul>
              )}

              {r.smsEvents.length > 0 && (
                <div className="sm-timeline">
                  {r.smsEvents.map((event) => (
                    <div className="sm-event" key={event.eventId}>
                      <div className="sm-event-head">
                        <span className="sm-event-num">
                          <span className="sm-event-num-badge">{event.verificationNumber}</span>
                          SMS verification {event.verificationNumber}
                        </span>
                        <span className={`sm-result sm-result-${event.result}`}>
                          {RESULT_LABELS[event.result] ?? event.result}
                        </span>
                      </div>
                      <div className="sm-event-grid">
                        <EventField label="Sent at" value={formatAccraTime(event.dispatchedAt)} />
                        <EventField label="SMS delivery" value={titleCase(event.deliveryStatus)} />
                        <EventField
                          label="Response at"
                          value={event.respondedAt ? formatAccraTime(event.respondedAt) : 'No response'}
                        />
                        <EventField label="Face match" value={titleCase(event.faceVerificationStatus)} />
                        <EventField label="Liveness" value={titleCase(event.livenessStatus)} />
                        <EventField label="GPS" value={titleCase(event.gpsVerificationStatus)} />
                        <EventField
                          label="Distance from shop"
                          value={event.distanceFromShop != null ? `${event.distanceFromShop} m` : '—'}
                        />
                        <EventField
                          label="GPS accuracy"
                          value={event.gpsAccuracy != null ? `±${event.gpsAccuracy} m` : '—'}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {r.scanEvents.length === 0 && r.smsEvents.length === 0 && (
                <p className="sm-empty at-flush">
                  {historical
                    ? 'No verification events exist for historical manually recorded entries.'
                    : r.isFieldRole
                      ? 'No SMS verification events have been recorded for this day.'
                      : 'No verification events were recorded on this date.'}
                </p>
              )}
            </div>
          </section>

          <section className="sm-section">
            <h4 className="sm-section-title">Correction history</h4>
            {r.corrections.length === 0 ? (
              <p className="sm-empty at-flush" style={{ padding: 16 }}>
                This record has not been changed manually.
              </p>
            ) : (
              <>
                <div className="at-original">
                  Originally recorded values ({sourceLabel(r.original.source)}):{' '}
                  <strong>
                    In {clockText(r.original.clockIn, r.original.clockInUnknown)} · Out{' '}
                    {clockText(r.original.clockOut, r.original.clockOutUnknown)}
                  </strong>
                </div>
                <div className="at-history">
                  {r.corrections.map((c) => (
                    <div className="at-history-item" key={c.id}>
                      <div className="at-history-head">
                        <strong>{c.action}</strong>
                        <span className="at-sub">
                          {formatAccraDateTime(c.changedAt)} · {c.changedBy} ({c.changedByRole})
                        </span>
                      </div>
                      <div className="at-history-change">
                        <div>
                          <span className="sm-event-field-label">Previous value</span>
                          <span className="at-history-value">
                            <ChangeValue value={c.previous} />
                          </span>
                        </div>
                        <span className="at-history-arrow" aria-hidden="true">→</span>
                        <div>
                          <span className="sm-event-field-label">New value</span>
                          <span className="at-history-value">
                            <ChangeValue value={c.next} />
                          </span>
                        </div>
                      </div>
                      <div className="at-history-reason">
                        <span className="sm-event-field-label">Reason</span> {c.reason}
                        <p>{c.remarks}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

        </div>

        <div className="sm-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {correctable && (
            <button type="button" className="btn btn-primary" onClick={() => onCorrect(r)}>
              {r.hasAttendance ? 'Correct attendance' : 'Record attendance manually'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
