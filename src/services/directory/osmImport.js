/**
 * Business Directory: OpenStreetMap import pipeline (pure functions).
 *
 * parse → validate coordinates → classify → assign region → detect duplicates
 * → stage (businesses + locations + excluded) → report.
 *
 * Nothing here invents data: missing names, branches, towns and regions stay
 * null and flagged. Nothing is ever set to "verified". Excluded records are
 * kept (with a reason), never dropped. See docs/business-directory.md.
 */
import { assignRegion, GHANA_REGIONS } from './regions.js'

export const CATEGORIES = Object.freeze(['shopping_mall', 'retail_shop', 'mini_market'])
export const STATUSES = Object.freeze(['pending', 'needs_review', 'verified', 'rejected'])
export const DEFAULT_GEOFENCE_M = 100
export const SOURCE_OSM = 'osm_overpass'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0'

/** Padded Ghana bounding box (spec §5.2). */
export const GHANA_BBOX = Object.freeze({ minLat: 4.5, maxLat: 11.5, minLon: -3.5, maxLon: 1.5 })

export const DUPLICATE_RULES = Object.freeze({
  sameNameM: 150,
  similarNameM: 50,
  similarNameScore: 0.8,
  sameBrandM: 100,
  sameCategoryM: 25,
})

/** Flags that only inform; every other flag sends the record to needs_review. */
const INFO_FLAGS = new Set(['centroid_coordinate', 'low_precision', 'no_branch_tag'])

/** Names too generic to identify one business. Compared after normalisation. */
const GENERIC_NAMES = new Set([
  'store', 'shop', 'shops', 'select', 'total', 'supermarket', 'super market', 'mini mart', 'minimart',
  'mini market', 'mall', 'shopping mall', 'shopping centre', 'shopping center', 'market', 'provision store',
  'provisions', 'convenience store', 'grocery', 'groceries', 'cold store', 'kiosk',
])
const FUEL_BRANDS = /\b(shell|total|totalenergies|goil|star ?oil|puma|allied|frimps|zen|engen|bonjour)\b/i

/* ------------------------------------------------------------------ Names */

/** Lowercase, strip accents and punctuation, "&" → "and", collapse spaces. For comparison only. */
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 0..1 similarity (1 - Levenshtein / longer length). */
export function nameSimilarity(a, b) {
  if (a === b) return 1
  if (!a || !b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = keep
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

/* ------------------------------------------------------------------ Coordinates */

const decimals = (n) => (String(n).split('.')[1] ?? '').replace(/e.*$/i, '').length
const inGhanaBox = (lat, lon) => lat >= GHANA_BBOX.minLat && lat <= GHANA_BBOX.maxLat && lon >= GHANA_BBOX.minLon && lon <= GHANA_BBOX.maxLon

/**
 * GeoJSON order is [longitude, latitude].
 * @returns {{ ok: boolean, latitude?: number, longitude?: number, error?: string, flags: string[] }}
 */
export function extractCoordinates(geometry) {
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
    return { ok: false, error: `Unsupported geometry: ${geometry?.type ?? 'missing'}`, flags: [] }
  }
  const [longitude, latitude] = geometry.coordinates
  return validateCoordinates(latitude, longitude)
}

export function validateCoordinates(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'Coordinates are not numbers', flags: [] }
  }
  if (latitude === 0 && longitude === 0) return { ok: false, error: 'Coordinates are (0, 0)', flags: [] }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { ok: false, error: 'Coordinates out of range', flags: [] }
  const flags = []
  if (!inGhanaBox(latitude, longitude)) flags.push(inGhanaBox(longitude, latitude) ? 'possible_swap' : 'outside_ghana')
  if (Math.min(decimals(latitude), decimals(longitude)) < 4) flags.push('low_precision')
  return { ok: true, latitude, longitude, flags }
}

/** Metres between two points (haversine). */
export function distanceM(a, b) {
  const r = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * r
  const dLon = (b.longitude - a.longitude) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(h))
}

/* ------------------------------------------------------------------ Classification */

/**
 * One record → one category, or an exclusion reason. Tags first, then name checks.
 * @returns {{ category: string|null, reason: string, excluded: string|null, flags: string[] }}
 */
