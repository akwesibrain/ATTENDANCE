/**
 * Outlet visits from a field employee's phone. The phone that clocked in keeps
 * the tracking token from the check-in response; it is the only way to record
 * visits, and it stops working at clock-out.
 */

export const SESSION_KEY = 'tracking:session'

const API = `${import.meta.env?.VITE_SUPABASE_URL ?? ''}/functions/v1/api`

function read() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

function forget() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* storage unavailable */ }
}

/** After a successful scan: keep a field employee's token at check-in, drop it at check-out. */
export function saveTrackingSession(event) {
  if (!event) return
  try {
    if (event.type === 'check-in' && event.trackingToken) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: event.trackingToken, closesAt: event.trackingClosesAt, staffId: event.staffId }))
    }
    if (event.type === 'check-out') forget()
  } catch { /* storage unavailable: visits will ask the person to clock in */ }
}

/** This phone's tracking session, or null when there is none or it has ended. */
export function trackingSession() {
  const session = read()
  if (!session?.token) return null
  if (session.closesAt && Date.parse(session.closesAt) <= Date.now()) {
    forget()
    return null
  }
  return session
}

async function call(method, body) {
  const session = trackingSession()
  if (!session) {
    const error = new Error('Clock in first. Visits can only be recorded while you are clocked in.')
    error.status = 409
    error.data = { code: 'session_closed' }
    throw error
  }
  let response
  try {
    response = await fetch(`${API}/tracking/visits`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    const error = new Error('Could not reach the server. Check your mobile data and try again.')
    error.status = 0
    error.data = {}
    throw error
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    if (payload?.code === 'session_closed' || payload?.code === 'invalid_token') forget()
    const error = new Error(payload?.error ?? 'Something went wrong. Please try again.')
    error.status = response.status
    error.data = payload ?? {}
    throw error
  }
  return payload
}

/** Today's shop list and the visits recorded so far. */
export function getVisitsToday() {
  return call('GET')
}

/** Record a visit: a listed shop (`shopId`) or a typed-in outlet, the phone's location, and a face scan. */
export function recordVisit({ shopId, outlet, location, faceImage, faceDescriptor }) {
  return call('POST', shopId ? { shopId, location, faceImage, faceDescriptor } : { outlet, location, faceImage, faceDescriptor })
}
