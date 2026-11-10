import { timeToMinutes } from '../../supabase/functions/_shared/rules/overtime.js'

/** "9:05 AM" for a time of day such as "09:05". */
export function formatClock(time) {
  if (!time) return '—'
  const minutes = timeToMinutes(time)
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}
