import {
  ATTENDANCE_SOURCE,
  ATTENDANCE_STATUS,
  VERIFICATION_STATUS,
} from '../../constants/attendanceLabels'
import { recordOrigin } from '../../services/attendanceRecordsService'

export function StatusBadge({ status }) {
  const meta = ATTENDANCE_STATUS[status] ?? { label: status, tone: 'muted' }
  return <span className={`at-badge at-tone-${meta.tone}`}>{meta.label}</span>
}

export function VerificationBadge({ verification }) {
  const meta = VERIFICATION_STATUS[verification] ?? { label: verification, tone: 'muted' }
  if (meta.tone === 'none') return <span className="at-none">—</span>
  return <span className={`at-badge at-tone-${meta.tone}`}>{meta.label}</span>
}

/** Record source for HR: "Manual Entry" or "System Recorded", plus detail. */
export function SourceTag({ record }) {
  const origin = recordOrigin(record)
  if (!origin) return <span className="at-none">—</span>
  return (
    <span className={`at-source at-origin-${origin.kind}`} title={ATTENDANCE_SOURCE[record.source]?.label}>
      <span className={`at-origin-badge at-origin-badge-${origin.kind}`}>{origin.label}</span>
      <span className="at-source-detail">{origin.detail}</span>
    </span>
  )
}
