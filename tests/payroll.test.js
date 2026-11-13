import { describe, expect, it } from 'vitest'
import {
  addAdjustment,
  addOverrideVersion,
  addTemplateVersion,
  approveRun,
  calculatePay,
  emptyState,
  emptyStructure,
  pickOverrideVersion,
  pickTemplateVersion,
  resolveProfile,
  runFor,
  setOvertimeApproval,
  setPeriodInputs,
  withAdjustments,
} from '../src/services/payroll/payrollRules.js'
import { tablesToCsv, tablesToPdf, tablesToXlsx } from '../src/utils/exportFiles.js'

const BFL = 'box-for-less'
const DAA = 'double-a'
const by = 'John Mensah'
const PERIOD_END = '2026-11-25'

const structure = (patch = {}) => ({ ...emptyStructure(), basic: 1500, tax: { ...emptyStructure().tax, tier2Rate: 5 }, ...patch })
const ok = (r) => {
  expect(r.errors ?? r.error).toBeUndefined()
  return r.state
}

/** Resolve + calculate like payrollService does for one employee. */
function payFor(state, { companyId, categoryId = 'warehouse', staffId, joinedOn = '2025-01-01', dateKey = PERIOD_END, overtime = {}, inputs = {} }) {
  const template = pickTemplateVersion(state.templates[companyId]?.[categoryId], dateKey, joinedOn)
  const override = pickOverrideVersion(state.overrides[staffId], dateKey)
  const profile = resolveProfile({ template, override })
  return { profile, calc: calculatePay({ structure: profile.structure, attendance: { daysWorked: 20, workedMinutes: 9600 }, overtime, inputs, dateKey }) }
}

describe('payroll — category templates', () => {
  let s = emptyState()
  s = ok(addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure(), appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: '2026-01-01T08:00:00Z' }))

  it('1–2. sets GH₵1,500 for Warehouse Workers and applies it to existing warehouse workers', () => {
    const { profile, calc } = payFor(s, { companyId: BFL, staffId: 'BFL-001' })
    expect(profile.sources.pay).toBe('category')
    expect(calc.basicPay).toBe(1500)
  })

  it('3. a newly registered warehouse worker inherits GH₵1,500 automatically', () => {
    const { calc } = payFor(s, { companyId: BFL, staffId: 'BFL-NEW', joinedOn: '2026-11-10' })
    expect(calc.basicPay).toBe(1500)
  })

  it('4. a change for future registrations only leaves existing staff unchanged', () => {
    const s2 = ok(addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure({ basic: 1700 }), appliesTo: 'new', effectiveFrom: '2026-11-01', by, at: '2026-11-01T08:00:00Z' }))
    expect(payFor(s2, { companyId: BFL, staffId: 'OLD', joinedOn: '2025-03-01' }).calc.basicPay).toBe(1500)
    expect(payFor(s2, { companyId: BFL, staffId: 'NEW', joinedOn: '2026-11-05' }).calc.basicPay).toBe(1700)
  })

  it('5. a change for existing employees applies from its effective date only', () => {
    const s2 = ok(addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure({ basic: 1800 }), appliesTo: 'all', effectiveFrom: '2026-11-26', by, at: '2026-11-20T08:00:00Z' }))
    expect(payFor(s2, { companyId: BFL, staffId: 'X', dateKey: '2026-11-25' }).calc.basicPay).toBe(1500) // Nov period
    expect(payFor(s2, { companyId: BFL, staffId: 'X', dateKey: '2026-12-25' }).calc.basicPay).toBe(1800) // Dec period
  })

  it('the very first template always applies to everyone', () => {
    const s2 = ok(addTemplateVersion(emptyState(), { companyId: BFL, categoryId: 'supervisor', structure: structure({ basic: 3000 }), appliesTo: 'new', effectiveFrom: '2026-01-01', by, at: 'x' }))
    expect(s2.templates[BFL].supervisor[0].appliesTo).toBe('all')
  })

  it('13. company separation: Box For Less salaries never reach Double A', () => {
    const { profile, calc } = payFor(s, { companyId: DAA, staffId: 'DAA-001' })
    expect(profile.template).toBeNull()
    expect(profile.sources.pay).toBe('none')
    expect(calc.basicPay).toBe(0)
    const s2 = ok(addTemplateVersion(s, { companyId: DAA, categoryId: 'warehouse', structure: structure({ basic: 1650 }), appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: 'y' }))
    expect(payFor(s2, { companyId: DAA, staffId: 'DAA-001' }).calc.basicPay).toBe(1650)
    expect(payFor(s2, { companyId: BFL, staffId: 'BFL-001' }).calc.basicPay).toBe(1500)
  })

  it('rejects invalid structures', () => {
    const r = addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure({ basic: -1 }), appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: 'z' })
    expect(r.errors.basic).toBeTruthy()
  })
})

