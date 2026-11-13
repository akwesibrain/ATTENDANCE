import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildDirectoryImport,
  classify,
  extractCoordinates,
  findDuplicateCandidates,
  initialStatus,
  mergeImport,
  nameSimilarity,
  normalizeName,
  parseOsmGeoJson,
  validateCoordinates,
} from '../src/services/directory/osmImport.js'
import { assignRegion, canonicalRegionName, GHANA_REGIONS, prepareRegionBoundaries } from '../src/services/directory/regions.js'

/* Two made-up square "regions" side by side, split at longitude 0. Test data only. */
const square = (x0, x1) => ({ type: 'Polygon', coordinates: [[[x0, 5], [x1, 5], [x1, 6], [x0, 6], [x0, 5]]] })
const TEST_BOUNDARIES = prepareRegionBoundaries({
  type: 'FeatureCollection',
  features: [
    { properties: { shapeName: 'Western Region' }, geometry: square(-1, 0) },
    { properties: { shapeName: 'Greater Accra Region' }, geometry: square(0, 1) },
  ],
})

const pt = (id, lon, lat, tags = {}) => ({ type: 'Feature', id, properties: { '@id': id, ...tags }, geometry: { type: 'Point', coordinates: [lon, lat] } })
const fc = (...features) => ({ type: 'FeatureCollection', timestamp: '2026-11-12T18:09:59Z', features })
const AT = '2026-11-12T00:00:00Z'

describe('parsing and coordinates', () => {
  it('rejects input that is not a FeatureCollection', () => {
    expect(parseOsmGeoJson('{bad').ok).toBe(false)
    expect(parseOsmGeoJson({ type: 'Feature' }).ok).toBe(false)
    expect(parseOsmGeoJson(fc()).ok).toBe(true)
  })

  it('reads GeoJSON as [longitude, latitude]', () => {
    const c = extractCoordinates({ type: 'Point', coordinates: [-0.1732627, 5.622184] })
    expect(c).toMatchObject({ ok: true, latitude: 5.622184, longitude: -0.1732627, flags: [] })
  })

  it('rejects null, non-numeric and (0, 0) coordinates', () => {
    expect(validateCoordinates(null, 1).ok).toBe(false)
    expect(validateCoordinates('5.6', -0.1).ok).toBe(false)
    expect(validateCoordinates(0, 0).ok).toBe(false)
  })

  it('flags a swapped pair and points outside Ghana', () => {
    expect(validateCoordinates(-0.17, 5.62).flags).toContain('possible_swap')
    expect(validateCoordinates(51.5, -0.12).flags).toContain('outside_ghana')
    expect(validateCoordinates(5.6, -0.1).flags).toContain('low_precision')
  })
})

describe('regions', () => {
  it('knows the 16 official names', () => {
    expect(GHANA_REGIONS).toHaveLength(16)
    expect(canonicalRegionName('Bono East Region')).toBe('Bono East')
    expect(canonicalRegionName('Brong Ahafo')).toBeNull()
  })

  it('assigns by point-in-polygon only', () => {
    expect(assignRegion(0.5, 5.5, TEST_BOUNDARIES)).toMatchObject({ region: 'Greater Accra', regionConfidence: 'inside', regionSource: 'boundary_join' })
    expect(assignRegion(-0.5, 5.5, TEST_BOUNDARIES).region).toBe('Western')
  })

  it('marks points near a border and never forces points with no match', () => {
    const near = assignRegion(0.001, 5.5, TEST_BOUNDARIES) // ~110 m from the border
    expect(near).toMatchObject({ region: 'Greater Accra', regionConfidence: 'near_boundary', nearbyRegion: 'Western' })
    const sea = assignRegion(0.5, 4.8, TEST_BOUNDARIES)
    expect(sea).toMatchObject({ region: null, regionConfidence: 'no_match', flags: ['no_region_match'] })
  })

  it('leaves regions unresolved when no boundary file is loaded', () => {
    expect(assignRegion(0.5, 5.5, null)).toMatchObject({ region: null, flags: ['region_unresolved'] })
  })
})

