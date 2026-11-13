/** Shared label/class maps for the Merchandiser Monitoring module. */

export const REP_STATUS = {
  'not-checked-in': { label: 'Not Checked In', className: 'sm-status-not-checked-in' },
  'on-duty-verified': { label: 'On Duty — Verified', className: 'sm-status-on-duty' },
  'awaiting-verification': { label: 'Awaiting Verification', className: 'sm-status-awaiting' },
  'verification-missed': { label: 'Verification Missed', className: 'sm-status-missed' },
  'location-exception': { label: 'Location Exception', className: 'sm-status-location' },
  'face-verification-failed': { label: 'Face Verification Failed', className: 'sm-status-face-failed' },
  'checked-out': { label: 'Checked Out', className: 'sm-status-checked-out' },
  'on-leave': { label: 'On Approved Leave', className: 'sm-status-on-leave' },
  'rest-day': { label: 'Not Scheduled', className: 'sm-status-rest-day' },
}

export const RESULT_LABELS = {
  verified: 'Verified',
  missed: 'Missed',
  'failed-face': 'Failed Face Verification',
  'outside-shop': 'Outside Assigned Shop',
  'gps-unavailable': 'GPS Unavailable',
  'sms-failed': 'SMS Delivery Failed',
  pending: 'Pending',
}

export const ALERT_STATUS_LABELS = {
  new: 'New',
  'under-review': 'Under Review',
  resolved: 'Resolved',
}

export function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function initials(name) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
}