export function classify(tags, name = tags?.name ?? '') {
  const t = tags ?? {}
  const flags = []
  if (t.amenity === 'marketplace') {
    // Traditional markets are never mini-markets. A market that also carries a shop tag is kept apart for review.
    return { category: null, reason: `osm amenity=marketplace (traditional market)${t.shop ? `, also shop=${t.shop}` : ''}`, excluded: t.shop ? 'traditional_marketplace_with_shop_tag' : 'traditional_marketplace', flags }
  }
  const n = normalizeName(name)
  let category = null; let reason = ''
  if (t.shop === 'mall') {
    category = 'shopping_mall'; reason = 'osm shop=mall (candidate, needs review)'; flags.push('mall_candidate')
  } else if (t.shop === 'supermarket' || t.shop === 'department_store' || ['clothes', 'electronics', 'furniture', 'chemist', 'hardware', 'shoes', 'mobile_phone'].includes(t.shop) || t.amenity === 'pharmacy') {
    category = 'retail_shop'; reason = t.amenity === 'pharmacy' ? 'osm amenity=pharmacy' : `osm shop=${t.shop}`
  } else if (t.shop === 'convenience' || (t.shop === 'general' && n)) {
    category = 'mini_market'; reason = `osm shop=${t.shop}`
  } else {
    const what = t.shop ? `shop=${t.shop}` : t.amenity ? `amenity=${t.amenity}` : 'no shop tag'
    return { category: null, reason: `osm ${what} is not one of the three categories`, excluded: 'other_category', flags }
  }
  if (category === 'mini_market' && /\bsuper ?market\b/.test(n)) { flags.push('category_conflict'); reason += '; name suggests retail_shop' }
  if (category === 'retail_shop' && /\b(mini ?mart|mini market|convenience)\b/.test(n)) { flags.push('category_conflict'); reason += '; name suggests mini_market' }
  if (category === 'mini_market' && (t.fuel || t['fuel:diesel'] || FUEL_BRANDS.test(`${name} ${t.brand ?? ''} ${t.operator ?? ''}`))) flags.push('fuel_station_shop')
  return { category, reason, excluded: null, flags }
}

function tagFlags(tags) {
  const flags = []
  const keys = Object.keys(tags ?? {})
  if (keys.some((k) => /^fixme$/i.test(k))) flags.push('fixme_tag')
  if (keys.some((k) => /^(disused|abandoned|was)[:_]/i.test(k) || k === 'disused' || k === 'abandoned')) flags.push('disused_or_abandoned')
  if (keys.includes('note') && /survey|check|move|exact|wrong|closed/i.test(String(tags.note))) flags.push('source_note_review')
  return flags
}

/* ------------------------------------------------------------------ Parsing */

/**
 * @returns {{ ok: boolean, error?: string, meta: object, features: object[] }}
 */
export function parseOsmGeoJson(input) {
  let doc = input
  if (typeof input === 'string') {
    try { doc = JSON.parse(input) } catch (e) { return { ok: false, error: `Not valid JSON: ${e.message}`, meta: {}, features: [] } }
  }
  if (!doc || doc.type !== 'FeatureCollection' || !Array.isArray(doc.features)) {
    return { ok: false, error: 'Expected a GeoJSON FeatureCollection', meta: {}, features: [] }
  }
  return {
    ok: true,
    meta: { generator: doc.generator ?? null, snapshotTimestamp: doc.timestamp ?? null, copyright: doc.copyright ?? null },
    features: doc.features,
  }
}

/** "node/123" from the feature, or null. */
export function osmSourceId(feature) {
  const id = feature?.properties?.['@id'] ?? feature?.id
  return typeof id === 'string' && /^(node|way|relation)\/\d+$/.test(id) ? id : null
}

/* ------------------------------------------------------------------ Duplicates */

/**
 * Pairwise duplicate candidates (spec §7). Never merges; returns pairs.
 * @param {Array<{ sourceId: string, normalizedName: string, category: string|null, latitude: number, longitude: number, brandWikidata?: string|null }>} records
 */
