import { PAY_TYPES, TAX_METHODS } from '../../services/payroll/payrollRules'
import { formatCedis } from '../../services/overtimeService'
import {
  AllowancesEditor,
  DeductionsEditor,
  OvertimeEditor,
  PayEditor,
  TaxEditor,
} from './StructureFields'

export const GROUP_EDITORS = {
  pay: PayEditor,
  allowances: AllowancesEditor,
  overtime: OvertimeEditor,
  tax: TaxEditor,
  deductions: DeductionsEditor,
}

/** One-line summary of a group, for read-only "Category Default" display. */
export function groupSummary(key, s, companyRate) {
  if (key === 'pay') return `${PAY_TYPES[s.payType].label} · ${formatCedis(s.basic)} ${PAY_TYPES[s.payType].unit}`
  if (key === 'allowances') {
    const on = s.allowances.filter((a) => Number(a.value) > 0)
    return on.length ? on.map((a) => `${a.name} ${a.kind === 'percent' ? `${a.value}%` : formatCedis(a.value)}`).join(' · ') : 'None'
  }
  if (key === 'overtime') return s.overtimeEligible === false ? 'Not eligible' : s.overtimeRate === null ? `Company rate${companyRate ? ` (${formatCedis(companyRate)}/h)` : ''}` : `${formatCedis(s.overtimeRate)}/h`
  if (key === 'tax') return `Tier 2 ${s.tax.tier2Rate === null ? 'not set' : `${s.tax.tier2Rate}% of basic`} · ${s.tax.method === 'statutory' ? TAX_METHODS.statutory.label : `SSNIT ${s.tax.ssnit.kind === 'percent' ? `${s.tax.ssnit.value}%` : formatCedis(s.tax.ssnit.value)} (HR)`}`
  if (key === 'deductions') return s.deductions.length ? s.deductions.map((d) => `${d.name} ${d.kind === 'percent' ? `${d.value}%` : formatCedis(d.value)}`).join(' · ') : 'None'
  return ''
}
