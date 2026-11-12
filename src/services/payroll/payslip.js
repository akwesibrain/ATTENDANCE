/**
 * One payslip model, three outputs: on-screen preview (React), print (HTML in
 * a new window) and PDF download. Employer SSNIT is always shown separately
 * and never reduces take-home pay.
 */

import { createPdf } from '../../utils/exportFiles'
import { PAY_TYPES, TAX_METHODS } from './payrollRules'

const cedis = (n) => `GH₵${(Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export const PAYMENT_STATUS = { draft: 'Draft — not approved', approved: 'Approved — awaiting payment', paid: 'Paid' }

export function payslipModel(line, period) {
  const c = line.calc
  const earnings = [
    { label: 'Basic salary', note: c.payType === 'monthly' ? 'Monthly' : `${c.basicNote} (${cedis(c.rate)} ${PAY_TYPES[c.payType].unit})`, amount: c.basicPay },
    ...c.allowances.map((a) => ({ label: a.name, note: a.kind === 'percent' ? `${a.value}% of basic` : '', amount: a.amount })),
    ...(c.bonus ? [{ label: 'Bonus', amount: c.bonus }] : []),
    ...(c.commission ? [{ label: 'Commission', amount: c.commission }] : []),
    {
      label: 'Overtime',
      note: !c.overtime.eligible ? 'Not eligible' : c.overtime.approved
        ? `${c.overtime.hours} h × ${c.overtime.rate ? `${cedis(c.overtime.rate)}/h` : 'company rate'}${c.overtime.rateSource === 'company' ? ' (company rate, by day)' : ''}`
        : 'No approved overtime',
      amount: c.overtime.pay,
    },
    ...(c.otherEarnings ? [{ label: 'Other earnings', amount: c.otherEarnings }] : []),
  ]
  const deductions = [
    { label: 'PAYE (income tax)', note: c.taxMethod === 'statutory' ? `GRA bands on ${cedis(c.chargeable)} chargeable` : TAX_METHODS.manual.short, amount: c.paye },
    { label: 'Employee SSNIT', note: c.taxMethod === 'statutory' ? `${c.statutory.ssnitEmployeeRate}% of basic` : TAX_METHODS.manual.short, amount: c.ssnitEmployee },
    ...c.deductions.map((d) => ({ label: d.name, note: d.kind === 'percent' ? `${d.value}% of basic` : '', amount: d.amount })),
    ...(c.loan ? [{ label: 'Loan repayment', amount: c.loan }] : []),
    ...(c.advance ? [{ label: 'Salary advance', amount: c.advance }] : []),
    ...(c.otherDeduction ? [{ label: 'Other deductions', amount: c.otherDeduction }] : []),
  ]
  const adjustments = (line.adjustments ?? []).map((a) => ({ label: a.type === 'earning' ? 'Adjustment (added)' : 'Adjustment (deducted)', note: a.reason, amount: a.type === 'earning' ? a.amount : -a.amount }))
  return {
    employee: [
      ['Employee', line.fullName],
      ['Staff ID', line.staffId],
      ['Position', line.position],
      ['Category', line.categoryLabel],
      ['Company', line.companyName],
      ['Payment method', line.paymentMethodLabel ?? line.paymentMethod ?? '—'],
    ],
    period: `${period.label} (${fmtDate(period.start)} – ${fmtDate(period.end)})`,
    earnings,
    deductions,
    adjustments,
    gross: c.gross,
    totalDeductions: c.totalDeductions,
    takeHome: line.adjustedTakeHome ?? c.takeHome,
    employerSsnit: c.employerSsnit,
    employerRate: c.statutory.ssnitEmployerRate,
    status: PAYMENT_STATUS[line.status] ?? PAYMENT_STATUS.draft,
    taxMethod: TAX_METHODS[c.taxMethod].label,
    rules: c.statutory.label,
  }
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function payslipHtml(line, period) {
  const m = payslipModel(line, period)
  const rows = (items) => items.map((i) => `<tr><td>${esc(i.label)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</td><td class="n">${esc(cedis(i.amount))}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(line.staffId)} ${esc(period.label)}</title>