export function findDuplicateCandidates(records, rules = DUPLICATE_RULES) {
  const maxM = Math.max(rules.sameNameM, rules.similarNameM, rules.sameBrandM, rules.sameCategoryM)
  const padLat = maxM / 111320
  const sorted = [...records].sort((a, b) => a.latitude - b.latitude)
  const pairs = []
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    for (let j = i + 1; j < sorted.length && sorted[j].latitude - a.latitude <= padLat; j++) {
      const b = sorted[j]
      const d = distanceM(a, b)
      if (d > maxM) continue
      let rule = null
      if (a.latitude.toFixed(6) === b.latitude.toFixed(6) && a.longitude.toFixed(6) === b.longitude.toFixed(6)) rule = 'identical_coordinates'
      else if (a.normalizedName && a.normalizedName === b.normalizedName && d <= rules.sameNameM) rule = 'same_name_nearby'
      else if (a.normalizedName && b.normalizedName && d <= rules.similarNameM && nameSimilarity(a.normalizedName, b.normalizedName) >= rules.similarNameScore) rule = 'similar_name_nearby'
      else if (a.brandWikidata && a.brandWikidata === b.brandWikidata && d <= rules.sameBrandM) rule = 'same_brand_nearby'
      else if (a.category && a.category === b.category && d <= rules.sameCategoryM) rule = 'same_category_very_close'
      if (rule) pairs.push({ a: a.sourceId, b: b.sourceId, rule, distanceM: Math.round(d * 10) / 10 })
    }
  }
  return pairs
}

/* ------------------------------------------------------------------ Staging */

const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function addressOf(t) {
  const parts = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:suburb'], t['addr:city']].map(nonEmpty).filter(Boolean)
  return t['addr:full'] ? nonEmpty(t['addr:full']) : parts.length ? parts.join(', ') : null
}

/**
 * Build the staged import from a parsed OSM FeatureCollection.
 * @param {object} geojson FeatureCollection (object or JSON string)
 * @param {{ boundaries?: object, importedAt?: string, sourceKey?: string, rejectedSourceIds?: Iterable<string> }} options
 *   boundaries = prepareRegionBoundaries(...) result; rejectedSourceIds = blocklist from earlier rejections.
 */
