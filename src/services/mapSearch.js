/**
 * Place search for the Live Tracker's street map ("Makola Market",
 * "Accra Mall"…). FRONTEND-ONLY: the browser asks OpenStreetMap Nominatim
 * directly, only when HR has switched the street map on in Settings, and only
 * the typed text is sent — never employee data. (Shop lookups go through the
 * server instead — see geocodingService.searchPlaces.)
 */
import { locationServiceStatus } from './geocodingService'

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search'

/** @returns {Promise<{ status: 'ok'|'no-results'|'invalid'|'not-configured'|'error', results: object[], message?: string, query?: string }>} */
export async function searchMapPlace(text, { fetchImpl = globalThis.fetch } = {}) {
  if (!locationServiceStatus().configured) return { status: 'not-configured', results: [], message: 'Street map and place search are switched off.' }
  const q = String(text ?? '').trim()
  if (q.length < 3) return { status: 'invalid', results: [], message: 'Type at least 3 letters.' }
  const url = `${NOMINATIM_SEARCH}?format=jsonv2&limit=6&countrycodes=gh&q=${encodeURIComponent(q)}`
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
