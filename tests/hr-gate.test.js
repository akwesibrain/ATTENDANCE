import { describe, expect, it } from 'vitest'

import { gateStep } from '../src/components/access/gateStep.js'

describe('gateStep (the HR portal never opens without a signed-in user)', () => {
  it('opens the portal when the session is ready and the user is known', () => {
    expect(gateStep('ready', { id: 'u1' })).toBe('portal')
  })
  it('checks the session again instead of crashing when the user is missing', () => {
    // Seen after a hot reload, and possible if sign-out clears the user before the session event arrives.
    expect(gateStep('ready', null)).toBe('recheck')
  })
  it('passes every other state through', () => {
    for (const status of ['loading', 'signed-out', 'mfa-enroll', 'mfa-verify', 'expired', 'error', 'no-access']) {
      expect(gateStep(status, null)).toBe(status)
    }
  })
})