export function buildDirectoryImport(geojson, { boundaries = null, importedAt = new Date().toISOString(), sourceKey = SOURCE_OSM, rejectedSourceIds = [] } = {}) {
  const parsed = parseOsmGeoJson(geojson)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const blocked = new Set(rejectedSourceIds)
  const errors = []
  const excluded = []
  const staged = []
  const seen = new Set()

  for (const [index, feature] of parsed.features.entries()) {
    const sourceId = osmSourceId(feature)
    if (!sourceId) { errors.push({ index, sourceId: null, error: 'Missing or invalid OSM id' }); continue }
    if (seen.has(sourceId)) { errors.push({ index, sourceId, error: 'Same OSM id appears twice in the file' }); continue }
    seen.add(sourceId)
    const tags = feature.properties ?? {}
    const coord = extractCoordinates(feature.geometry)
    if (!coord.ok) { errors.push({ index, sourceId, error: coord.error }); continue }
    const name = nonEmpty(tags.name)
    const cls = classify(tags, name ?? '')
    const flags = [...coord.flags, ...cls.flags, ...tagFlags(tags)]
    if (tags['@geometry'] === 'center' || !sourceId.startsWith('node/')) flags.push('centroid_coordinate')
    if (!name) flags.push('no_name')
    else if (GENERIC_NAMES.has(normalizeName(name))) flags.push('name_generic')
    if (cls.category === 'shopping_mall' && flags.includes('centroid_coordinate')) flags.push('large_footprint_review')

    const region = assignRegion(coord.longitude, coord.latitude, boundaries)
    flags.push(...region.flags)

    const record = {
      sourceKey, sourceId, name, normalizedName: normalizeName(name),
      category: cls.category, classificationReason: cls.reason,
      branchName: nonEmpty(tags.branch), branchNameSource: nonEmpty(tags.branch) ? 'osm_tag' : 'none',
      region: region.region, regionSource: region.regionSource, regionConfidence: region.regionConfidence, nearbyRegion: region.nearbyRegion ?? null,
      city: nonEmpty(tags['addr:city']), town: nonEmpty(tags['addr:suburb']) ?? nonEmpty(tags['addr:community']) ?? nonEmpty(tags['addr:place']),
      townSource: nonEmpty(tags['addr:suburb']) || nonEmpty(tags['addr:community']) || nonEmpty(tags['addr:place']) ? 'osm_tag' : null,
      addressFull: addressOf(tags),
      latitude: coord.latitude, longitude: coord.longitude,
      coordinateType: flags.includes('centroid_coordinate') ? 'centroid' : 'node', coordinateSource: 'osm',
      brandWikidata: nonEmpty(tags['brand:wikidata']) ?? null, wikidata: nonEmpty(tags.wikidata) ?? null,
      sourceTags: tags, flags,
    }

    if (blocked.has(sourceId)) { excluded.push({ ...record, excludedReason: 'previously_rejected' }); continue }
    if (cls.excluded) { excluded.push({ ...record, excludedReason: cls.excluded }); continue }
    if (!name) { excluded.push({ ...record, excludedReason: 'no_name' }); continue }
    staged.push(record)
  }

  // Duplicates among the records that will be imported.
  const duplicatePairs = findDuplicateCandidates(staged)
  const dupIds = new Map()
  for (const p of duplicatePairs) for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
    if (!dupIds.has(x)) dupIds.set(x, [])
    dupIds.get(x).push({ sourceId: y, rule: p.rule, distanceM: p.distanceM })
  }
  const coordKey = (r) => `${r.latitude.toFixed(6)},${r.longitude.toFixed(6)}`
  const byCoord = new Map()
  for (const r of staged) byCoord.set(coordKey(r), [...(byCoord.get(coordKey(r)) ?? []), r])

  // Business grouping: a suggestion by brand wikidata, else by normalized name.
  const businesses = new Map()
  const locations = staged.map((r) => {
    const flags = [...r.flags]
    if (dupIds.has(r.sourceId)) flags.push('possible_duplicate')
    if ((byCoord.get(coordKey(r)) ?? []).some((o) => o !== r && o.normalizedName !== r.normalizedName)) flags.push('shared_coordinate')
    const businessKey = r.brandWikidata ? `wikidata:${r.brandWikidata}` : `name:${r.normalizedName}`
    if (!businesses.has(businessKey)) {
      businesses.set(businessKey, { businessKey, name: r.name, normalizedName: r.normalizedName, defaultCategory: r.category, brandWikidata: r.brandWikidata, grouping: r.brandWikidata ? 'brand_wikidata' : 'normalized_name', locationCount: 0, createdAt: importedAt })
    }
    businesses.get(businessKey).locationCount++
    const unique = [...new Set(flags)]
    return {
      ...r, businessKey, flags: unique,
      duplicateOf: dupIds.get(r.sourceId) ?? [],
      geofenceRadiusM: DEFAULT_GEOFENCE_M,
      verificationStatus: initialStatus(unique),
      verifiedBy: null, verifiedAt: null, isActive: true, mergedIntoLocationId: null,
      dateAdded: importedAt, lastUpdated: importedAt,
    }
  })
  for (const b of businesses.values()) if (b.locationCount > 1) b.groupingNeedsApproval = true

  const result = {
    ok: true,
    dataset: {
      name: 'ghana-business-directory', schemaVersion: '1.0.0', generatedAt: importedAt,
      sources: [{ sourceKey, attribution: OSM_ATTRIBUTION, snapshotTimestamp: parsed.meta.snapshotTimestamp, generator: parsed.meta.generator }],
      regionBoundarySource: boundaries ? boundaries.sourceLabel ?? boundaries.source : null,
    },
    businesses: [...businesses.values()],
    locations,
    excluded,
    errors,
    duplicatePairs,
    rowsRead: parsed.features.length,
  }
  result.report = buildImportReport(result)
  return result
}

/** Imports never produce "verified". Any non-informational flag → needs_review. */
export function initialStatus(flags) {
  return flags.some((f) => !INFO_FLAGS.has(f)) ? 'needs_review' : 'pending'
}

/* ------------------------------------------------------------------ Re-import (idempotent) */