describe('payroll — overrides, overtime, tax, take-home', () => {
  let s = emptyState()
  s = ok(addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure({ overtimeRate: 60 }), appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: 'a' }))

  it('6. an individual override changes only that employee and is labelled', () => {
    const s2 = ok(addOverrideVersion(s, { staffId: 'BFL-007', companyId: BFL, fields: { payType: 'monthly', basic: 2000 }, effectiveFrom: '2026-11-01', reason: 'Team lead', by, at: 'b' }))
    const mine = payFor(s2, { companyId: BFL, staffId: 'BFL-007' })
    expect(mine.calc.basicPay).toBe(2000)
    expect(mine.profile.sources.pay).toBe('override')
    expect(mine.profile.sources.allowances).toBe('category')
    expect(payFor(s2, { companyId: BFL, staffId: 'BFL-008' }).calc.basicPay).toBe(1500)
    expect(s2.templates[BFL].warehouse[0].structure.basic).toBe(1500) // template untouched
    // History kept: before the override's date the category default applies.
    expect(payFor(s2, { companyId: BFL, staffId: 'BFL-007', dateKey: '2026-10-25' }).calc.basicPay).toBe(1500)
  })

  it('7. overtime: 5 approved hours × GH₵60 = GH₵300; gross GH₵1,800', () => {
    const { calc } = payFor(s, { companyId: BFL, staffId: 'A', overtime: { recordedMinutes: 300, approvedMinutes: 300 } })
    expect(calc.overtime.pay).toBe(300)
    expect(calc.gross).toBe(1800)
  })

  it('unapproved overtime is never paid', () => {
    const { calc } = payFor(s, { companyId: BFL, staffId: 'A', overtime: { recordedMinutes: 300, approvedMinutes: null } })
    expect(calc.overtime.pay).toBe(0)
    expect(calc.overtime.pending).toBe(true)
    expect(calc.gross).toBe(1500)
  })

  it('8. an employee override can set their own Tier 2 % and a manual SSNIT figure', () => {
    const s2 = ok(addOverrideVersion(s, { staffId: 'M1', companyId: BFL, fields: { tax: { method: 'manual', tier2Rate: 4, ssnit: { kind: 'amount', value: 80 } } }, effectiveFrom: '2026-01-01', reason: 'Agreed with HR', by, at: 'c' }))
    const { calc } = payFor(s2, { companyId: BFL, staffId: 'M1' })
    expect(calc.taxMethod).toBe('manual')
    expect(calc.tier2Rate).toBe(4)
    expect(calc.paye).toBe(60) // 4% of 1,500
    expect(calc.ssnitEmployee).toBe(80)
    expect(calc.takeHome).toBe(1500 - 140)
  })

  it('a structure cannot be saved without a Tier 2 percentage', () => {
    const r = addTemplateVersion(s, { companyId: BFL, categoryId: 'office', appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: 'x', structure: { ...emptyStructure(), basic: 1000 } })
    expect(r.errors['tax.tier2Rate']).toMatch(/Tier 2/)
  })

  it('9. Tier 2 = HR % of basic, SSNIT 5.5% of basic, employer SSNIT separate', () => {
    const { calc } = payFor(s, { companyId: BFL, staffId: 'A' })
    expect(calc.ssnitEmployee).toBe(82.5)
    expect(calc.tier2Rate).toBe(5)
    expect(calc.paye).toBe(75) // 5% of 1,500
    expect(calc.employerSsnit).toBe(195)
    expect(calc.takeHome).toBe(1500 - 82.5 - 75)
    expect(calc.totalDeductions).toBe(157.5) // employer SSNIT NOT included
  })

  it('VAT on salary: 5.5% of basic + allowances is deducted', () => {
    const template = pickTemplateVersion(s.templates[BFL].warehouse, PERIOD_END, '2025-01-01')
    const { structure: st } = resolveProfile({ template })
    const calc = calculatePay({ structure: { ...st, allowances: [{ id: 'transport', name: 'Transport', kind: 'amount', value: 300 }] }, attendance: {}, overtime: {}, inputs: {}, dateKey: PERIOD_END, salaryVat: { rate: 5.5 } })
    expect(calc.salaryVat).toEqual({ rate: 5.5, base: 1800, amount: 99 })
    expect(calc.vatDeducted).toBe(99)
    expect(calc.totalDeductions).toBe(round(75 + 82.5 + 99))
    expect(calc.takeHome).toBe(round(1800 - 75 - 82.5 - 99))
  })

  it('VAT on salary and on overtime together: 5.5% + 5.5%', () => {
    const template = pickTemplateVersion(s.templates[BFL].warehouse, PERIOD_END, '2025-01-01')
    const { structure: st } = resolveProfile({ template })
    const calc = calculatePay({ structure: { ...st, overtimeRate: null }, attendance: {}, overtime: { recordedMinutes: 600, approvedMinutes: 600, companyRatePay: 100, vat: { mode: 'deduct', rate: 5.5 } }, inputs: {}, dateKey: PERIOD_END, salaryVat: { rate: 5.5 } })
    expect(calc.salaryVat.amount).toBe(82.5) // 5.5% of 1,500
    expect(calc.overtimeVatDeduction).toBe(5.5) // 5.5% of 100
    expect(calc.vatDeducted).toBe(88)
    expect(calc.takeHome).toBe(round(1600 - 75 - 82.5 - 88))
  })

  it('10–11. allowances and deductions (amounts and %), take-home recalculated', () => {
    const s2 = ok(addTemplateVersion(s, {
      companyId: BFL, categoryId: 'warehouse', appliesTo: 'all', effectiveFrom: '2026-11-01', by, at: 'd',
      structure: structure({
        allowances: [
          { id: 'transport', name: 'Transport allowance', kind: 'amount', value: 200, standard: true },
          { id: 'housing', name: 'Housing allowance', kind: 'percent', value: 10, standard: true },
          { id: 'meal', name: 'Meal allowance', kind: 'amount', value: 100, standard: true },
          { id: 'other', name: 'Other allowances', kind: 'amount', value: 0, standard: true },
        ],
        deductions: [{ id: 'welfare', name: 'Welfare', kind: 'amount', value: 20 }],
        tax: { method: 'manual', tier2Rate: 0, paye: { kind: 'amount', value: 0 }, ssnit: { kind: 'percent', value: 5.5 } },
      }),
    }))
    const { calc } = payFor(s2, { companyId: BFL, staffId: 'A', inputs: { bonus: 50, loan: 100, advance: 30 } })
    expect(calc.allowanceTotal).toBe(450) // 200 + 150 + 100
    expect(calc.gross).toBe(2000) // 1500 + 450 + 50
    expect(calc.ssnitEmployee).toBe(82.5)
    expect(calc.totalDeductions).toBe(232.5) // 82.5 + 20 + 100 + 30
    expect(calc.takeHome).toBe(1767.5)
  })

  it('daily and hourly pay use attendance', () => {
    const d = calculatePay({ structure: structure({ payType: 'daily', basic: 80 }), attendance: { daysWorked: 20, workedMinutes: 0 }, dateKey: PERIOD_END })
    expect(d.basicPay).toBe(1600)
    const h = calculatePay({ structure: structure({ payType: 'hourly', basic: 10 }), attendance: { daysWorked: 0, workedMinutes: 9600 }, dateKey: PERIOD_END })
    expect(h.basicPay).toBe(1600)
  })
})