describe('classification', () => {
  it('maps tags to the three categories', () => {
    expect(classify({ shop: 'supermarket', name: 'A' }).category).toBe('retail_shop')
    expect(classify({ shop: 'convenience', name: 'A' }).category).toBe('mini_market')
    expect(classify({ shop: 'mall', name: 'A' })).toMatchObject({ category: 'shopping_mall', flags: ['mall_candidate'] })
  })

  it('never turns a traditional market into a mini-market', () => {
    expect(classify({ amenity: 'marketplace', name: 'X Market' })).toMatchObject({ category: null, excluded: 'traditional_marketplace' })
    expect(classify({ amenity: 'marketplace', shop: 'convenience', name: 'X' }).excluded).toBe('traditional_marketplace_with_shop_tag')
  })

  it('flags name/tag conflicts and fuel-station shops', () => {
    expect(classify({ shop: 'convenience' }, 'Sunrise Supermarket').flags).toContain('category_conflict')
    expect(classify({ shop: 'convenience', brand: 'Shell' }, 'Shell Select').flags).toContain('fuel_station_shop')
  })
})

describe('duplicates', () => {
  const rec = (sourceId, name, lat, lon, category = 'mini_market', brandWikidata = null) => ({ sourceId, normalizedName: normalizeName(name), category, latitude: lat, longitude: lon, brandWikidata })

  it('flags identical coordinates, same and similar names nearby', () => {
    const pairs = findDuplicateCandidates([
      rec('node/1', 'Melcom', 5.6867, -0.1163, 'shopping_mall'),
      rec('node/2', 'Melcome', 5.6867, -0.1163, 'shopping_mall'),
      rec('node/3', 'Kofi Store', 5.5, -0.2),
      rec('node/4', 'Kofi Store', 5.5005, -0.2), // ~56 m
      rec('node/5', 'Ama Mart', 5.6, -0.3),
      rec('node/6', 'Ama Mrt', 5.6002, -0.3), // ~22 m, typo
    ])
    expect(pairs.map((p) => p.rule).sort()).toEqual(['identical_coordinates', 'same_name_nearby', 'similar_name_nearby'])
  })

  it('treats the same name far apart as separate branches', () => {
    expect(findDuplicateCandidates([rec('node/1', 'China Mall', 5.7, -0.3), rec('node/2', 'China Mall', 9.4, -0.85)])).toEqual([])
  })

  it('scores typos', () => {
    expect(nameSimilarity('melcom', 'melcome')).toBeGreaterThanOrEqual(0.8)
    expect(nameSimilarity('melcom', 'shoprite')).toBeLessThan(0.5)
  })
})