/**
 * Merge a new staged import into existing locations by (sourceKey, sourceId).
 * - New source ids are inserted.
 * - Existing ones are updated only in fields the admin has not edited
 *   (existing.adminEditedFields), and never change verification status.
 * - Rejected records stay rejected.
 * @returns {{ inserted: object[], updated: object[], unchanged: object[], locations: object[] }}
 */
export function mergeImport(existingLocations, incomingLocations) {
  const key = (l) => `${l.sourceKey}|${l.sourceId}`
  const byKey = new Map(existingLocations.map((l) => [key(l), l]))
  const SYNCED = ['name', 'normalizedName', 'branchName', 'city', 'town', 'addressFull', 'latitude', 'longitude', 'coordinateType', 'sourceTags', 'brandWikidata', 'wikidata']
  const inserted = []; const updated = []; const unchanged = []
  const out = new Map(byKey)
  for (const inc of incomingLocations) {
    const cur = byKey.get(key(inc))
    if (!cur) { out.set(key(inc), inc); inserted.push(inc); continue }
    const locked = new Set(cur.adminEditedFields ?? [])
    const next = { ...cur }
    const changed = []
    for (const f of SYNCED) {
      if (locked.has(f)) continue
      if (JSON.stringify(cur[f]) !== JSON.stringify(inc[f])) { next[f] = inc[f]; changed.push(f) }
    }
    if (!changed.length) { unchanged.push(cur); continue }
    next.lastUpdated = inc.lastUpdated
    // Moving a verified pin or renaming it sends it back for review (spec §12 rule 2).
    if (cur.verificationStatus === 'verified' && changed.some((f) => ['latitude', 'longitude', 'name', 'branchName'].includes(f))) {
      next.verificationStatus = 'needs_review'
      next.flags = [...new Set([...(cur.flags ?? []), 'source_changed_after_verification'])]
    }
    out.set(key(inc), next); updated.push({ before: cur, after: next, changed })
  }
  return { inserted, updated, unchanged, locations: [...out.values()] }
}

/* ------------------------------------------------------------------ Report */

const countBy = (items, fn) => items.reduce((acc, x) => { for (const k of [].concat(fn(x))) if (k != null) acc[k] = (acc[k] ?? 0) + 1; return acc }, {})

export const CATEGORY_TARGET = 100

export function buildImportReport({ rowsRead, locations, excluded, errors, duplicatePairs, businesses }) {
  const perCategory = Object.fromEntries(CATEGORIES.map((c) => [c, locations.filter((l) => l.category === c).length]))
  const perRegion = Object.fromEntries([...GHANA_REGIONS, null].map((r) => [r ?? 'Unassigned', locations.filter((l) => l.region === r).length]))
  const perRegionCategory = Object.fromEntries(GHANA_REGIONS.map((r) => [r, Object.fromEntries(CATEGORIES.map((c) => [c, locations.filter((l) => l.region === r && l.category === c).length]))]))
  return {
    rowsRead,
    imported: locations.length,
    businesses: businesses.length,
    errors: errors.length,
    excluded: excluded.length,
    excludedByReason: countBy(excluded, (x) => x.excludedReason),
    byStatus: countBy(locations, (l) => l.verificationStatus),
    verified: locations.filter((l) => l.verificationStatus === 'verified').length,
    perCategory,
    perCategoryStatus: Object.fromEntries(CATEGORIES.map((c) => [c, countBy(locations.filter((l) => l.category === c), (l) => l.verificationStatus)])),
    shortfall: Object.fromEntries(CATEGORIES.map((c) => [c, Math.max(0, CATEGORY_TARGET - perCategory[c])])),
    perRegion,
    perRegionCategory,
    regionsWithNoRecords: GHANA_REGIONS.filter((r) => !perRegion[r]),
    regionConfidence: countBy(locations, (l) => l.regionConfidence),
    flags: countBy(locations, (l) => l.flags),
    duplicatePairsByRule: countBy(duplicatePairs, (p) => p.rule),
    duplicatePairs: duplicatePairs.length,
    missingFields: {
      branchName: locations.filter((l) => !l.branchName).length,
      city: locations.filter((l) => !l.city).length,
      town: locations.filter((l) => !l.town).length,
      addressFull: locations.filter((l) => !l.addressFull).length,
      region: locations.filter((l) => !l.region).length,
    },
  }
}
