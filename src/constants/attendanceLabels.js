/** Labels shared by the attendance service (CSV) and the attendance UI. */

export const ATTENDANCE_STATUS = {
  present: { label: 'Present', tone: 'ok' },
  late: { label: 'Late', tone: 'warn' },
  absent: { label: 'Absent', tone: 'crit' },
  'on-leave': { label: 'On Leave', tone: 'info' },
  incomplete: { label: 'Incomplete', tone: 'alert' },
  unknown: { label: 'Unknown', tone: 'muted' },
  awaiting: { label: 'Awaiting Clock-In', tone: 'pending' },
  scheduled: { label: 'Day Not Started', tone: 'muted' },
  'rest-day': { label: 'Rest Day', tone: 'muted' },
  holiday: { label: 'Public Holiday', tone: 'muted' },
}

export const VERIFICATION_STATUS = {
  verified: { label: 'Verified', tone: 'ok' },
  failed: { label: 'Failed', tone: 'crit' },
  pending: { label: 'Pending', tone: 'pending' },
  review: { label: 'Needs Review', tone: 'warn' },
  manual: { label: 'Manual Entry', tone: 'muted' },
  'not-verified': { label: 'Not Verified', tone: 'muted' },
  none: { label: 'None', tone: 'none' },
}

export const ATTENDANCE_SOURCE = {
  digital: { label: 'Digital attendance', short: 'Digital' },
  'sms-verification': { label: 'Sales rep SMS verification', short: 'SMS verification' },
  historical: { label: 'Historical – Manually Recorded', short: 'Historical' },
  'hr-correction': { label: 'HR manual correction', short: 'HR correction' },
}

export { CORRECTION_REASONS } from '../../supabase/functions/_shared/rules/records.js'

export function sourceLabel(source) {
  return ATTENDANCE_SOURCE[source]?.label ?? 'No record'
}
