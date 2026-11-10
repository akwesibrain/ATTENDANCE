/**
 * ============================================================================
 * MOCK SHOPS SERVICE — Shop Directory (single source of truth for shops)
 * ============================================================================
 * A "shop" is the actual outlet a Sales Representative or Merchandiser works
 * in (e.g. China Mall, Ashaiman), never a company branch, town or region.
 * Employee records reference a shop by ID only; the shop record holds the
 * name, location text, GPS coordinates and geofence radius.
 *
 * Coordinates are NEVER invented. A shop has coordinates only when they came
 * from a location lookup that HR confirmed, from HR placing the pin on the
 * map, or from HR typing them. Otherwise it is "Location not set".
 *
 * Replace these functions with real API calls once the backend contract is
 * defined. Do NOT invent endpoints here.
 * ============================================================================
 */

import { monitoringSettings } from './settingsService'
import { recordAuditEvent } from './auditStore'

/** The agreed default geofence radius in metres (Settings can change it for new shops). */
export const GEOFENCE_RADIUS_M = 150

/**
 * Demo outlets used by the demo's monitored reps. Real shop names, but
 * WITHOUT coordinates: HR confirms each location (lookup or map pin).
 */
const SEED_SHOPS = [
  // Coordinates supplied by HR for the real outlet (5.68486° N, 0.02419° W).
  { shopId: 'shop-bfl-china-mall-ashaiman', companyId: 'box-for-less', shopName: 'China Mall', town: 'Ashaiman', area: 'Ashaiman Main Station', address: '', latitude: 5.68486, longitude: -0.02419, locationSource: 'manual', locationLabel: 'Coordinates provided by HR' },
  { shopId: 'shop-bfl-shoprite-accra', companyId: 'box-for-less', shopName: 'Shoprite', town: 'Accra', area: 'Accra Mall, Tetteh Quarshie', address: '' },
  { shopId: 'shop-bfl-china-mall-spintex', companyId: 'box-for-less', shopName: 'China Mall', town: 'Accra', area: 'Spintex Road', address: '' },
  { shopId: 'shop-daa-melcom-kumasi', companyId: 'double-a', shopName: 'Melcom', town: 'Kumasi', area: 'Adum', address: '' },
  { shopId: 'shop-daa-shoprite-accra', companyId: 'double-a', shopName: 'Shoprite', town: 'Accra', area: 'Accra Mall, Tetteh Quarshie', address: '' },
].map((s) => ({ latitude: null, longitude: null, ...s, geofenceRadius: GEOFENCE_RADIUS_M, status: 'active', source: 'demo' }))

const CUSTOM_KEY = 'mock-shops:custom'
const LOCATION_KEY = 'mock-shops:locations'

function readJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore — mock persistence only.
  }
}

const clean = (v) => (v ?? '').trim().replace(/\s+/g, ' ')
const key = (v) => clean(v).toLowerCase()

/** Display line for where a shop is, e.g. "Spintex Road, Accra". */
export function shopLocationText(shop) {
  if (!shop) return ''
  return [shop.area, shop.town].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
}

/** "China Mall — Spintex Road, Accra". */
export function shopDisplayName(shop) {
  if (!shop) return ''
  const where = shopLocationText(shop)
  return where ? `${shop.shopName} — ${where}` : shop.shopName
}

function allShops() {
  const locations = readJson(LOCATION_KEY, {})
  return [...SEED_SHOPS, ...readJson(CUSTOM_KEY, [])].map((s) => {
    const loc = locations[s.shopId]
    const merged = loc ? { ...s, ...loc } : s
    // Older records may have no area; keep fields consistent.
    return {
      area: '',
      town: '',
      address: '',
      locationSource: merged.latitude != null ? merged.locationSource ?? 'manual' : null,
      ...merged,
      // baseName is the shop as typed (e.g. "China Mall"); shopName, used by
      // every screen, includes the location so two outlets of the same brand
      // are never confused ("China Mall — Spintex Road, Accra").
      baseName: merged.shopName,
      shopName: shopDisplayName(merged),
      displayName: shopDisplayName(merged),
      addressLine: clean(merged.address) || shopLocationText(merged),
    }
  })
}

/** Format a shop's coordinates, or say they are not set yet. */
export function formatShopCoordinates(shop) {
  if (!shop || shop.latitude == null || shop.longitude == null) return 'Not set'
  return `${shop.latitude.toFixed(5)}, ${shop.longitude.toFixed(5)}`
}

/** Search a company's shops by name, town, area or address. */
export function searchShops(companyId, query) {
  const term = key(query)
  const shops = mockListShops(companyId)
  if (!term) return shops
  return shops.filter((s) => [s.baseName, s.town, s.area, s.address].some((v) => key(v).includes(term)))
}

/** An existing shop with the same name, town and area in the company, or null. */
export function findDuplicateShop(companyId, shopName, town, area = '') {
  return allShops().find((s) => s.companyId === companyId && key(s.baseName) === key(shopName) && key(s.town) === key(town) && key(s.area) === key(area)) ?? null
}

function parseCoord(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

export function validateCoordinates(latitude, longitude) {
  const errors = {}
  const lat = parseCoord(latitude)
  const lng = parseCoord(longitude)
  if ((lat == null) !== (lng == null)) errors.latitude = 'Enter both latitude and longitude, or leave both empty.'
  else if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) errors.latitude = 'Latitude must be between -90 and 90.'
  else if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) errors.longitude = 'Longitude must be between -180 and 180.'
  return errors
}

