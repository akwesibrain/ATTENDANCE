/**
 * Details used by the Privacy Policy, Terms and Conditions, Tracking Policy
 * and Cookie Policy (src/content/legalDocs.js).
 *
 * Fill in every `null` before the app goes live. While any required detail is
 * missing, each policy shows a "Draft" banner and the gap is highlighted in
 * the text. Have a lawyer in Ghana review the policies before publishing.
 */
export const LEGAL = {
  version: '1.0',
  effectiveDate: '11 November 2026',

  /** The employers responsible for the data (data controllers). */
  employers: [
    { name: 'Box For Less', legalName: null },
    { name: 'Double A', legalName: null },
  ],

  /** Where staff send privacy questions and requests. */
  contact: {
    email: null,
    phone: null,
    address: null,
    /** Person or role handling data protection (Data Protection Supervisor). */
    officer: null,
  },

  /** Registration number with the Data Protection Commission, Ghana. */
  dpcRegistration: null,

  /**
   * How long each kind of data is kept. PROPOSED values — confirm them with
   * management and your lawyer. `liveTrail` matches what the app does today:
   * the detailed live-location trail is kept only for the current day.
   */
  retention: {
    employeeRecord: 'for as long as you work for us, and 6 years after you leave',
    facePhoto: 'for as long as you work for us; it is deleted within 30 days after you leave',
    attendance: '6 years',
    visits: '6 years',
    liveTrail: 'until the end of the same working day',
    /** Daily tracking summary (time tracked, coverage, distance — no positions). */
    trackingSummary: '6 years',
    failedScans: 'until the end of the same day',
    auditLog: '6 years',
    hrAccounts: 'for as long as the HR user has access, and 2 years after',
  },
}

/** Values the policy text can insert with {{key}}. Missing ones show as gaps. */
export function legalValues() {
  const names = LEGAL.employers.map((e) => e.legalName ?? e.name)
  return {
    employers: names.join(' and '),
    employerLegalNames: LEGAL.employers.every((e) => e.legalName) ? names.join(' and ') : null,
    email: LEGAL.contact.email,
    phone: LEGAL.contact.phone,
    address: LEGAL.contact.address,
    officer: LEGAL.contact.officer,
    dpcRegistration: LEGAL.dpcRegistration,
    effectiveDate: LEGAL.effectiveDate,
    version: LEGAL.version,
    ...Object.fromEntries(Object.entries(LEGAL.retention).map(([k, v]) => [`retention.${k}`, v])),
  }
}

/** Labels for the gaps shown while a detail is missing. */
export const LEGAL_GAP_LABELS = {
  employerLegalNames: 'registered company names',
  email: 'privacy contact email',
  phone: 'privacy contact phone',
  address: 'company address',
  officer: 'data protection contact person',
  dpcRegistration: 'Data Protection Commission registration number',
}

export function legalIsDraft() {
  const v = legalValues()
  return Object.keys(LEGAL_GAP_LABELS).some((k) => !v[k])
}
