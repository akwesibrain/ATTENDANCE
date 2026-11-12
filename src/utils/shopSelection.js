/**
 * Shops a field employee (Sales Representative, Merchandiser) works at:
 * at least MIN_SHOPS and at most MAX_SHOPS — 1 shop, plus up to 6 more.
 * They can tick shops from the company's list and add shops that are not in
 * it yet.
 *
 * The backend currently stores ONE shop per employee. `backendShopFields`
 * keeps the fields it reads today (`shopMode`, `assignedShopId`, `newShop`)
 * pointing at the first shop, and the form also sends the full set
 * (`assignedShopIds`, `newShops`) — see docs/backend-multi-shop-and-places.md.
 */
import { requiresShop } from '../services/shopAssignmentService'
import { findDuplicateShop, validateNewShop } from '../services/shopsService'

export const MIN_SHOPS = 1
export const MAX_SHOPS = 7

export const EMPTY_NEW_SHOP = { shopName: '', town: '', area: '', address: '', latitude: '', longitude: '', locationSource: null, locationLabel: null }

/** Ticked shops plus shops being added. */
export function selectedShopCount(data) {
  return (data.assignedShopIds?.length ?? 0) + (data.newShops?.length ?? 0)
}

/** The fields the backend reads today, pointing at the first shop. */
export function backendShopFields(assignedShopIds, newShops) {
  if (assignedShopIds.length) return { shopMode: 'existing', assignedShopId: assignedShopIds[0], newShop: newShops[0] ?? { ...EMPTY_NEW_SHOP } }
  if (newShops.length) return { shopMode: 'new', assignedShopId: null, newShop: newShops[0] }
  return { shopMode: 'existing', assignedShopId: null, newShop: { ...EMPTY_NEW_SHOP } }
}

/** '' when the shops are fine, otherwise the first problem to show. */
export function validateShopCount(data) {
  if (!requiresShop(data.position)) return ''
  const n = selectedShopCount(data)
  if (n < MIN_SHOPS) return 'Choose the shop you work at, or add it if it is not in the list.'
  if (n > MAX_SHOPS) return `You can choose up to ${MAX_SHOPS} shops.`
  for (const [i, shop] of (data.newShops ?? []).entries()) {
    const label = (data.newShops.length > 1 ? `New shop ${i + 1}: ` : '')
    const errors = validateNewShop(shop)
    if (Object.keys(errors).length) return label + Object.values(errors)[0]
    const dup = findDuplicateShop(data.companyId, shop.shopName, shop.town, shop.area ?? '')
    if (dup) return `${label}${dup.shopName} is already in the list — tick it there instead.`
  }
  return ''
}
