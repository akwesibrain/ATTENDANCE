/**
 * ============================================================================
 * FIELD VISITS — Sales Representatives and Supervisors
 * ============================================================================
 * Field staff record a visit (face scan) at each shop they go to. The phone's
 * location is stored with the visit when the phone allows it, together with
 * HOW FAR it was from the shop. There is no pass/fail radius (company
 * decision, 11 Nov 2026 — "distance only, HR decides"): HR sees the distance
 * and judges.
 *
 * Location result for a visit:
 *   recorded              the phone sent its location (distance shown when
 *                         the shop has map coordinates)
 *   location-unavailable  the phone did not provide a location
 * Older records may still carry inside / outside / unverified; they are shown
 * as "Location recorded" with their distance.
 * ============================================================================
 */

import { getShop } from './shopsService'
import { distanceMeters } from '../utils/distance'

const RECORDED = { label: 'The phone’s location was recorded with the visit', short: 'Location recorded', tone: 'ok' }

export const VISIT_RESULT = {
  recorded: RECORDED,
  'location-unavailable': { label: 'Location not available from the phone', short: 'No location', tone: 'warn' },
  // Older records from before the radius was removed:
  inside: RECORDED,
  outside: RECORDED,
  unverified: RECORDED,
}

function validLocation(loc) {
  return loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180
}

/** The visit's location result and its distance from the shop (no pass/fail). */
export function verifyVisitLocation(outlet, location) {
  if (!validLocation(location)) return { status: 'location-unavailable', distance: null }
  const shop = outlet?.shopId ? getShop(outlet.shopId) : null
  return { status: 'recorded', distance: shop ? distanceMeters(location, shop) : null }
}

/** Distance from the shop for a stored visit (computed if the record lacks it). */
export function visitDistance(visit) {
  if (visit?.verification?.distance != null) return visit.verification.distance
  const shop = visit?.outlet?.shopId ? getShop(visit.outlet.shopId) : null
  return shop && visit?.location ? distanceMeters(visit.location, shop) : null
}

/** Validate the outlet chosen or typed for a visit. */
export function validateVisitOutlet(outlet) {
  if (!outlet) return 'Choose the outlet you are visiting.'
  if (outlet.shopId) return getShop(outlet.shopId) ? '' : 'That outlet is not in the Shop Directory.'
  const name = String(outlet.name ?? '').trim()
  if (name.length < 2) return 'Enter the outlet name.'
  if (String(outlet.town ?? '').trim().length < 2) return 'Enter the town or area.'
  return ''
}

/** A visit's outlet as display text. */
export function outletLabel(outlet) {
  if (!outlet) return '—'
  if (outlet.shopId) return getShop(outlet.shopId)?.shopName ?? outlet.name ?? outlet.shopId
  return [outlet.name, outlet.town].filter(Boolean).join(', ')
}
