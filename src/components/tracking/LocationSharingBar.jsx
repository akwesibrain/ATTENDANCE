import { useEffect, useState } from 'react'
import { TRACKING_EVENT, startLocationSharing } from '../../services/locationTrackingService'
import { trackingSession } from '../../services/visitService'
import { formatAccraTime } from '../../utils/accraTime'
import './location-sharing.css'

const TEXT = {
  starting: { tone: 'pending', text: 'Starting location sharing…' },
  sharing: { tone: 'ok', text: 'Location sharing is on' },
  offline: { tone: 'warn', text: 'No mobile data — locations are queued and will send when data returns.' },
  denied: { tone: 'crit', text: 'Location permission is blocked. Allow location for this site in your browser settings.' },
  unavailable: { tone: 'warn', text: 'Location is not available. Turn on Location (GPS) on this phone.' },
  unsupported: { tone: 'crit', text: 'This phone cannot share its location.' },
}

/**
 * Shown on the employee pages of a Supervisor's, Sales Rep's or Merchandiser's
 * phone between clock-in and clock-out. Sends the phone's location to the
 * server while the page is open, and stops automatically at clock-out.
 */
export default function LocationSharingBar() {
  const [session, setSession] = useState(() => trackingSession())
  const [state, setState] = useState({ status: 'starting' })

  useEffect(() => {
    const sync = () => setSession(trackingSession())
    window.addEventListener(TRACKING_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(TRACKING_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const token = session?.token ?? null
  useEffect(() => {
    if (!token) return undefined
    return startLocationSharing((next) => {
      if (next.status === 'stopped') {
        setSession(null)
        return
      }
      setState(next)
    })
  }, [token])

  // Back online: say so straight away instead of waiting for the next GPS fix.
  useEffect(() => {
    const onOnline = () => setState((s) => (s.status === 'offline' ? { status: 'starting' } : s))
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (!session) return null
  const t = TEXT[state.status] ?? TEXT.starting
  const name = session.fullName || session.staffId
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
