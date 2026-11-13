/**
 * Ghana statutory payroll rules, effective-dated.
 *
 * FRONTEND CONFIGURATION — VERIFY BEFORE LIVE PAYROLL. The figures below are
 * the monthly PAYE bands for resident individuals published by the Ghana
 * Revenue Authority from 1 January 2024, and the SSNIT contribution rates
 * under the National Pensions Act, 2008 (Act 766). Rates change by law: add a
 * new version with its effective date rather than editing an old one, so past
 * payroll periods keep the rules that applied to them.
 *
 * Not modelled yet (see docs/backend-payroll.md): the concessionary overtime
 * and bonus tax rates, tax reliefs, the SSNIT maximum insurable earnings cap,
 * non-resident rates and Tier 3 voluntary contributions.
 */

export const GH_STATUTORY_VERSIONS = [
  {
    id: 'gh-2024-01',
    effectiveFrom: '2024-01-01',
    label: 'SSNIT rates · Act 766',
    // [band width in GH₵ per month, rate %]. The last band has no upper limit.
    payeBands: [
      [490, 0],
      [110, 5],
      [130, 10],
      [3166.67, 17.5],
      [16000, 25],
      [30520, 30],
      [Infinity, 35],
    ],
    ssnitEmployeeRate: 5.5,
    ssnitEmployerRate: 13,
    ssnitBase: 'basic', // SSNIT is charged on basic salary
  },
]

/** The statutory rules in force on a date (YYYY-MM-DD). */
export function statutoryRulesFor(dateKey) {
  const inForce = GH_STATUTORY_VERSIONS
    .filter((v) => v.effectiveFrom <= dateKey)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
  return inForce[0] ?? GH_STATUTORY_VERSIONS[0]
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100

/** Monthly PAYE on chargeable income, band by band. */
export function payeFromBands(chargeable, bands) {
  let left = Math.max(0, Number(chargeable) || 0)
  let tax = 0
  for (const [width, rate] of bands) {
    if (left <= 0) break
    const slice = Math.min(left, width)
    tax += (slice * rate) / 100
    left -= slice
  }
  return round2(tax)
}

/** Rows for showing the bands on screen: "First GH₵490 · 0%", "Next GH₵110 · 5%", … */
export function describeBands(bands) {
  let from = 0
  return bands.map(([width, rate], i) => {
    const row = { from, to: Number.isFinite(width) ? round2(from + width) : null, width, rate, first: i === 0 }
    from = round2(from + (Number.isFinite(width) ? width : 0))
    return row
  })
}
