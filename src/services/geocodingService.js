/**
 * ============================================================================
 * LOCATION LOOKUP (geocoding) — finds a shop's coordinates from its name and
 * location text, for HR to confirm on a map.
 * ============================================================================
 * Provider is chosen in Settings → Merchandiser Monitoring → Location services:
 *   - 'none' (default): not configured. Nothing is looked up and no
 *     coordinates are produced. HR can still place the pin or type them.
 *   - 'nominatim': OpenStreetMap's public Nominatim service (no API key).
 *     Sends the shop name and location text to openstreetmap.org. Follow its
 *     usage policy (light, user-triggered use only; attribution shown). In
 *     production, call it (or a commercial places API) through the backend.
 *
 * Coordinates are never invented: every result comes from the provider's
 * response, and nothing is saved until HR confirms it.
 * ============================================================================
 */

import { monitoringSettings } from './settingsService'

export const LOCATION_PROVIDERS = {
  none: { label: 'Off — not configured', tiles: false },
  nominatim: {
    label: 'OpenStreetMap (Nominatim)',
    tiles: true,
    attribution: '© OpenStreetMap contributors',
    searchUrl: 'https://nominatim.openstreetmap.org/search',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
}

/** Which lookup/map provider is configured. */
export function locationServiceStatus() {
  const provider = monitoringSettings().locationProvider ?? 'none'
  const meta = LOCATION_PROVIDERS[provider] ?? LOCATION_PROVIDERS.none
  return { provider, configured: provider !== 'none', label: meta.label, tiles: meta.tiles, attribution: meta.attribution ?? null, tileUrl: meta.tileUrl ?? null }
}

/** "China Mall, Spintex Road, Accra, Ghana". */
export function buildPlaceQuery({ shopName, area, town, address }) {
  const parts = [shopName, address, area, town].map((v) => (v ?? '').trim()).filter(Boolean)
  const unique = parts.filter((v, i) => parts.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
  return unique.length ? `${unique.join(', ')}, Ghana` : ''
}

/**
 * Search for places matching a shop. Never fabricates results.
 * @returns {Promise<{ status: 'not-configured'|'invalid'|'ok'|'no-results'|'error', results: object[], message?: string, query?: string }>}
 */
export async function searchPlaces(input, { fetchImpl = globalThis.fetch } = {}) {
  const status = locationServiceStatus()
  if (!status.configured) {
    return { status: 'not-configured', results: [], message: 'Automatic location lookup is not configured.' }
  }
  if ((input.shopName ?? '').trim().length < 2 || ((input.town ?? '').trim().length < 2 && (input.area ?? '').trim().length < 2)) {
    return { status: 'invalid', results: [], message: 'Enter the shop name and its town or area first.' }
  }
  const query = buildPlaceQuery(input)
  const url = `${LOCATION_PROVIDERS.nominatim.searchUrl}?format=jsonv2&limit=6&countrycodes=gh&q=${encodeURIComponent(query)}`
  try {
    if (typeof fetchImpl !== 'function') throw new Error('No network access')
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const results = (Array.isArray(data) ? data : [])
      .map((d) => ({
        id: String(d.place_id ?? `${d.lat},${d.lon}`),
        label: d.display_name ?? 'Unnamed place',
        latitude: Number(d.lat),
        longitude: Number(d.lon),
        kind: [d.category, d.type].filter(Boolean).join(' · '),
        provider: status.label,
      }))
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    return { status: results.length ? 'ok' : 'no-results', results, query }
  } catch {
    return { status: 'error', results: [], query, message: 'The location service could not be reached. Check the connection, or set the location on the map.' }
  }
}

/**
 * Search any place in Ghana by name (e.g. "Makola Market", "Kaneshie Market",
 * "Accra Mall") to move the Live Tracker map there. Uses the configured
 * provider; never fabricates results.
 */
export async function searchMapPlace(text, { fetchImpl = globalThis.fetch } = {}) {
  const status = locationServiceStatus()
  if (!status.configured) return { status: 'not-configured', results: [], message: 'Street map and place search are switched off.' }
  const q = String(text ?? '').trim()
  if (q.length < 3) return { status: 'invalid', results: [], message: 'Type at least 3 letters.' }
  const url = `${LOCATION_PROVIDERS.nominatim.searchUrl}?format=jsonv2&limit=6&countrycodes=gh&q=${encodeURIComponent(q)}`
  try {
    if (typeof fetchImpl !== 'function') throw new Error('No network access')
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const results = (Array.isArray(data) ? data : [])
      .map((d) => ({ id: String(d.place_id ?? `${d.lat},${d.lon}`), label: d.display_name ?? 'Unnamed place', latitude: Number(d.lat), longitude: Number(d.lon), kind: [d.category, d.type].filter(Boolean).join(' · ') }))
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    return { status: results.length ? 'ok' : 'no-results', results, query: q }
  } catch {
    return { status: 'error', results: [], query: q, message: 'The map service could not be reached. Check the internet connection.' }
  }
}
