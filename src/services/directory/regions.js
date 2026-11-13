/**
 * Ghana's 16 regions and region assignment by point-in-polygon.
 *
 * Pure functions, no browser or Node APIs, so the server can reuse them.
 * Boundaries are passed in (a GeoJSON FeatureCollection of Polygon /
 * MultiPolygon features); they are never bundled into the app.
 *
 * Rules (Business Directory spec §2.3):
 * - A region is assigned only when exactly one region polygon contains the point.
 * - Within NEAR_BOUNDARY_M of another region's border → confidence "near_boundary".
 * - No polygon contains the point → no region, flag "no_region_match".
 * - Never inferred from a name.
 */

export const GHANA_REGIONS = Object.freeze([
  'Greater Accra', 'Ashanti', 'Western', 'Western North', 'Central', 'Eastern',
  'Volta', 'Oti', 'Northern', 'Savannah', 'North East', 'Upper East',
  'Upper West', 'Bono', 'Bono East', 'Ahafo',
])

export const NEAR_BOUNDARY_M = 200

/** "Greater Accra Region" → "Greater Accra"; returns null for unknown names. */
export function canonicalRegionName(raw) {
  const cleaned = String(raw ?? '').replace(/\s+region$/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return GHANA_REGIONS.find((r) => r.toLowerCase() === cleaned) ?? null
}

/** Ring list per polygon: [[ring, ring...], ...] (first ring outer, rest holes). */
function polygonsOf(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function bboxOf(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const rings of polygons) for (const [x, y] of rings[0] ?? []) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Prepare a boundary FeatureCollection for repeated lookups.
 * @param {object} featureCollection GeoJSON with one feature per region
 * @param {{ nameProperty?: string, source?: string }} [options]
 * @returns {{ regions: object[], source: string, problems: string[] }}
 */
export function prepareRegionBoundaries(featureCollection, { nameProperty = 'shapeName', source = 'boundary_join' } = {}) {
  const problems = []
  const regions = []
  for (const f of featureCollection?.features ?? []) {
    const raw = f?.properties?.[nameProperty]
    const name = canonicalRegionName(raw)
    if (!name) { problems.push(`Unknown region name in boundary file: "${raw}"`); continue }
    const polygons = polygonsOf(f.geometry)
    if (!polygons.length) { problems.push(`Region "${name}" has no polygon geometry`); continue }
    regions.push({ name, polygons, bbox: bboxOf(polygons) })
  }
  const found = new Set(regions.map((r) => r.name))
  for (const r of GHANA_REGIONS) if (!found.has(r)) problems.push(`Region "${r}" is missing from the boundary file`)
  return { regions, source, problems }
}

/** Even-odd ray casting over all rings (holes handled). */
export function pointInPolygon(lon, lat, rings) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j]
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** Metres from a point to the nearest edge of a region (equirectangular, fine at < 1 km). */
function distanceToEdgesM(lon, lat, polygons, limitM) {
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180)
  const padLat = limitM / mPerDegLat; const padLon = limitM / mPerDegLon
  let best = Infinity
  for (const rings of polygons) for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1]; const [x2, y2] = ring[i]
      if (Math.min(x1, x2) > lon + padLon || Math.max(x1, x2) < lon - padLon) continue
      if (Math.min(y1, y2) > lat + padLat || Math.max(y1, y2) < lat - padLat) continue
      const ax = (x1 - lon) * mPerDegLon; const ay = (y1 - lat) * mPerDegLat
      const bx = (x2 - lon) * mPerDegLon; const by = (y2 - lat) * mPerDegLat
      const dx = bx - ax; const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
      const d = Math.hypot(ax + t * dx, ay + t * dy)
      if (d < best) best = d
    }
  }
  return best
}

const inBox = (b, lon, lat, pad = 0) => lon >= b.minX - pad && lon <= b.maxX + pad && lat >= b.minY - pad && lat <= b.maxY + pad

/**
 * @returns {{ region: string|null, regionSource: string|null, regionConfidence: 'inside'|'near_boundary'|'no_match'|'multiple_match', flags: string[], nearbyRegion?: string }}
 */
export function assignRegion(lon, lat, prepared, { nearBoundaryM = NEAR_BOUNDARY_M } = {}) {
  const regions = prepared?.regions ?? []
  if (!regions.length) return { region: null, regionSource: null, regionConfidence: 'no_match', flags: ['region_unresolved'] }
  const matches = regions.filter((r) => inBox(r.bbox, lon, lat) && r.polygons.some((rings) => pointInPolygon(lon, lat, rings)))
  if (matches.length > 1) return { region: null, regionSource: null, regionConfidence: 'multiple_match', flags: ['region_ambiguous'] }
  if (!matches.length) return { region: null, regionSource: null, regionConfidence: 'no_match', flags: ['no_region_match'] }
  const home = matches[0]
  const padDeg = (nearBoundaryM / 111320) * 1.5
  for (const other of regions) {
    if (other === home || !inBox(other.bbox, lon, lat, padDeg)) continue
    if (distanceToEdgesM(lon, lat, other.polygons, nearBoundaryM) <= nearBoundaryM) {
      return { region: home.name, regionSource: prepared.source, regionConfidence: 'near_boundary', flags: ['near_boundary'], nearbyRegion: other.name }
    }
  }
  return { region: home.name, regionSource: prepared.source, regionConfidence: 'inside', flags: [] }
}
