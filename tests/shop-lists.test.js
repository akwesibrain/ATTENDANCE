import { describe, expect, it } from 'vitest'
import {
  MAX_SHOPS,
  TRACKED_CATEGORIES,
  categoryForPosition,
  isFieldSupervisor,
  needsShopList,
} from '../supabase/functions/_shared/rules/categories.js'
import {
  parseRegistration,
  parseShopList,
  replaceFirstShop,
  sameShopList,
} from '../supabase/functions/_shared/rules/registration.js'

const REQUIRED = 'An allocated shop is required for this position. Select one, or add a new shop.'
const TOO_MANY = 'Choose at most 7 shops.'
const NEW_SHOP = { shopName: 'Super Save', town: 'Accra', area: 'Osu' }

describe('categoryForPosition', () => {
  it.each([
    ['Merchandiser', 'merchandiser'],
    ['Merchandiser (Weekend)', 'merchandiser'],
    ['Sales Representative', 'sales-rep'],
    ['sales rep', 'sales-rep'],
    ['Supervisor', 'supervisor'],
    ['Field Supervisor', 'supervisor'],
    ['Sales Supervisor', 'supervisor'],
    ['Warehouse Assistant', 'warehouse'],
    ['Cashier', 'office'],
    ['', 'office'],
  ])('%s → %s', (position, category) => {
    expect(categoryForPosition(position)).toBe(category)
  })

  it('tracks supervisors, sales reps and merchandisers, up to 7 shops each', () => {
    expect(TRACKED_CATEGORIES).toEqual(['supervisor', 'sales-rep', 'merchandiser'])
    expect(MAX_SHOPS).toBe(7)
  })
})

describe('needsShopList', () => {
  it('is true for field roles only', () => {
    expect(needsShopList('Sales Representative')).toBe(true)
    expect(needsShopList('Supervisor')).toBe(true)
    expect(needsShopList('Merchandiser')).toBe(true)
    expect(needsShopList('Cashier')).toBe(false)
    expect(needsShopList('Warehouse Assistant')).toBe(false)
  })
})

describe('isFieldSupervisor', () => {
  it('accepts only the three field supervisor titles', () => {
    expect(isFieldSupervisor(' Supervisor ')).toBe(true)
    expect(isFieldSupervisor('field supervisor')).toBe(true)
    expect(isFieldSupervisor('Sales Supervisor')).toBe(true)
    expect(isFieldSupervisor('Supervisor Manager')).toBe(false)
    expect(isFieldSupervisor('Head of Supervisors')).toBe(false)
  })
})

describe('parseShopList', () => {
  const ids = (n) => Array.from({ length: n }, (_, i) => `shop-${i + 1}`)

  it('accepts one picked shop', () => {
    expect(parseShopList({ assignedShopIds: ['a'] })).toEqual({ shopIds: ['a'], newShops: [] })
  })
  it('drops duplicates, keeping the order', () => {
    expect(parseShopList({ assignedShopIds: ['a', 'b', 'a'] }).shopIds).toEqual(['a', 'b'])
  })
  it('accepts 7 and refuses 8', () => {
    expect(parseShopList({ assignedShopIds: ids(7) }).shopIds).toHaveLength(7)
    expect(parseShopList({ assignedShopIds: ids(8) })).toEqual({ error: TOO_MANY })
  })
  it('counts new shops toward the 7', () => {
    expect(parseShopList({ assignedShopIds: ids(5), newShops: [NEW_SHOP, NEW_SHOP, NEW_SHOP] })).toEqual({ error: TOO_MANY })
  })
  it('requires at least one shop', () => {
    expect(parseShopList({})).toEqual({ error: REQUIRED })
    expect(parseShopList({ assignedShopIds: [], newShops: [] })).toEqual({ error: REQUIRED })
  })
  it('tidies a new shop', () => {
    const result = parseShopList({ assignedShopIds: [], newShops: [{ shopName: '  Super   Save ', town: 'Accra', area: 'Osu', address: '' }] })
    expect(result).toEqual({ shopIds: [], newShops: [{ shopName: 'Super Save', town: 'Accra', area: 'Osu', address: '' }] })
  })
  it('reports the first problem with a new shop', () => {
    expect(parseShopList({ newShops: [{ shopName: 'X', town: 'Accra', area: 'Osu' }] })).toEqual({ error: 'Enter the shop name (e.g. China Mall).' })
  })
  it('falls back to the old single-shop fields', () => {
    expect(parseShopList({ shopMode: 'existing', assignedShopId: 'a' })).toEqual({ shopIds: ['a'], newShops: [] })
    expect(parseShopList({ shopMode: 'new', newShop: NEW_SHOP }).newShops).toHaveLength(1)
  })
  it('ignores IDs that are not text', () => {
    expect(parseShopList({ assignedShopIds: [5, null, 'a', { id: 'b' }] }).shopIds).toEqual(['a'])
  })
})

describe('parseRegistration with shop lists', () => {
  const body = {
    companyId: 'box-for-less',
    firstName: 'Ama',
    lastName: 'Owusu',
    phone: '0241234567',
    email: '',
    address: 'Accra',
    emergencyContactName: 'Kofi Owusu',
    emergencyContactPhone: '0201234567',
    paymentMethod: 'mobile-money',
    position: 'Cashier',
    biometricConsent: true,
  }

  it('needs a shop for a Sales Representative', () => {
    expect(parseRegistration({ ...body, position: 'Sales Representative' }).errors.shop).toBe(REQUIRED)
  })
  it('keeps the picked shops', () => {
    const result = parseRegistration({ ...body, position: 'Sales Representative', assignedShopIds: ['a', 'b'] })
    expect(result.value.shopIds).toEqual(['a', 'b'])
    expect(result.value.newShops).toEqual([])
  })
  it('refuses a self-registered Supervisor but lets HR add one', () => {
    expect(parseRegistration({ ...body, position: 'Supervisor', assignedShopIds: ['a'] }).errors.position).toBeTruthy()
    const byHr = parseRegistration({ ...body, position: 'Supervisor', assignedShopIds: ['a'] }, { addedByHr: true })
    expect(byHr.errors?.position).toBeUndefined()
    expect(byHr.value.shopIds).toEqual(['a'])
  })
  it('still refuses other elevated titles from HR', () => {
    expect(parseRegistration({ ...body, position: 'Supervisor Manager', assignedShopIds: ['a'] }, { addedByHr: true }).errors.position).toBeTruthy()
  })
  it('gives office staff no shops', () => {
    expect(parseRegistration(body).value.shopIds).toEqual([])
  })
})

describe('replaceFirstShop', () => {
  it('replaces the first shop and removes the new one from later places', () => {
    expect(replaceFirstShop(['a', 'b', 'c'], 'c')).toEqual(['c', 'b'])
    expect(replaceFirstShop(['a', 'b'], 'z')).toEqual(['z', 'b'])
    expect(replaceFirstShop([], 'z')).toEqual(['z'])
  })
})

describe('sameShopList', () => {
  it('compares in order', () => {
    expect(sameShopList(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameShopList(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameShopList(['a'], ['a', 'b'])).toBe(false)
  })
})
