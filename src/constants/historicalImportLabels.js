/** Labels for the Historical Attendance Import module. */

export const HISTORICAL_SOURCE_LABEL = 'Historical – Manually Recorded'

export const BATCH_STATUS = {
  draft: { label: 'Draft', tone: 'muted' },
  returned: { label: 'Returned for changes', tone: 'warn' },
  submitted: { label: 'Awaiting review', tone: 'pending' },
  approved: { label: 'Approved', tone: 'ok' },
  'partially-approved': { label: 'Partially approved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'crit' },
}

export const RECORD_STATUS = {
  matched: { label: 'Matched', tone: 'info' },
  unmatched: { label: 'Unmatched', tone: 'crit' },
  'pending-review': { label: 'Pending Review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'crit' },
  incomplete: { label: 'Incomplete', tone: 'alert' },
}

/** What the notebook itself says. Nothing here is inferred. */
export const NOTEBOOK_STATUS = {
  present: 'Present',
  absent: 'Absent (written in notebook)',
  leave: 'Leave (written in notebook)',
  unclear: 'Unclear / unreadable entry',
}

export const MATCH_METHOD = {
  'auto-exact-id': 'Exact employee ID and name (automatic)',
  'confirmed-suggestion': 'Suggested match confirmed by HR',
  manual: 'Selected manually by HR',
}

export const FLAG_LABELS = {
  'invalid-date': 'Invalid date',
  'invalid-time': 'Invalid time',
  'missing-name': 'Name missing',
  'missing-arrival': 'Arrival time missing (Unknown)',
  'missing-departure': 'Departure time missing (Unknown)',
  'unreadable-time': 'Unreadable time (Unknown)',
  'unclear-entry': 'Unclear notebook entry',
  duplicate: 'Duplicate employee/date',
  'different-company': 'Employee from a different company',
  'uncertain-match': 'Uncertain employee match',
  'suggested-match': 'Suggested match not confirmed',
  'no-match': 'No matching employee found',
}