<style>
  *{box-sizing:border-box} body{font:13px/1.45 "Segoe UI",system-ui,sans-serif;color:#14213d;margin:28px}
  header{display:flex;justify-content:space-between;border-bottom:3px solid #1864cc;padding-bottom:10px;margin-bottom:14px}
  h1{margin:0;font-size:20px;color:#0b3d91} .muted{color:#5b6b86}
  dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin:0 0 16px} dt{font-size:11px;color:#5b6b86} dd{margin:0;font-weight:600}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  table{width:100%;border-collapse:collapse} th{text-align:left;background:#e8f0fc;color:#0b2558;padding:6px 8px;font-size:12px}
  td{padding:6px 8px;border-bottom:1px solid #edf1f7;vertical-align:top} td small{display:block;color:#5b6b86;font-size:11px}
  .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} tfoot td{font-weight:700;border-top:2px solid #0b3d91}
  .net{margin-top:16px;display:flex;justify-content:space-between;align-items:center;background:#0b3d91;color:#fff;padding:12px 16px;border-radius:8px;font-size:16px;font-weight:700}
  .employer{margin-top:10px;padding:8px 12px;border:1px dashed #9db6dc;border-radius:8px;display:flex;justify-content:space-between}
  footer{margin-top:16px;font-size:11px;color:#5b6b86}
  @media print{body{margin:12mm}}
</style></head><body>
<header><div><h1>Payslip</h1><div class="muted">${esc(m.period)}</div></div><div style="text-align:right"><strong>${esc(line.companyName)}</strong><div class="muted">${esc(m.status)}</div></div></header>
<dl>${m.employee.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<div class="cols">
  <table><thead><tr><th>Earnings</th><th class="n">GH₵</th></tr></thead><tbody>${rows(m.earnings)}</tbody><tfoot><tr><td>Gross earnings</td><td class="n">${esc(cedis(m.gross))}</td></tr></tfoot></table>
  <table><thead><tr><th>Deductions</th><th class="n">GH₵</th></tr></thead><tbody>${rows(m.deductions)}</tbody><tfoot><tr><td>Total deductions</td><td class="n">${esc(cedis(m.totalDeductions))}</td></tr></tfoot></table>
</div>
${m.adjustments.length ? `<table style="margin-top:14px"><thead><tr><th>Adjustments after approval</th><th class="n">GH₵</th></tr></thead><tbody>${rows(m.adjustments)}</tbody></table>` : ''}
<div class="net"><span>Take-home pay</span><span>${esc(cedis(m.takeHome))}</span></div>
<div class="employer"><span>Employer SSNIT contribution (${m.employerRate}% of basic) — paid by the company, not deducted</span><strong>${esc(cedis(m.employerSsnit))}</strong></div>
<footer>Tax method: ${esc(m.taxMethod)} · Rules: ${esc(m.rules)} · Generated ${esc(new Date().toLocaleString('en-GH'))}</footer>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150))</script>
</body></html>`
}

/** Open the payslip in a new window and print it. */
export function printPayslip(line, period) {
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return false
  w.document.open()
  w.document.write(payslipHtml(line, period))
  w.document.close()
  return true
}

/** A4 PDF payslip. */
export function payslipPdf(line, period) {
  const m = payslipModel(line, period)
  const pdf = createPdf().addPage()
  const M = 40
  const R = pdf.width - M
  pdf.rect(0, 0, pdf.width, 8, { fill: '#1864cc' })
  pdf.text(M, 48, 'Payslip', { size: 22, bold: true, color: '#0b3d91' })
  pdf.text(M, 66, m.period, { size: 10, color: '#5b6b86' })
  pdf.text(R, 48, line.companyName, { size: 13, bold: true, align: 'right' })
  pdf.text(R, 66, m.status, { size: 10, color: '#5b6b86', align: 'right' })
  pdf.line(M, 80, R, 80, { color: '#1864cc', width: 1.4 })

  let y = 100
  m.employee.forEach(([k, v], i) => {
    const col = i % 3
    const x = M + col * ((R - M) / 3)
    if (col === 0 && i) y += 30
    pdf.text(x, y, k, { size: 8, color: '#5b6b86' })
    pdf.text(x, y + 13, pdf.fit(v, (R - M) / 3 - 10, 10.5, true), { size: 10.5, bold: true })
  })
  y += 44

  const colW = (R - M - 18) / 2
  const block = (x, title, items, totalLabel, total) => {
    let yy = y
    pdf.rect(x, yy, colW, 18, { fill: '#e8f0fc' })
    pdf.text(x + 8, yy + 12.5, title, { size: 10, bold: true, color: '#0b2558' })
    pdf.text(x + colW - 8, yy + 12.5, 'GH₵', { size: 10, bold: true, color: '#0b2558', align: 'right' })
    yy += 30
    items.forEach((it) => {
      pdf.text(x + 8, yy, pdf.fit(it.label, colW - 100, 9.5), { size: 9.5 })
      pdf.text(x + colW - 8, yy, cedis(it.amount), { size: 9.5, align: 'right' })
      if (it.note) { yy += 11; pdf.text(x + 8, yy, pdf.fit(it.note, colW - 16, 7.5), { size: 7.5, color: '#5b6b86' }) }
      yy += 8
      pdf.line(x, yy, x + colW, yy, { color: '#edf1f7', width: 0.5 })
      yy += 12
    })
    pdf.line(x, yy - 6, x + colW, yy - 6, { color: '#0b3d91', width: 1 })
    pdf.text(x + 8, yy + 6, totalLabel, { size: 10, bold: true })
    pdf.text(x + colW - 8, yy + 6, cedis(total), { size: 10, bold: true, align: 'right' })
    return yy + 18
  }
  const yLeft = block(M, 'Earnings', m.earnings, 'Gross earnings', m.gross)
  const yRight = block(M + colW + 18, 'Deductions', m.deductions, 'Total deductions', m.totalDeductions)
  y = Math.max(yLeft, yRight) + 8

  if (m.adjustments.length) {
    pdf.text(M, y, 'Adjustments after approval', { size: 10, bold: true, color: '#0b2558' })
    y += 16
    m.adjustments.forEach((a) => {
      pdf.text(M + 8, y, pdf.fit(`${a.label}: ${a.note}`, R - M - 120, 9), { size: 9 })
      pdf.text(R - 8, y, cedis(a.amount), { size: 9, align: 'right' })
      y += 15
    })
    y += 4
  }

  pdf.rect(M, y, R - M, 34, { fill: '#0b3d91' })
  pdf.text(M + 14, y + 22, 'Take-home pay', { size: 14, bold: true, color: '#ffffff' })
  pdf.text(R - 14, y + 22, cedis(m.takeHome), { size: 14, bold: true, color: '#ffffff', align: 'right' })
  y += 48
  pdf.rect(M, y, R - M, 26, { fill: '#f5f8fd', stroke: '#9db6dc' })
  pdf.text(M + 12, y + 16.5, `Employer SSNIT (${m.employerRate}% of basic) — paid by the company, not deducted`, { size: 9, color: '#14213d' })
  pdf.text(R - 12, y + 16.5, cedis(m.employerSsnit), { size: 9.5, bold: true, align: 'right' })
  y += 44
  pdf.text(M, y, `Tax method: ${m.taxMethod} · Rules: ${m.rules}`, { size: 8, color: '#5b6b86' })
  pdf.text(M, y + 12, `Generated ${new Date().toLocaleString('en-GH')}`, { size: 8, color: '#5b6b86' })
  return pdf.toBlob()
}