describe('staging', () => {
  const sample = fc(
    pt('node/1', 0.5, 5.5, { shop: 'supermarket', name: 'EXAMPLE Foods', branch: 'East' }),
    pt('node/2', 0.6, 5.5, { shop: 'supermarket', name: 'EXAMPLE Foods' }),
    pt('way/3', -0.5, 5.4, { shop: 'mall', name: 'EXAMPLE Plaza', '@geometry': 'center' }),
    pt('node/4', 0.2, 5.2, { shop: 'convenience' }),
    pt('node/5', 0.3, 5.3, { amenity: 'marketplace', name: 'EXAMPLE Market' }),
    pt('node/6', 0, 0, { shop: 'convenience', name: 'Null Island' }),
    pt('node/7', 0.4, 5.1, { shop: 'convenience', name: 'EXAMPLE Mart', fixme: 'survey needed' }),
  )
  const res = buildDirectoryImport(sample, { boundaries: TEST_BOUNDARIES, importedAt: AT })

  it('never verifies anything on import', () => {
    expect(res.locations.every((l) => l.verificationStatus !== 'verified')).toBe(true)
    expect(initialStatus(['centroid_coordinate'])).toBe('pending')
    expect(initialStatus(['fixme_tag'])).toBe('needs_review')
  })

  it('keeps excluded records and lists errors instead of dropping them', () => {
    expect(res.excluded.map((e) => [e.sourceId, e.excludedReason])).toEqual([['node/4', 'no_name'], ['node/5', 'traditional_marketplace']])
    expect(res.errors).toEqual([{ index: 5, sourceId: 'node/6', error: 'Coordinates are (0, 0)' }])
    expect(res.report.rowsRead).toBe(7)
  })

  it('keeps OSM provenance and branch names only from the branch tag', () => {
    const east = res.locations.find((l) => l.sourceId === 'node/1')
    expect(east).toMatchObject({ sourceKey: 'osm_overpass', branchName: 'East', branchNameSource: 'osm_tag', geofenceRadiusM: 100, region: 'Greater Accra' })
    expect(east.sourceTags).toEqual(sample.features[0].properties)
    expect(res.locations.find((l) => l.sourceId === 'node/2').branchName).toBeNull()
  })

  it('groups several branches under one business, each with its own record', () => {
    const biz = res.businesses.find((b) => b.normalizedName === 'example foods')
    expect(biz).toMatchObject({ locationCount: 2, groupingNeedsApproval: true })
    const ids = res.locations.filter((l) => l.businessKey === biz.businessKey).map((l) => l.sourceId)
    expect(ids).toEqual(['node/1', 'node/2'])
  })

  it('marks centroids, mall candidates and fixme records for review', () => {
    const plaza = res.locations.find((l) => l.sourceId === 'way/3')
    expect(plaza).toMatchObject({ coordinateType: 'centroid', category: 'shopping_mall', verificationStatus: 'needs_review', region: 'Western' })
    expect(plaza.flags).toEqual(expect.arrayContaining(['mall_candidate', 'large_footprint_review']))
    expect(res.locations.find((l) => l.sourceId === 'node/7').verificationStatus).toBe('needs_review')
  })

  it('does not bring back rejected records', () => {
    const again = buildDirectoryImport(sample, { boundaries: TEST_BOUNDARIES, importedAt: AT, rejectedSourceIds: ['node/2'] })
    expect(again.locations.map((l) => l.sourceId)).not.toContain('node/2')
    expect(again.excluded.find((e) => e.sourceId === 'node/2').excludedReason).toBe('previously_rejected')
  })

  it('re-importing the same file adds nothing', () => {
    const second = buildDirectoryImport(sample, { boundaries: TEST_BOUNDARIES, importedAt: '2026-11-13T00:00:00Z' })
    const merged = mergeImport(res.locations, second.locations)
    expect(merged.inserted).toHaveLength(0)
    expect(merged.updated).toHaveLength(0)
    expect(merged.locations).toHaveLength(res.locations.length)
  })

  it('never overwrites admin-edited fields, and a moved verified pin goes back to review', () => {
    const verified = res.locations.map((l) => (l.sourceId === 'node/1' ? { ...l, verificationStatus: 'verified', adminEditedFields: ['branchName'], branchName: 'East Legon' } : l))
    const moved = fc(pt('node/1', 0.5001, 5.5, { shop: 'supermarket', name: 'EXAMPLE Foods', branch: 'East' }))
    const merged = mergeImport(verified, buildDirectoryImport(moved, { boundaries: TEST_BOUNDARIES, importedAt: AT }).locations)
    const after = merged.locations.find((l) => l.sourceId === 'node/1')
    expect(after.branchName).toBe('East Legon')
    expect(after.longitude).toBe(0.5001)
    expect(after.verificationStatus).toBe('needs_review')
  })
})

describe('the real OpenStreetMap export', () => {
  const geo = readFileSync('data/imports/export__1_.geojson', 'utf8')
  const boundaries = prepareRegionBoundaries(JSON.parse(readFileSync('data/boundaries/geoBoundaries-GHA-ADM1.geojson', 'utf8')))
  const res = buildDirectoryImport(geo, { boundaries, importedAt: AT })

  it('reads every feature and verifies none', () => {
    expect(boundaries.problems).toEqual([])
    expect(res.report.rowsRead).toBe(2072)
    expect(res.report.imported + res.report.excluded + res.report.errors).toBe(2072)
    expect(res.report.verified).toBe(0)
  })

  it('assigns every imported location a region', () => {
    expect(res.locations.every((l) => GHANA_REGIONS.includes(l.region))).toBe(true)
  })

  it('keeps the China Mall, EU China Mall and EU Chinatown records separate', () => {
    const china = res.locations.filter((l) => l.normalizedName.includes('china'))
    expect(china.map((l) => l.name).sort()).toEqual(['China Mall', 'EU China Mall', 'EU Chinatown Shopping Center'])
    expect(new Set(china.map((l) => l.sourceId)).size).toBe(3)
  })

  it('flags the Melcom / Melcome pair (3.8 m apart) without merging it', () => {
    const pair = res.duplicatePairs.find((p) => [p.a, p.b].sort().join() === 'node/12458969551,node/12658062867')
    expect(pair).toMatchObject({ rule: 'similar_name_nearby', distanceM: 3.8 })
    expect(res.locations.filter((l) => ['node/12458969551', 'node/12658062867'].includes(l.sourceId))).toHaveLength(2)
  })
})
