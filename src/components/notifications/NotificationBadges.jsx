import { NOTIFICATION_STATUSES, SEVERITIES } from '../../constants/notificationTypes'

export function SeverityBadge({ severity }) {
  return (
    <span className={`nt-sev nt-sev-${severity}`}>
      <span className="nt-sev-mark" aria-hidden="true" />
      {SEVERITIES[severity]?.label ?? severity}
    </span>
  )
}

export function NotificationStatusBadge({ status }) {
  return <span className={`nt-status nt-status-${status}`}>{NOTIFICATION_STATUSES[status] ?? status}</span>
}
