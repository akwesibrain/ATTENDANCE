/**
 * Field employees' shop lists: HR reads and replaces the 1 to 7 shops a
 * Supervisor, Sales Representative or Merchandiser works at. The list is also
 * their daily visit list. Every change keeps a snapshot and an audit row, and
 * the first shop is mirrored in employees.assigned_shop_id.
 */

import { Hono } from 'npm:hono@4.6.14'
import type { Context } from 'npm:hono@4.6.14'
import { needsShopList } from '../_shared/rules/categories.js'
import { normalizeStaffId } from '../_shared/rules/checkin.js'
import { parseShopList, sameShopList } from '../_shared/rules/registration.js'
import { assertCompany, type HrEnv, type HrUser } from './auth.ts'
import { ApiError, applyChange, db, found, invalid, must, readJson } from './lib.ts'

export const hrShopListRoutes = new Hono<HrEnv>()

const HISTORY_LIMIT = 50
const NOT_ON_COMPANY_LIST = 'Choose shops from your company’s shop list.'
const NO_SHOP_LIST = 'This employee’s position does not have a shop list.'

type Employee = { staff_id: string; company_id: string; full_name: string; position: string; assigned_shop_id: string | null }

/** The ops that point the employee's first shop somewhere else, keeping the old one in the history. */
export function firstShopOps(emp: Employee, hr: HrUser, shopId: string, at: string) {
  return [
    { table: 'shop_assignments', op: 'update', match: { employee_id: emp.staff_id, active: true }, row: { active: false } },
    {
      table: 'shop_assignments',
      op: 'insert',
      row: {
        company_id: emp.company_id,
        employee_id: emp.staff_id,
        shop_id: shopId,
        previous_shop_id: emp.assigned_shop_id,
        effective_date: at,
        assigned_at: at,
        assigned_by: hr.name,
        assigned_by_role: hr.role,
      },
    },
    { table: 'employees', op: 'update', match: { staff_id: emp.staff_id }, row: { assigned_shop_id: shopId } },
  ]
}

/** The ops that replace the employee's whole list, with a snapshot. */
export function shopListOps(emp: Employee, hr: HrUser, next: string[], previous: string[]) {
  const at = new Date().toISOString()
  return [
    { table: 'employee_shops', op: 'delete', match: { staff_id: emp.staff_id } },
    ...next.map((shopId, index) => ({
      table: 'employee_shops',
      op: 'insert',
      row: { staff_id: emp.staff_id, shop_id: shopId, company_id: emp.company_id, position: index + 1, assigned_at: at, assigned_by: hr.name },
    })),
    {
      table: 'employee_shop_changes',
      op: 'insert',
      row: { staff_id: emp.staff_id, company_id: emp.company_id, at, by_name: hr.name, by_role: hr.role, previous, next },
    },
    ...(next[0] !== emp.assigned_shop_id ? firstShopOps(emp, hr, next[0], at) : []),
  ]
}

/** An employee's current list, in order. */
export async function currentShopList(staffId: string): Promise<string[]> {
  const rows = await found(db.from('employee_shops').select('shop_id').eq('staff_id', staffId).order('position'))
  return rows.map((row: { shop_id: string }) => row.shop_id)
}

/** Shop names for the audit log, in list order. */
async function shopNames(ids: string[]) {
  if (!ids.length) return 'None'
  const rows = await found(db.from('shops').select('shop_id, shop_name').in('shop_id', ids))
  const names = new Map(rows.map((row: { shop_id: string; shop_name: string }) => [row.shop_id, row.shop_name]))
  return ids.map((id) => names.get(id) ?? id).join(', ')
}

async function fieldEmployee(c: Context<HrEnv>): Promise<Employee> {
  const id = normalizeStaffId(c.req.param('staffId'))
  const emp = id
    ? await must(db.from('employees').select('staff_id, company_id, full_name, position, assigned_shop_id').eq('staff_id', id).maybeSingle())
    : null
  if (!emp) throw new ApiError(404, 'Employee not found.')
  assertCompany(c, emp.company_id, 'You are not authorised for this employee.')
  if (!needsShopList(emp.position)) throw new ApiError(409, NO_SHOP_LIST)
  return emp
}

async function listResponse(staffId: string) {
  const [shopIds, history] = await Promise.all([
    currentShopList(staffId),
    found(db.from('employee_shop_changes').select('at, by_name, previous, next').eq('staff_id', staffId).order('at', { ascending: false }).limit(HISTORY_LIMIT)),
  ])
  const latest = history[0] ?? null
  return {
    shopIds,
    updatedAt: latest?.at ?? null,
    updatedBy: latest?.by_name ?? null,
    history: history.map((h: { at: string; by_name: string; previous: string[]; next: string[] }) => ({ at: h.at, by: h.by_name, previous: h.previous, next: h.next })),
  }
}

hrShopListRoutes.get('/employees/:staffId/visit-list', async (c) => {
  const emp = await fieldEmployee(c)
  return c.json(await listResponse(emp.staff_id))
})

hrShopListRoutes.put('/employees/:staffId/visit-list', async (c) => {
  const hr = c.get('hr')
  const emp = await fieldEmployee(c)
  const body = await readJson(c)
  const parsed = parseShopList({ assignedShopIds: body.shopIds })
  if ('error' in parsed) throw invalid({ shop: parsed.error })
  const next: string[] = parsed.shopIds

  const known = await found(
    db.from('shops').select('shop_id').in('shop_id', next).eq('company_id', emp.company_id).eq('status', 'active'),
  )
  if (known.length !== next.length) throw invalid({ shop: NOT_ON_COMPANY_LIST })

  const previous = await currentShopList(emp.staff_id)
  if (sameShopList(previous, next)) return c.json({ unchanged: true, ...(await listResponse(emp.staff_id)) })

  await applyChange(shopListOps(emp, hr, next, previous), {
    actorName: hr.name,
    actorRole: hr.role,
    source: 'Employees',
    action: 'Employee shop list changed',
    category: 'Shifts & Shops',
    companyIds: [emp.company_id],
    affected: `${emp.full_name} (${emp.staff_id})`,
    description: `${next.length} shop${next.length === 1 ? '' : 's'} on the list. The first is the main shop.`,
    previous: { shops: await shopNames(previous) },
    next: { shops: await shopNames(next) },
  })
  return c.json(await listResponse(emp.staff_id))
})