describe('payroll — approval and history', () => {
  let s = emptyState()
  s = ok(addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure(), appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: 'a' }))
  const line = (state) => {
    const { profile, calc } = payFor(state, { companyId: BFL, staffId: 'BFL-001' })
    return { staffId: 'BFL-001', fullName: 'Ama', companyId: BFL, structure: profile.structure, calc }
  }

  it('14. approved payroll is frozen: later salary changes do not alter it', () => {
    s = ok(approveRun(s, { companyId: BFL, periodKey: '2026-11', lines: [line(s)], by, at: 'e' }))
    const later = ok(addTemplateVersion(s, { companyId: BFL, categoryId: 'warehouse', structure: structure({ basic: 2500 }), appliesTo: 'all', effectiveFrom: '2026-01-01', by, at: 'f' }))
    expect(runFor(later, BFL, '2026-11').lines[0].calc.basicPay).toBe(1500)
    expect(runFor(later, BFL, '2026-11').status).toBe('approved')
  })

  it('approved payroll blocks draft edits and requires a controlled adjustment', () => {
    expect(setPeriodInputs(s, { companyId: BFL, periodKey: '2026-11', staffId: 'BFL-001', inputs: { bonus: 10 }, by, at: 'g' }).error).toBeTruthy()
    expect(setOvertimeApproval(s, { companyId: BFL, periodKey: '2026-11', staffId: 'BFL-001', approval: { minutes: 60 }, by, at: 'g' }).error).toBeTruthy()
    expect(addAdjustment(s, { companyId: BFL, periodKey: '2026-11', staffId: 'BFL-001', type: 'earning', amount: 50, reason: 'short', by, at: 'h' }).errors.reason).toBeTruthy()
    const s2 = ok(addAdjustment(s, { companyId: BFL, periodKey: '2026-11', staffId: 'BFL-001', type: 'earning', amount: 50, reason: 'Missed transport refund', by, at: 'h' }))
    const run = runFor(s2, BFL, '2026-11')
    const adjusted = withAdjustments(run.lines[0], run.adjustments)
    expect(run.lines[0].calc.takeHome).toBe(line(s).calc.takeHome) // snapshot unchanged
    expect(adjusted.adjustedTakeHome).toBe(round(line(s).calc.takeHome + 50))
  })

  it('every change is logged', () => {
    expect(s.log.map((l) => l.action)).toEqual(['Payroll approved', 'Salary structure saved'])
  })
})

