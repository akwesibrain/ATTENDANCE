/**
 * Distances between a phone and a shop. There is no pass/fail radius
 * (company decision, 11 Nov 2026 — "distance only, HR decides"): HR sees how
 * far someone was and judges. GPS_TOLERANCE_M is only an allowance for GPS
 * error when working out whether someone stayed at a shop.
 */

/** Allowance for GPS error when deciding someone stayed "at" a shop. */
export const GPS_TOLERANCE_M = 100

function valid(p) {
  return p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)) && p.latitude !== null && p.longitude !== null
}

/** Great-circle distance in metres, or null if either point is missing. */
export function distanceMeters(a, b) {
  if (!valid(a) || !valid(b)) return null
  const R = 6371000
  const rad = (d) => (Number(d) * Math.PI) / 180
  const dLat = rad(b.latitude) - rad(a.latitude)
  const dLng = rad(b.longitude) - rad(a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/** "40 m", "850 m", "2.3 km", "18 km". */
export function formatDistance(m) {
  if (m == null || !Number.isFinite(m)) return '—'
  if (m < 1000) return `${Math.round(m / 10) * 10 || Math.round(m)} m`
  const km = m / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

/** The closest shop (with coordinates) to a point: { shop, distance } or null. */
export function nearestShop(point, shops) {
  let best = null
  shops.forEach((shop) => {
    const d = distanceMeters(point, shop)
    if (d != null && (!best || d < best.distance)) best = { shop, distance: d }
  })
  return best
}
