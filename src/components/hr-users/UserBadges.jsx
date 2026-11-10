import { ROLES } from '../../services/permissionsService'

const ACCOUNT = {
  active: { label: 'Active', tone: 'ok' },
  inactive: { label: 'Inactive', tone: 'muted' },
  pending: { label: 'Pending invitation', tone: 'pending' },
}

const INVITE = {
  draft: { label: 'Draft', tone: 'muted' },
  sent: { label: 'Invitation Sent (Demo)', tone: 'pending' },
  accepted: { label: 'Accepted (Demo)', tone: 'ok' },
  expired: { label: 'Expired', tone: 'warn' },
}

export function RoleBadge({ roleId }) {
  return <span className={`hu-role hu-role-${roleId}`}>{ROLES[roleId]?.label ?? roleId}</span>
}

export function AccountStatusBadge({ status }) {
  const m = ACCOUNT[status] ?? { label: status, tone: 'muted' }
  return <span className={`at-badge at-tone-${m.tone}`}>{m.label}</span>
}

export function InvitationBadge({ status }) {
  const m = INVITE[status] ?? { label: status, tone: 'muted' }
  return <span className={`at-badge at-tone-${m.tone}`}>{m.label}</span>
}

