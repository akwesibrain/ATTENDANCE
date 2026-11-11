import { useEffect, useState } from 'react'
import {
  TRACKING_EVENT,
  deviceTrackedStaffId,
  findEmployee,
  startLocationSharing,
  trackingStatus,
} from '../../services/locationTrackingService'
import { formatAccraTime } from '../../utils/accraTime'
import './location-sharing.css'

const TEXT = {
  starting: { tone: 'pending', text: 'Starting location sharing…' },
  sharing: { tone: 'ok', text: 'Location sharing is on' },
  offline: { tone: 'warn', text: 'No mobile data — your location is not being sent. Turn on mobile data.' },
  denied: { tone: 'crit', text: 'Location permission is blocked. Allow location for this site in your browser settings.' },
  unavailable: { tone: 'warn', text: 'Location is not available. Turn on Location (GPS) on this phone.' },
  unsupported: { tone: 'crit', text: 'This phone cannot share its location.' },
}

/**
 * Shown on the employee pages of a Supervisor's, Sales Rep's or Merchandiser's phone between clock-in and
 * clock-out. It sends the phone's location while the page is open, and says
 * so plainly; it stops by itself at clock-out.
 */
export default function LocationSharingBar() {
  const [staffId, setStaffId] = useState(() => deviceTrackedStaffId())
  const [state, setState] = useState({ status: 'starting' })

  useEffect(() => {
    const sync = () => setStaffId(deviceTrackedStaffId())
    window.addEventListener(TRACKING_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(TRACKING_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const active = Boolean(staffId) && trackingStatus(staffId).active
  useEffect(() => {
    if (!active) return undefined
    return startLocationSharing(staffId, setState)
  }, [staffId, active])

  // Back online: say so straight away instead of waiting for the next GPS fix.
  useEffect(() => {
    const onOnline = () => setState((s) => (s.status === 'offline' ? { status: 'starting' } : s))
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (!active) return null
  const t = TEXT[state.status] ?? TEXT.starting
  const name = findEmployee(staffId)?.fullName ?? staffId
  return (
    <div className={`ls-bar ls-${t.tone}`} role="status" aria-live="polite">
      <span className="ls-dot" aria-hidden="true" />
      <span className="ls-text">
        <strong>{t.text}</strong>
        <span>
          {name} · HR can see where you are until you clock out
          {state.status === 'sharing' && state.at ? ` · sent ${formatAccraTime(state.at)}` : ''}
          {' · keep this page open · '}
          <a href="/tracking-policy" target="_blank" rel="noopener">Tracking Policy</a>
        </span>
      </span>
    </div>
  )
}
