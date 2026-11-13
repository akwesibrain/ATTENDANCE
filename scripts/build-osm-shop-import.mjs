/**
 * Builds a shop list for import from OpenStreetMap (real places in Ghana with
 * real coordinates): up to 100 shops, 100 supermarkets, 100 malls and 100
 * markets (or all with --all), each added for BOTH companies (Box For Less and
 * Double A).
 *
 *   node scripts/build-osm-shop-import.mjs                     # downloads from OpenStreetMap
 *   node scripts/build-osm-shop-import.mjs --from DIR          # uses saved shops.json / supermarkets.json / malls.json
 *   node scripts/build-osm-shop-import.mjs --geojson FILE.json # uses an Overpass Turbo GeoJSON export
 *
 * Writes (nothing is sent to the database):
 *   docs/data/osm-places.csv         for HR to review
 *   docs/data/osm-shops-import.sql   for the backend developer to run
 *
 * The public Overpass service is shared and sometimes at capacity; the script
 * waits and retries a few times, then stops. Data © OpenStreetMap
 * contributors, ODbL — keep the attribution.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const PER_TYPE = process.argv.includes('--all') ? Infinity : 100
const COMPANIES = [
  { id: 'box-for-less', prefix: 'bfl' },
  { id: 'double-a', prefix: 'daa' },
]
const TYPES = {
  malls: { label: 'Mall', filter: 'nwr["shop"="mall"]["name"](area.gh);' },
  supermarkets: { label: 'Supermarket', filter: 'nwr["shop"="supermarket"]["name"](area.gh);' },
  shops: { label: 'Shop', filter: 'nwr["shop"~"^(convenience|general|variety_store|wholesale|department_store)$"]["name"](area.gh);' },
  markets: { label: 'Market', filter: 'nwr["amenity"="marketplace"]["name"](area.gh);' },
}
const SHOP_KINDS = new Set(['convenience', 'general', 'variety_store', 'wholesale', 'department_store', 'greengrocer', 'beverages', 'seafood'])
const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function download(type) {
  const query = `[out:json][timeout:120];area["ISO3166-1"="GH"][admin_level=2]->.gh;(${TYPES[type].filter});out center tags;`
  let wait = 20000
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'attendance-app-shop-import' },
      body: new URLSearchParams({ data: query }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }))
    if (res.ok) return res.json()
    console.warn(`${type}: OpenStreetMap busy (HTTP ${res.status}), try ${attempt}/4 — waiting ${wait / 1000}s`)
    await sleep(wait)
    wait *= 2
  }
  throw new Error(`Could not download ${type}. The OpenStreetMap service is busy — try again later.`)
}

function buildPlace(osmId, label, t, lat, lon) {
  if (!osmId || !t?.name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return {
    osmId,
    type: label,
    name: String(t.name).trim(),
    town: String(t['addr:city'] ?? t['addr:town'] ?? t['addr:municipality'] ?? t['addr:village'] ?? t.is_in ?? '').trim(),
    area: String(t['addr:suburb'] ?? t['addr:community'] ?? t['addr:district'] ?? t['addr:street'] ?? '').trim(),
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ').trim(),
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lon * 1e6) / 1e6,
  }
}

function placeFromOverpass(el, type) {
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  return buildPlace(`${el.type?.[0] ?? 'n'}${el.id}`, TYPES[type].label, el.tags ?? {}, lat, lon)
}

function typeFromTags(t) {
  if (t.shop === 'mall') return 'malls'
  if (t.shop === 'supermarket') return 'supermarkets'
  if (t.amenity === 'marketplace') return 'markets'
  if (SHOP_KINDS.has(t.shop)) return 'shops'
  return null
}

function placeFromGeoJsonFeature(feature) {
  const props = feature?.properties ?? {}
  const type = typeFromTags(props)
  if (!type) return null
  const rawId = String(feature.id ?? props['@id'] ?? '')
  const [kind, num] = rawId.includes('/') ? rawId.split('/') : ['node', rawId]
  const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null
  const lon = Array.isArray(coords) ? Number(coords[0]) : NaN
  const lat = Array.isArray(coords) ? Number(coords[1]) : NaN
  return { bucket: type, place: buildPlace(num ? `${kind[0]}${num}` : '', TYPES[type].label, props, lat, lon) }
}

/** Up to PER_TYPE places, unique across public.shops (name + town + area), those with town/area first. */
function pick(candidates, globalSeen) {
  return candidates
    .filter(Boolean)
    .sort((a, b) => (
      (b.town ? 2 : 0) + (b.area ? 1 : 0) - ((a.town ? 2 : 0) + (a.area ? 1 : 0))
      || a.town.localeCompare(b.town)
      || a.name.localeCompare(b.name)
    ))
    .filter((p) => {
      const outletKey = `${p.name}|${p.town}|${p.area}`.toLowerCase()
      if (globalSeen.has(outletKey) || globalSeen.has(`id:${p.osmId}`)) return false
      globalSeen.add(outletKey)
      globalSeen.add(`id:${p.osmId}`)
      return true
    })
    .slice(0, PER_TYPE)
}

