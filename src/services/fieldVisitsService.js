/**
 * ============================================================================
 * MOCK FIELD VISITS SERVICE — NOT A PRODUCTION BACKEND
 * ============================================================================
 * Sales Representatives (mini-markets) and Supervisors (larger outlets such as
 * China Mall and Melcom) move between several outlets during the day. They
 * are not tied to one allocated shop. Each outlet visit is recorded from the
 * attendance app with a face scan and, when the phone allows it, the device's
 * real GPS position. Nothing is ever generated: if the location could not be
 * read, the visit says so.
 *
 * Location result for a visit:
 *   inside               within the outlet's geofence (Shop Directory outlet with coordinates)
 *   outside              further than the geofence from the outlet
 *   unverified           location recorded, but the outlet has no saved coordinates
 *                        (e.g. a mini-market typed in by the Sales Rep)
 *   location-unavailable the phone did not provide a location (denied/unavailable)
 * ============================================================================
 */

import { mockGetShop, GEOFENCE_RADIUS_M } from './shopsService'

export const VISIT_RESULT = {
  inside: { label: 'Inside outlet geofence', short: 'Inside geofence', tone: 'ok' },
  outside: { label: 'Outside outlet geofence', short: 'Outside geofence', tone: 'crit' },
  unverified: { label: 'Location recorded — outlet has no saved coordinates', short: 'Location recorded', tone: 'pending' },
  'location-unavailable': { label: 'Location not available from the phone', short: 'No location', tone: 'warn' },
}

/** Great-circle distance in metres. */
export function distanceMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

function validLocation(loc) {
  return loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180
}

/**
 * Check a visit's recorded location against the outlet.
 * @param {{ shopId?: string|null }} outlet
 * @param {{ latitude, longitude, accuracy? }|null} location from the device
 */
export function verifyVisitLocation(outlet, location) {
  if (!validLocation(location)) return { status: 'location-unavailable', distance: null, radius: null }
  const shop = outlet?.shopId ? mockGetShop(outlet.shopId) : null
  if (!shop || shop.latitude == null || shop.longitude == null) return { status: 'unverified', distance: null, radius: null }
  const radius = shop.geofenceRadius ?? GEOFENCE_RADIUS_M
  const distance = distanceMeters(location, shop)
  return { status: distance <= radius ? 'inside' : 'outside', distance, radius }
}

/** Validate the outlet chosen or typed for a visit. */
export function validateVisitOutlet(outlet) {
  if (!outlet) return 'Choose the outlet you are visiting.'
  if (outlet.shopId) return mockGetShop(outlet.shopId) ? '' : 'That outlet is not in the Shop Directory.'
  const name = String(outlet.name ?? '').trim()
  if (name.length < 2) return 'Enter the outlet name.'
  if (String(outlet.town ?? '').trim().length < 2) return 'Enter the town or area.'
  return ''
}

/** A visit's outlet as display text. */
export function outletLabel(outlet) {
  if (!outlet) return '—'
  if (outlet.shopId) return mockGetShop(outlet.shopId)?.shopName ?? outlet.name ?? outlet.shopId
  return [outlet.name, outlet.town].filter(Boolean).join(', ')
}
