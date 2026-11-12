import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const ROSTER = [
  { employeeId: 'BFL-001', fullName: 'Ama Owusu', companyId: 'box-for-less', companyName: 'Box For Less', position: 'Warehouse Assistant', paymentMethod: 'mobile-money', employmentStart: '2025-02-01', employmentEnd: null },
  { employeeId: 'BFL-002', fullName: 'Kofi Mensah', companyId: 'box-for-less', companyName: 'Box For Less', position: 'Warehouse Supervisor', paymentMethod: 'bank', employmentStart: '2026-11-10', employmentEnd: null },
  { employeeId: 'BFL-003', fullName: 'Esi Boateng', companyId: 'box-for-less', companyName: 'Box For Less', position: 'Supervisor', paymentMethod: 'bank', employmentStart: '2024-01-01', employmentEnd: null },
  { employeeId: 'DAA-001', fullName: 'Yaw Darko', companyId: 'double-a', companyName: 'Double A', position: 'Warehouse Assistant', paymentMethod: 'bank', employmentStart: '2024-01-01', employmentEnd: null },
]
vi.mock('../src/services/attendanceRecordsService', () => ({
  listAttendanceRoster: (cid) => ROSTER.filter((e) => !cid || e.companyId === cid),
  listAttendanceRecords: ({ companyId }) => ROSTER.filter((e) => !companyId || e.companyId === companyId).map((e) => ({ key: `${e.employeeId}-d1`, employeeId: e.employeeId, companyId: e.companyId, hasAttendance: true, workingMinutes: 480 })),
}))
vi.mock('../src/services/overtimeService', () => ({
  formatCedis: (n) => `GH₵${(Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  formatOvertime: (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`,
  overtimeReport: ({ companyId }) => ({ employees: companyId === 'box-for-less' ? [{ employeeId: 'BFL-001', minutes: 300, pay: 250 }] : [] }),
}))
vi.mock('../src/services/settingsService', () => ({ companyDisplayName: (id) => ({ 'box-for-less': 'Box For Less', 'double-a': 'Double A' })[id], overtimeRateFor: () => 50 }))
vi.mock('../src/services/permissionsService', () => ({
  can: () => true,
  canAccessCompany: () => true,
  scopeCompanyIds: (u, cid) => (cid ? [cid] : ['box-for-less', 'double-a']),
}))
vi.mock('../src/services/auditStore', () => ({ recordExport: () => {} }))

const user = { name: 'John Mensah', status: 'active' }

describe('payroll screens (SSR smoke)', async () => {
  const svc = await import('../src/services/payrollService')
  const { default: Payroll } = await import('../src/pages/Payroll.jsx')
  const { default: SalaryStructures } = await import('../src/components/payroll/SalaryStructures.jsx')
  const { listPayPeriods } = await import('../src/utils/payPeriod')
  const period = listPayPeriods(1)[0]

  it('saves a warehouse structure and shows it in payroll', () => {
    const preview = svc.previewStructureChange({ companyId: 'box-for-less', categoryId: 'warehouse', appliesTo: 'all', effectiveFrom: '2026-01-01' })
    expect(preview.first).toBe(true)
    expect(preview.affected).toBe(1) // Ama; Kofi joined after the date
    const r = svc.saveCategoryStructure({ user, companyId: 'box-for-less', categoryId: 'warehouse', structure: { payType: 'monthly', basic: 1500, allowances: [], overtimeEligible: true, overtimeRate: 60, tax: { method: 'statutory', paye: { kind: 'amount', value: 0 }, ssnit: { kind: 'amount', value: 0 } }, deductions: [] }, appliesTo: 'all', effectiveFrom: '2026-01-01' })
    expect(r.ok).toBe(true)

    const p = svc.buildPayroll({ user, companyId: 'box-for-less', period })
    const ama = p.lines.find((l) => l.staffId === 'BFL-001')
    const kofi = p.lines.find((l) => l.staffId === 'BFL-002')
    expect(ama.calc.basicPay).toBe(1500)
    expect(kofi.calc.basicPay).toBe(1500) // new registration inherits
    expect(ama.calc.overtime.pending).toBe(true)
    svc.approveOvertime({ user, companyId: 'box-for-less', period, staffIds: ['BFL-001'] })
    const p2 = svc.buildPayroll({ user, companyId: 'box-for-less', period })
    expect(p2.lines.find((l) => l.staffId === 'BFL-001').calc.overtime.pay).toBe(300)
    expect(p2.lines.find((l) => l.staffId === 'BFL-001').calc.gross).toBe(1800)
    const dpa = svc.buildPayroll({ user, companyId: 'double-a', period })
    expect(dpa.lines[0].calc.basicPay).toBe(0) // company separation

    const html = renderToString(<Payroll user={user} company={{ id: '', name: 'All companies' }} companies={[{ id: 'box-for-less', name: 'Box For Less' }, { id: 'double-a', name: 'Double A' }]} />)
    expect(html).toContain('GH₵1,800.00')
    expect(html).toContain('No salary structure')
    expect(html).toContain('Approve payroll')

    const html2 = renderToString(<SalaryStructures user={user} company={{ id: 'box-for-less', name: 'Box For Less' }} />)
    expect(html2).toContain('GH₵1,500.00')
    expect(html2).toContain('Not set')

    const tables = svc.exportTables({ kind: 'statutory', payroll: p2, period })
    expect(tables[0].rows.length).toBe(3)
    expect(svc.exportTables({ kind: 'overtime', payroll: p2, period })[0].rows[0][7]).toBe(300)
  })
})
