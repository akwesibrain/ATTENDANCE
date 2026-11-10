/** Notification categories, types, severities and statuses. */

export const NOTIFICATION_CATEGORIES = {
  attendance: 'Attendance',
  'sales-monitoring': 'Sales Rep Monitoring',
  'employee-shift': 'Employee & Shop',
  'system-data': 'System & Data',
}

/**
 * kind: 'exception' needs HR review (resolve or dismiss); 'notice' is
 * informational but can still be reviewed and closed.
 */
export const NOTIFICATION_TYPES = {
  // Attendance
  'late-clock-in': { category: 'attendance', label: 'Clocked in late', severity: 'low', kind: 'exception' },
  'no-clock-in': { category: 'attendance', label: 'Did not clock in', severity: 'medium', kind: 'exception' },
  'missing-clock-out': { category: 'attendance', label: 'Missing clock-out', severity: 'low', kind: 'exception' },
  'incomplete-record': { category: 'attendance', label: 'Incomplete attendance record', severity: 'medium', kind: 'exception' },
  'unusual-activity': { category: 'attendance', label: 'Unusual attendance activity', severity: 'high', kind: 'exception' },
  // Sales Rep Monitoring
  'sms-missed': { category: 'sales-monitoring', label: 'SMS verification missed', severity: 'medium', kind: 'exception' },
  'sms-delivery-failed': { category: 'sales-monitoring', label: 'SMS delivery failed', severity: 'medium', kind: 'exception' },
  'face-failed': { category: 'sales-monitoring', label: 'Face verification failed', severity: 'high', kind: 'exception' },
  'gps-failed': { category: 'sales-monitoring', label: 'GPS verification failed', severity: 'medium', kind: 'exception' },
  'outside-geofence': { category: 'sales-monitoring', label: 'Outside assigned shop geofence', severity: 'high', kind: 'exception' },
  'mobile-data-unavailable': { category: 'sales-monitoring', label: 'Mobile data unavailable during verification', severity: 'medium', kind: 'exception' },
  'rep-no-shop': { category: 'sales-monitoring', label: 'Sales representative has no assigned shop', severity: 'high', kind: 'exception' },
  // Employee & Shop (no-shift / shift-review are kept only so older
  // notifications still display; they are no longer raised.)
  'no-shift': { category: 'employee-shift', label: 'No assigned shift', severity: 'medium', kind: 'exception' },
  'no-shop-required': { category: 'employee-shift', label: 'No assigned shop (required for role)', severity: 'high', kind: 'exception' },
  'inactive-shop': { category: 'employee-shift', label: 'Assigned to an inactive shop', severity: 'high', kind: 'exception' },
  'shift-review': { category: 'employee-shift', label: 'Shift assignment requires review', severity: 'medium', kind: 'exception' },
  // System & Data
  'historical-verification': { category: 'system-data', label: 'Historical record requires verification', severity: 'low', kind: 'exception' },
  'duplicate-record': { category: 'system-data', label: 'Duplicate attendance record detected', severity: 'medium', kind: 'exception' },
  'correction-submitted': { category: 'system-data', label: 'Attendance correction submitted', severity: 'low', kind: 'notice' },
  'unusual-data': { category: 'system-data', label: 'Unusual or incomplete data detected', severity: 'medium', kind: 'exception' },
  'import-batch-submitted': { category: 'system-data', label: 'Historical import awaiting review', severity: 'low', kind: 'notice' },
  'import-unmatched': { category: 'system-data', label: 'Historical import record not matched', severity: 'medium', kind: 'exception' },
  'import-incomplete': { category: 'system-data', label: 'Historical import record incomplete', severity: 'low', kind: 'exception' },
}

export const SEVERITIES = {
  critical: { label: 'Critical', rank: 0 },
  high: { label: 'High', rank: 1 },
  medium: { label: 'Medium', rank: 2 },
  low: { label: 'Low', rank: 3 },
}

export const NOTIFICATION_STATUSES = {
  new: 'New',
  'under-review': 'Under Review',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}

export const OPEN_STATUSES = ['new', 'under-review']

export const RESOLUTION_ACTIONS = [
  'Confirmed with employee',
  'Confirmed with supervisor',
  'Attendance record corrected',
  'Shop assignment updated',
  'Technical issue logged',
  'No action required after review',
  'Other',
]
