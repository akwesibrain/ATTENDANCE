/**
 * VAT on overtime: how each company's VAT rate applies to overtime pay
 * ("none", "deduct" from the employee, or "add" on top as a company cost).
 *
 * FRONTEND-ONLY for now, like Payroll: the choice is kept in this browser's
 * localStorage (per device). The VAT *rate* itself is already on the server.
 * The backend replaces this store — see docs/backend-payroll.md, "VAT on overtime".
 */
import { readJson, writeJson } from '../utils/localStore'
import { vatRateFor } from './settingsService'
import { overtimeVat, VAT_OVERTIME_MODES } from './payroll/payrollRules'

export { overtimeVat, VAT_OVERTIME_MODES }

const STORAGE_KEY = 'workforce:vat-overtime:v1'
/** Company decision (12 Nov 2026): VAT applies to overtime as well as salary, deducted. HR can change it. */
export const DEFAULT_MODE = 'deduct'
const listeners = new Set()
let memo = null
let version = 0

const current = () => (memo ??= readJson(STORAGE_KEY, {}))

export const subscribeVatOnOvertime = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const vatOnOvertimeVersion = () => version

/** @returns {{ mode: 'none'|'deduct'|'add', rate: number, savedBy: string|null, savedAt: string|null }} */
export function vatOnOvertimeFor(companyId) {
  const latest = (current()[companyId] ?? [])[0]
  return { mode: latest?.mode ?? DEFAULT_MODE, rate: vatRateFor(companyId), savedBy: latest?.savedBy ?? null, savedAt: latest?.savedAt ?? null }
}

/** Newest first. */
export function vatOnOvertimeHistory(companyId) {
  return current()[companyId] ?? []
}

/**
 * @returns {{ ok: true } | { errors: Record<string, string> }}
 */
export function saveVatOnOvertime({ user, companyId, mode, at = new Date().toISOString() }) {
  if (!VAT_OVERTIME_MODES[mode]) return { errors: { vatOvertimeMode: 'Choose how VAT applies to overtime.' } }
  if (!companyId) return { errors: { form: 'Choose a company.' } }
  const previous = vatOnOvertimeFor(companyId).mode
  if (previous === mode) return { errors: { form: 'Nothing has changed.' } }
  const entry = { mode, previous, savedBy: user?.name ?? user?.email ?? 'HR', savedAt: at }
  const next = { ...current(), [companyId]: [entry, ...(current()[companyId] ?? [])].slice(0, 50) }
  memo = next
  writeJson(STORAGE_KEY, next)
  version += 1
  listeners.forEach((fn) => fn())
  return { ok: true }
}

/** Test helper. */
export function resetVatOnOvertimeForTests() {
  memo = {}
  version += 1
}
