/**
 * Shop location lookup, for HR to confirm on a map. The server calls the
 * provider. Results always come from it, and nothing is saved until HR confirms.
 */

import { api } from './backend/client'
import { monitoringSettings } from './settingsService'

const PROVIDERS = {
  none: { label: 'Off — not configured', tiles: false },
  nominatim: {
    label: 'OpenStreetMap (Nominatim)',
    tiles: true,
    attribution: '© OpenStreetMap contributors',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
}

export function locationServiceStatus() {
  const provider = monitoringSettings().locationProvider ?? 'none'
  const meta = PROVIDERS[provider] ?? PROVIDERS.none
  return { provider, configured: provider !== 'none', label: meta.label, tiles: meta.tiles, attribution: meta.attribution ?? null, tileUrl: meta.tileUrl ?? null }
}

/** @returns {Promise<{ status: string, results: object[], message?: string, query?: string }>} */
export async function searchPlaces({ shopName, area, town, address }) {
  const query = new URLSearchParams({ shopName: shopName ?? '', area: area ?? '', town: town ?? '', address: address ?? '' })
  try {
    return await api(`/hr/geocode?${query}`)
  } catch {
    return { status: 'error', results: [], message: 'The location service could not be reached. Check the connection, or set the location on the map.' }
  }
}
