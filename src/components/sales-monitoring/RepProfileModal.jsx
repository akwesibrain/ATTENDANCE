import { useEffect, useRef } from 'react'
import {
  REP_STATUS,
  RESULT_LABELS,
  formatTime,
  initials,
} from './labels'
import { GEOFENCE_RADIUS_M } from '../../services/salesMonitoringService'
import { formatShopCoordinates } from '../../services/shopsService'

function Detail({ label, value }) {
  return (
    <div className="sm-detail">
      <span className="sm-detail-label">{label}</span>
      <span className="sm-detail-value">{value ?? '—'}</span>
    </div>
  )
}

function ResultPill({ result }) {
  return (
    <span className={`sm-result sm-result-${result}`}>
      {RESULT_LABELS[result] ?? result}
    </span>
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

/**
 * Individual representative monitoring profile.
 * The verification history shows only events that have already happened —
 * never upcoming verification times or schedules.
 */
export default function RepProfileModal({ detail, onClose, initialSection }) {
  const bodyRef = useRef(null)

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  useEffect(() => {
    if (initialSection === 'history' && bodyRef.current) {
      const el = bodyRef.current.querySelector('[data-section="history"]')
      if (el) el.scrollIntoView({ block: 'start' })
    }
  }, [initialSection])

  if (!detail) return null
  const { shop, shift, day } = detail
  const status = REP_STATUS[day.status]

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
        aria-label={`Monitoring profile for ${detail.fullName}`}
      >
        <div className="sm-modal-head">
          <div className="sm-profile-head">
            {detail.profileImage ? (
              <img className="sm-profile-photo" src={detail.profileImage} alt="" />
            ) : (
              <span className="sm-profile-photo sm-profile-photo-fallback">
                {initials(detail.fullName)}
              </span>
            )}
            <div>
              <h3 className="sm-profile-name">{detail.fullName}</h3>
              <p className="sm-profile-meta">
                {detail.employeeId} · {detail.position}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="sm-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sm-modal-body" ref={bodyRef}>
          {/* Employee information */}
          <section className="sm-section">
            <h4 className="sm-section-title">Employee information</h4>
            <div className="sm-detail-grid">
              <Detail label="Full name" value={detail.fullName} />
              <Detail label="Employee ID" value={detail.employeeId} />
              <Detail label="Phone number" value={detail.phoneNumber} />
              <Detail label="Company" value={detail.companyName} />
              <Detail label="Employment status" value={detail.employmentStatus} />
              <Detail label="Job position" value={detail.position} />
            </div>
          </section>

          {/* Assignment information */}
          <section className="sm-section">
            <h4 className="sm-section-title">Assignment information</h4>
            <div className="sm-detail-grid">
              <Detail label="Assigned shop" value={shop?.shopName} />
              <Detail label="Shop address" value={shop?.addressLine} />
              <Detail
                label="Shop GPS coordinates"
                value={shop ? formatShopCoordinates(shop) : '—'}
              />
              <Detail label="Geofence radius" value={`${shop?.geofenceRadius ?? GEOFENCE_RADIUS_M} metres`} />
              <Detail label="Working hours" value={shift ? `${shift.startTime}–${shift.endTime}` : null} />
              <Detail label="Working days" value={shift?.workingDays} />
            </div>
          </section>

          {/* Attendance information */}
          <section className="sm-section">
            <h4 className="sm-section-title">Attendance information</h4>
            <div className="sm-detail-grid">
              <Detail label="Clock-in time" value={formatTime(day.checkInTime)} />
              <Detail label="Clock-out time" value={formatTime(day.checkOutTime)} />
              <div className="sm-detail">
                <span className="sm-detail-label">Current attendance status</span>
                <span className="sm-detail-value">
                  <span className={`sm-status ${status.className}`}>{status.label}</span>
                </span>
              </div>
              <Detail
                label="Completed verification checks"
                value={`${day.completedCount} of 3`}
              />
              <Detail label="Missed checks" value={day.missedCount} />
              <Detail label="Failed checks" value={day.failedCount} />
            </div>
          </section>

          {/* Verification history — past events only */}
          <section className="sm-section" data-section="history">
            <h4 className="sm-section-title">Verification history</h4>
            <div style={{ padding: 14 }}>
              {day.events.length === 0 ? (
                <p className="sm-empty" style={{ padding: '16px 8px' }}>
                  No verification events have happened yet on this date.
                </p>
              ) : (
                <div className="sm-timeline">
                  {day.events.map((event) => (
                    <div className="sm-event" key={event.eventId}>
                      <div className="sm-event-head">
                        <span className="sm-event-num">
                          <span className="sm-event-num-badge">
                            {event.verificationNumber}
                          </span>
                          Verification {event.verificationNumber}
                        </span>
                        <ResultPill result={event.result} />
                      </div>
                      <div className="sm-event-grid">
                        <EventField
                          label="SMS dispatched"
                          value={formatTime(event.dispatchedAt)}
                        />
                        <EventField
                          label="SMS delivery"
                          value={titleCase(event.deliveryStatus)}
                        />
                        <EventField
                          label="Employee response"
                          value={event.respondedAt ? formatTime(event.respondedAt) : 'No response'}
                        />
                        <EventField
                          label="Face match"
                          value={titleCase(event.faceVerificationStatus)}
                        />
                        <EventField
                          label="Liveness"
                          value={titleCase(event.livenessStatus)}
                        />
                        <EventField
                          label="GPS"
                          value={titleCase(event.gpsVerificationStatus)}
                        />
                        <EventField
                          label="Distance from shop"
                          value={
                            event.distanceFromShop != null
                              ? `${event.distanceFromShop} m`
                              : '—'
                          }
                        />
                        <EventField
                          label="GPS accuracy"
                          value={
                            event.gpsAccuracy != null
                              ? `±${event.gpsAccuracy} m`
                              : '—'
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