describe('payroll — exports', () => {
  const table = { title: 'Payroll — all employees', subtitle: 'November 2026', columns: [{ label: 'Staff ID' }, { label: 'Employee' }, { label: 'Take-home (GH₵)', money: true }], rows: [['BFL-001', 'Ama Owusu', 1278.69]], totals: ['', 'Total', 1278.69] }

  it('12. CSV has a BOM, headers and 2-dp amounts', () => {
    const csv = tablesToCsv([table])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"Take-home (GH₵)"')
    expect(csv).toContain('"1278.69"')
  })

  it('12. XLSX is a valid zip with a workbook and sheet', async () => {
    const blob = tablesToXlsx([table])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('xl/workbook.xml')
    expect(text).toContain('Ama Owusu')
    expect(text).toContain('<v>1278.69</v>')
  })

  it('12. PDF is well-formed', async () => {
    const text = await tablesToPdf([table], { heading: 'Test' }).text()
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const xref = Number(text.match(/startxref\n(\d+)/)[1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
  })
})

function round(n) {
  return Math.round(n * 100) / 100
}

describe('VAT on overtime', () => {
  const base = { payType: 'monthly', basic: 2000, allowances: [], overtimeEligible: true, overtimeRate: null, tax: { method: 'statutory' }, deductions: [] }
  const run = (vat) => calculatePay({ structure: base, attendance: { daysWorked: 22, workedMinutes: 0 }, overtime: { recordedMinutes: 600, approvedMinutes: 600, companyRatePay: 100, vat }, inputs: {}, dateKey: '2026-11-25' })

  it('is not applied by default', () => {
    const c = run(undefined)
    expect(c.overtime.vat).toMatchObject({ mode: 'none', amount: 0 })
    expect(c.overtimeVatDeduction).toBe(0)
    expect(c.employerOvertimeVat).toBe(0)
  })

  it('deducted: GH₵100 overtime at 5.5% takes GH₵5.50 off take-home, PAYE unchanged', () => {
    const none = run({ mode: 'none', rate: 5.5 })
    const c = run({ mode: 'deduct', rate: 5.5 })
    expect(c.overtime.vat).toMatchObject({ amount: 5.5, employeeGets: 94.5, companyCost: 100 })
    expect(c.overtimeVatDeduction).toBe(5.5)
    expect(c.paye).toBe(none.paye)
    expect(c.gross).toBe(none.gross)
    expect(c.takeHome).toBeCloseTo(none.takeHome - 5.5, 2)
    expect(c.vatDeducted).toBe(5.5)
  })

  it('added: the employee is unaffected and the company pays GH₵5.50 more', () => {
    const none = run({ mode: 'none', rate: 5.5 })
    const c = run({ mode: 'add', rate: 5.5 })
    expect(c.takeHome).toBe(none.takeHome)
    expect(c.employerOvertimeVat).toBe(5.5)
    expect(c.overtime.vat.companyCost).toBe(105.5)
  })

  it('applies nothing when no overtime is approved', () => {
    const c = calculatePay({ structure: base, attendance: {}, overtime: { recordedMinutes: 600, approvedMinutes: null, companyRatePay: 0, vat: { mode: 'deduct', rate: 5.5 } }, inputs: {}, dateKey: '2026-11-25' })
    expect(c.overtimeVatDeduction).toBe(0)
  })
})
