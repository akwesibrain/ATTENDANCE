import { beforeEach, describe, expect, it, vi } from 'vitest'

// The browser reads tables through this client; record every query it builds.
const queries = vi.hoisted(() => [])
vi.mock('../src/services/backend/client', () => {
  const query = (table) => {
    const q = { table, orders: [] }
    queries.push(q)
    const builder = {
      select: () => builder,
      gte: () => builder,
      order: (column) => { q.orders.push(column); return builder },
      range: async () => ({ data: [], error: null }),
    }
    return builder
  }
  return { supabase: { from: query }, api: vi.fn(), submit: vi.fn() }
})

const { validateAllocatedShop, isFieldPosition } = await import('../src/utils/registrationValidation.js')
const { requiresShop } = await import('../src/services/shopAssignmentService.js')
const { needsShopList } = await import('../supabase/functions/_shared/rules/categories.js')
const { hydrate } = await import('../src/services/backend/cache.js')

const REQUIRED = 'An allocated shop is required for this position. Select one, or add a new shop.'

describe('the browser asks for a shop exactly when the server needs one (final review: Important 1)', () => {
  const titles = ['Sales Representative', 'Sales Rep', 'Merchandiser', 'Merchandiser (Weekend)', 'Supervisor', 'Field Supervisor', 'Cashier', 'Warehouse Worker', 'Sales Manager']

  it.each(titles)('%s', (title) => {
    expect(isFieldPosition(title)).toBe(needsShopList(title))
    expect(requiresShop(title)).toBe(needsShopList(title))
  })

  it('asks a weekend merchandiser for a shop before they submit', () => {
    expect(validateAllocatedShop({ position: 'Merchandiser (Weekend)', shopMode: 'existing', assignedShopId: '' })).toBe(REQUIRED)
  })
})

describe('the HR portal pages shop lists by a unique order (final review: Important 2)', () => {
  beforeEach(() => { queries.length = 0 })

  it('orders employee_shops by staff and then position', async () => {
    await hydrate().catch(() => {})
    const list = queries.find((q) => q.table === 'employee_shops')
    expect(list?.orders).toEqual(['staff_id', 'position'])
  })
})
