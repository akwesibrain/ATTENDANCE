/**
 * Shop directory. A shop is the outlet a field employee works in. Employee
 * records reference a shop by ID only.
 *
 * Coordinates are never invented: only HR can set them, from a lookup they
 * confirmed, a map pin or their own entry.
 */

import {
  formatShopCoordinates,
  shopDisplayName,
  shopFromRow,
  shopLocationText,
} from '../../supabase/functions/_shared/rules/facts.js'
import { validateCoordinates, validateNewShop } from '../../supabase/functions/_shared/rules/registration.js'
import { api, submit } from './backend/client'
import { refresh, rows } from './backend/cache'

export { formatShopCoordinates, shopDisplayName, shopLocationText, validateCoordinates, validateNewShop }

export const GEOFENCE_RADIUS_M = 150

export const LOCATION_SOURCES = {
  geocoded: 'found by location lookup and confirmed by HR',
  'map-adjusted': 'placed on the map by HR',
  manual: 'entered by HR',
}

const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ')
const key = (value) => clean(value).toLowerCase()

/** Shops the registration form may offer. It has no sign-in, so it fetches its own. */
const publicShops = new Map()

export async function loadPublicShops(companyId) {
  const { shops } = await api(`/public/shops?companyId=${encodeURIComponent(companyId)}`)
  shops.forEach((shop) => {
    publicShops.set(shop.shopId, shopFromRow({
      shop_id: shop.shopId,
      company_id: shop.companyId,
      shop_name: shop.shopName,
      town: shop.town,
      area: shop.area,
      address: shop.address,
      latitude: null,
      longitude: null,
      status: 'active',
    }))
  })
}

function allShops() {
  const loaded = rows('shops').map(shopFromRow)
  return loaded.length ? loaded : [...publicShops.values()]
}

export function searchShops(companyId, query) {
  const term = key(query)
  const shops = listShops(companyId)
  if (!term) return shops
  return shops.filter((s) => [s.baseName, s.town, s.area, s.address].some((value) => key(value).includes(term)))
}

export function findDuplicateShop(companyId, shopName, town, area = '') {
  return allShops().find((s) => s.companyId === companyId && key(s.baseName) === key(shopName) && key(s.town) === key(town) && key(s.area) === key(area)) ?? null
}

/** @returns {Promise<{ ok: true } | { errors: object }>} */
export async function setShopLocation(shopId, { latitude, longitude, locationSource, locationLabel }) {
  const result = await submit(`/hr/shops/${encodeURIComponent(shopId)}/location`, {
    method: 'PATCH',
    body: { latitude, longitude, locationSource, locationLabel },
  })
  if (result.errors) return result
  await refresh('shops', 'audit_events')
  return result
}

export function getShop(shopId) {
  return allShops().find((s) => s.shopId === shopId) ?? null
}

export function listShops(companyId, { activeOnly = true } = {}) {
  return allShops().filter((s) => s.companyId === companyId && (!activeOnly || s.status === 'active'))
}

export function listAllShops() {
  return allShops()
}
