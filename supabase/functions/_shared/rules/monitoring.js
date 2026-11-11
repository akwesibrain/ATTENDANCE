/**
 * SMS verification rules for field staff, shared by the browser and the server.
 *
 * Exactly three checks per working day, at times that differ per employee per
 * day. A future check time exists only in the server's schedule table.
 */

import { VERIFICATIONS_PER_SHIFT } from './records.js'

const EARTH_RADIUS_M = 6371000
const toRadians = (degrees) => (degrees * Math.PI) / 180

/** Straight-line distance between two coordinates, in whole metres. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)))
}

const isCoordinate = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

/**
 * Check a device position against a shop's geofence.
 * @returns {{ status: 'passed'|'failed'|'unavailable', distance: number|null }}
 */
export function checkGeofence(position, shop) {
  if (
    !isCoordinate(position?.latitude, 90) ||
    !isCoordinate(position?.longitude, 180) ||
    shop?.latitude == null ||
    shop?.longitude == null
  ) {
    return { status: 'unavailable', distance: null }
  }
  const distance = distanceMeters(position.latitude, position.longitude, shop.latitude, shop.longitude)
  return { status: distance <= shop.geofenceRadius ? 'passed' : 'failed', distance }
}

/** A failed face check outranks any location result. */
export function verificationResult(facePassed, gpsStatus) {
  if (!facePassed) return 'failed-face'
  if (gpsStatus === 'unavailable') return 'gps-unavailable'
  if (gpsStatus === 'failed') return 'outside-shop'
  return 'verified'
}

/**
 * Three dispatch times inside the working window, one in each third of it.
 * @param {function} random returns a number from 0 up to 1
 * @returns {number[]} minutes after Accra midnight, ascending
 */
export function scheduleCheckMinutes(startMinutes, endMinutes, random = Math.random) {
  const segment = (endMinutes - startMinutes) / VERIFICATIONS_PER_SHIFT
  const margin = Math.min(10, Math.floor(segment / 4))
  return Array.from({ length: VERIFICATIONS_PER_SHIFT }, (_, index) => {
    const offset = margin + Math.floor(random() * (segment - 2 * margin))
    return Math.floor(startMinutes + index * segment + offset)
  })
}

/** The shape every screen and rule uses for one dispatched check. */
export function smsEventFromRow(row) {
  return {
    eventId: row.event_id,
    employeeId: row.employee_id,
    verificationNumber: row.verification_number,
    dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at).toISOString() : null,
    deliveryStatus: row.delivery_status,
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null,
    faceVerificationStatus: row.face_verification_status,
    livenessStatus: row.liveness_status,
    gpsVerificationStatus: row.gps_verification_status,
    distanceFromShop: row.distance_from_shop,
    gpsAccuracy: row.gps_accuracy,
    result: row.result,
  }
}