export function validateNewShop(data) {
  const errors = {}
  if (clean(data.shopName).length < 2) errors.shopName = 'Enter the shop name (e.g. China Mall).'
  if (clean(data.town).length < 2) errors.town = 'Enter the city or town (e.g. Ashaiman).'
  if (clean(data.area).length < 2) errors.area = 'Enter the area (e.g. Spintex Road).'
  return { ...errors, ...validateCoordinates(data.latitude, data.longitude) }
}

/**
 * Add a shop to a company. Coordinates are optional and only accepted when
 * they come from a confirmed lookup, the map pin or HR's own entry
 * (locationSource says which). Never generated.
 * @returns {{ shop } | { errors, existing? }}
 */
export function mockCreateShop(data, { createdBy = 'Unknown', source = 'HR' } = {}) {
  if (!['box-for-less', 'double-a'].includes(data.companyId)) return { errors: { companyId: 'Choose the company.' } }
  const errors = validateNewShop(data)
  if (Object.keys(errors).length) return { errors }
  const existing = findDuplicateShop(data.companyId, data.shopName, data.town, data.area)
  if (existing) return { errors: { shopName: `${existing.displayName} already exists. Select it instead.` }, existing }
  const lat = parseCoord(data.latitude)
  const lng = parseCoord(data.longitude)
  const shop = {
    shopId: `shop-${data.companyId === 'double-a' ? 'daa' : 'bfl'}-${key(`${data.shopName} ${data.area}`).replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
    companyId: data.companyId,
    shopName: clean(data.shopName),
    town: clean(data.town),
    area: clean(data.area),
    address: clean(data.address),
    latitude: lat,
    longitude: lng,
    locationSource: lat == null ? null : data.locationSource ?? 'manual',
    locationLabel: lat == null ? null : data.locationLabel ?? null,
    locationConfirmedBy: lat == null ? null : createdBy,
    locationConfirmedAt: lat == null ? null : new Date().toISOString(),
    geofenceRadius: Number(monitoringSettings().defaultGeofenceRadius) || GEOFENCE_RADIUS_M,
    status: 'active',
    source,
    createdBy,
    createdAt: new Date().toISOString(),
  }
  writeJson(CUSTOM_KEY, [...readJson(CUSTOM_KEY, []), shop])
  recordAuditEvent({
    action: 'Shop created',
    category: 'Shifts & Shops',
    source: source === 'registration' ? 'Employee registration' : 'Shop Directory',
    actor: { name: createdBy, role: source === 'registration' ? 'Employee registration' : '' },
    companyIds: [shop.companyId],
    affected: shopDisplayName(shop),
    description: `Added with a ${shop.geofenceRadius} m geofence. ${lat == null ? 'Location not set yet.' : `Location ${LOCATION_SOURCES[shop.locationSource] ?? 'entered'}.`}`,
    next: { shopName: shop.shopName, town: shop.town, area: shop.area, address: shop.address, coordinates: formatShopCoordinates(shop) },
  })
  return { shop: mockGetShop(shop.shopId) }
}

export const LOCATION_SOURCES = {
  geocoded: 'found by location lookup and confirmed by HR',
  'map-adjusted': 'placed on the map by HR',
  manual: 'entered by HR',
}

/**
 * Set or change a shop's GPS location (seed or added shop). The previous
 * value is kept in the audit log. Coordinates must come from the lookup HR
 * confirmed, the map pin, or HR's own entry.
 * @returns {{ shop } | { errors }}
 */
export function mockSetShopLocation(shopId, { latitude, longitude, locationSource, locationLabel }, actor = { name: 'Unknown', role: '' }) {
  const shop = mockGetShop(shopId)
  if (!shop) return { errors: { form: 'Shop not found.' } }
  const errors = validateCoordinates(latitude, longitude)
  if (parseCoord(latitude) == null) errors.latitude = errors.latitude ?? 'Choose a location first.'
  if (!LOCATION_SOURCES[locationSource]) errors.form = 'Say how the location was set.'
  if (Object.keys(errors).length) return { errors }
  const next = {
    latitude: parseCoord(latitude),
    longitude: parseCoord(longitude),
    locationSource,
    locationLabel: locationLabel ?? null,
    locationConfirmedBy: actor.name,
    locationConfirmedAt: new Date().toISOString(),
  }
  const all = readJson(LOCATION_KEY, {})
  all[shopId] = next
  writeJson(LOCATION_KEY, all)
  recordAuditEvent({
    action: shop.latitude == null ? 'Shop location set' : 'Shop location changed',
    category: 'Shifts & Shops',
    source: 'Shop Directory',
    actor,
    companyIds: [shop.companyId],
    affected: shop.displayName,
    description: `Location ${LOCATION_SOURCES[locationSource]}.${locationLabel ? ` ${locationLabel}` : ''}`,
    previous: { coordinates: formatShopCoordinates(shop) },
    next: { coordinates: formatShopCoordinates(next) },
  })
  return { shop: mockGetShop(shopId) }
}

/** A single shop by ID. */
export function mockGetShop(shopId) {
  return allShops().find((s) => s.shopId === shopId) ?? null
}

/** Active shops for a company (for the registration picker and HR). */
export function mockListShops(companyId, { activeOnly = true } = {}) {
  return allShops().filter(
    (s) => s.companyId === companyId && (!activeOnly || s.status === 'active'),
  )
}

/** All shops (internal). */
export function mockListAllShops() {
  return allShops()
}
