import { describe, expect, it } from 'vitest'
import { detectTrackingFlags } from '../supabase/functions/_shared/rules/notifications.js'
import { NOTIFICATION_TYPES } from '../supabase/functions/_shared/rules/notificationTypes.js'

const emp = { employeeId: 'BFL-0007', fullName: 'Ama Owusu', companyId: 'box-for-less', companyName: 'Box For Less', position: 'Sales Representative' }
const roster = new Map([[emp.employeeId, emp]])
const flag = (kind, extra = {}) => ({ staff_id: 'BFL-0007', company_id: 'box-for-less', date: '2026-11-12', kind, points: 3, first_at: '2026-11-12T09:00:00Z', last_at: '2026-11-12T09:30:00Z', ...extra })

function run(flags) {
  const issues = []
  detectTrackingFlags(flags, (issue) => issues.push(issue), roster)
  return issues
}

describe('tracking alerts', () => {
  it('raises a high-severity fake-location alert that never accuses', () => {
    const [issue] = run([flag('mock')])
    expect(issue.type).toBe('tracking-mock-location')
    expect(issue.severity).toBe('high')
    expect(issue.sourceKey).toBe('tracking-mock:BFL-0007:2026-11-12')
    expect(issue.relatedDate).toBe('2026-11-12')
    expect(issue.employeeId).toBe('BFL-0007')
    expect(issue.description).toContain('not proof of misconduct')
    expect(issue.description).toContain('Attendance is not changed')
  })

  it('raises an impossible-speed alert', () => {
    expect(run([flag('speed')])[0].type).toBe('tracking-impossible-speed')
  })

  it('skips people no longer on the roster', () => {
    expect(run([flag('mock', { staff_id: 'BFL-9999' })])).toEqual([])
  })

  it('registers both types under Sales Rep Monitoring', () => {
    expect(NOTIFICATION_TYPES['tracking-mock-location']).toMatchObject({ category: 'sales-monitoring', severity: 'high', kind: 'exception' })
    expect(NOTIFICATION_TYPES['tracking-impossible-speed']).toMatchObject({ category: 'sales-monitoring', severity: 'high', kind: 'exception' })
  })
})
