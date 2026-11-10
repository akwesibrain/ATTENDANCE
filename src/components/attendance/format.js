/** Display helpers for attendance records (Africa/Accra time). */

import { formatAccraTime } from '../../utils/accraTime'

/** Clock time, or "Unknown" for unreadable historical values. */
export function clockText(iso, unknown) {
  if (unknown) return 'Unknown'
  return iso ? formatAccraTime(iso) : '—'
}

export function durationText(minutes) {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export function arrivalText(record) {
  if (record.lateUnknown) return 'Unknown'
  if (record.arrivalDiffMinutes == null) return '—'
  const diff = record.arrivalDiffMinutes
  if (!record.workday) return 'Not applicable (not a working day)'
  if (diff === 0) return 'Exactly on time'
  const abs = Math.abs(diff)
  const amount = abs >= 60 ? durationText(abs) : `${abs} min`
  return diff < 0 ? `${amount} early` : `${amount} after start time`
}

export function initials(name) {
  return (name ?? '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
}
