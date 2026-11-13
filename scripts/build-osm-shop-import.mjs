/**
 * Builds a shop list for import from OpenStreetMap (real places in Ghana with
 * real coordinates): up to 100 shops, 100 supermarkets and 100 malls, each
 * added for BOTH companies (Box For Less and Double A).
 *
 *   node scripts/build-osm-shop-import.mjs            # downloads from OpenStreetMap
 *   node scripts/build-osm-shop-import.mjs --from DIR # uses saved shops.json / supermarkets.json / malls.json
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

const PER_TYPE = 100
const COMPANIES = [
  { id: 'box-for-less', prefix: 'bfl' },
  { id: 'double-a', prefix: 'daa' },
]
const TYPES = {
  shops: { label: 'Shop', filter: 'nwr["shop"~"^(convenience|general|variety_store|wholesale|department_store)$"]["name"](area.gh);' },
  supermarkets: { label: 'Supermarket', filter: 'nwr["shop"="supermarket"]["name"](area.gh);' },
  malls: { label: 'Mall', filter: 'nwr["shop"="mall"]["name"](area.gh);' },
}
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

function place(el, type) {
  const t = el.tags ?? {}
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (!t.name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return {
    osmId: `${el.type[0]}${el.id}`,
    type: TYPES[type].label,
    name: t.name.trim(),
    town: (t['addr:city'] ?? t['addr:town'] ?? t['addr:village'] ?? t.is_in ?? '').trim(),
    area: (t['addr:suburb'] ?? t['addr:district'] ?? t['addr:street'] ?? '').trim(),
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ').trim(),
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lon * 1e6) / 1e6,
  }
}

/** Up to PER_TYPE places, one per name+town, those with a town first. */
function pick(elements, type) {
  const seen = new Set()
  return elements
    .map((el) => place(el, type))
    .filter(Boolean)
    .sort((a, b) => (b.town ? 1 : 0) - (a.town ? 1 : 0) || a.town.localeCompare(b.town) || a.name.localeCompare(b.name))
    .filter((p) => { const k = `${p.name}|${p.town}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, PER_TYPE)
}

const sql = (v) => (v == null || v === '' ? "''" : `'${String(v).replace(/'/g, "''")}'`)
const csv = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

const fromIdx = process.argv.indexOf('--from')
const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null
const places = []
for (const type of Object.keys(TYPES)) {
  const data = fromDir ? JSON.parse(readFileSync(`${fromDir}/${type}.json`, 'utf8')) : await download(type)
  const picked = pick(data.elements ?? [], type)
  console.log(`${TYPES[type].label}: ${picked.length} of ${data.elements?.length ?? 0} found`)
  places.push(...picked)
  if (!fromDir) await sleep(10000)
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
on conflict (shop_id) do nothing;
`)
console.log(`Wrote docs/data/osm-places.csv (${places.length} places) and docs/data/osm-shops-import.sql (${rows.length} rows).`)
