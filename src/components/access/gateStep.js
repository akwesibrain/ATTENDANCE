/**
 * What the gate shows. A ready session without a known user (after a hot
 * reload, or if sign-out clears the user before its event arrives) is checked
 * again rather than opening the portal with no user.
 */
export function gateStep(status, user) {
  if (status !== 'ready') return status
  return user ? 'portal' : 'recheck'
}
