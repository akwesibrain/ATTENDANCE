import { BATCH_STATUS, RECORD_STATUS } from '../../constants/historicalImportLabels'

export function BatchStatusBadge({ status }) {
  const meta = BATCH_STATUS[status] ?? { label: status, tone: 'muted' }
  return <span className={`at-badge at-tone-${meta.tone}`}>{meta.label}</span>
}

export function RecordStatusBadge({ status }) {
  const meta = RECORD_STATUS[status] ?? { label: status, tone: 'muted' }
  return <span className={`at-badge at-tone-${meta.tone}`}>{meta.label}</span>
}

/** Data-quality flags; errors first. */
export function FlagList({ flags, compact = false }) {
  if (!flags?.length) return compact ? <span className="at-none">—</span> : null
  const sorted = flags.slice().sort((a, b) => (a.level === 'error' ? -1 : 0) - (b.level === 'error' ? -1 : 0))
  return (
    <ul className={`hi-flags${compact ? ' is-compact' : ''}`}>
      {sorted.map((f) => (
        <li key={f.code} className={`hi-flag hi-flag-${f.level}`} title={f.detail}>
          {f.label}
          {!compact && f.detail && <span className="hi-flag-detail">{f.detail}</span>}
        </li>
      ))}
    </ul>
  )
}