const sql = (v) => (v == null || v === '' ? "''" : `'${String(v).replace(/'/g, "''")}'`)
const csv = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

function argAfter(flag) {
  const idx = process.argv.indexOf(flag)
  return idx > 0 ? process.argv[idx + 1] : null
}

const fromDir = argAfter('--from')
const geojsonFile = argAfter('--geojson')
const globalSeen = new Set()
const places = []

if (geojsonFile) {
  const geo = JSON.parse(readFileSync(geojsonFile, 'utf8'))
  const buckets = Object.fromEntries(Object.keys(TYPES).map((k) => [k, []]))
  for (const f of geo.features ?? []) {
    const parsed = placeFromGeoJsonFeature(f)
    if (parsed?.place) buckets[parsed.bucket].push(parsed.place)
  }
  for (const type of Object.keys(TYPES)) {
    const picked = pick(buckets[type], globalSeen)
    console.log(`${TYPES[type].label}: ${picked.length} of ${buckets[type].length} named found`)
    places.push(...picked)
  }
} else {
  for (const type of Object.keys(TYPES)) {
    if (fromDir && type === 'markets') continue
    const data = fromDir ? JSON.parse(readFileSync(`${fromDir}/${type}.json`, 'utf8')) : await download(type)
    const candidates = (data.elements ?? []).map((el) => placeFromOverpass(el, type))
    const picked = pick(candidates, globalSeen)
    console.log(`${TYPES[type].label}: ${picked.length} of ${data.elements?.length ?? 0} found`)
    places.push(...picked)
    if (!fromDir) await sleep(10000)
  }
}

mkdirSync('docs/data', { recursive: true })
writeFileSync('docs/data/osm-places.csv', [
  'Type,Name,Town,Area,Address,Latitude,Longitude,OpenStreetMap ID',
  ...places.map((p) => [p.type, p.name, p.town, p.area, p.address, p.latitude, p.longitude, p.osmId].map(csv).join(',')),
].join('\n') + '\n')

const rows = places.flatMap((p) => COMPANIES.map((c) => `  (${[
  sql(`shop-${c.prefix}-osm-${p.osmId}`), sql(c.id), sql(p.name), sql(p.town), sql(p.area), sql(p.address),
  p.latitude, p.longitude, "'geocoded'", sql(`OpenStreetMap ${p.osmId} (${p.type})`), "'OpenStreetMap import'", "'OpenStreetMap import'",
].join(', ')})`))
writeFileSync('docs/data/osm-shops-import.sql', `-- ${places.length} places from OpenStreetMap (© OpenStreetMap contributors, ODbL),
-- added for both companies (${rows.length} rows). Review docs/data/osm-places.csv first.
insert into public.shops
  (shop_id, company_id, shop_name, town, area, address, latitude, longitude, location_source, location_label, source, created_by)
values
${rows.join(',\n')}
on conflict do nothing;
`)
console.log(`Wrote docs/data/osm-places.csv (${places.length} places) and docs/data/osm-shops-import.sql (${rows.length} rows).`)
