import { describe, expect, it } from 'vitest'
import { detectVisitIssues } from '../supabase/functions/_shared/rules/notifications.js'
import { NOTIFICATION_TYPES } from '../supabase/functions/_shared/rules/notificationTypes.js'

const employee = { employeeId: 'BFL-0007', fullName: 'Ama Owusu', companyId: 'box-for-less', companyName: 'Box For Less', position: 'Sales Representative' }
const proof = ({ listed = [], offList = [] }) => ({ listed, offList, counts: {} })
const listed = (shopId, status) => ({ shopId, status, scans: 1, scanned: true, stayMinutes: 4, closestM: 20 })
const visit = (id, shopId, name = null) => ({ id, time: '2026-11-12T09:00:00Z', outlet: { shopId, name, town: name ? 'Osu' : null }, onList: false, distanceM: null, status: 'recorded' })

function run(days) {
  const issues = []
  detectVisitIssues(days, (issue) => issues.push(issue))
  return issues
}

describe('visit alerts', () => {
  it('waits for the end of the day before saying a visit was not proven', () => {
    const day = { employee, date: '2026-11-12', proof: proof({ listed: [listed('s1', 'no-stay')] }) }
    expect(run([{ ...day, dayOver: false }])).toEqual([])
    const [issue] = run([{ ...day, dayOver: true }])
    expect(issue.type).toBe('visit-not-proven')
    expect(issue.sourceKey).toBe('visit-no-stay:BFL-0007:2026-11-12:s1')
    expect(issue.relatedDate).toBe('2026-11-12')
    expect(issue.description).toContain('This is a reason to ask, not proof of misconduct. Attendance is not changed.')
  })

  it('raises a missed shop only after the day', () => {
    const day = { employee, date: '2026-11-12', proof: proof({ listed: [listed('s2', 'missed')] }) }
    expect(run([{ ...day, dayOver: true }]).map((i) => [i.type, i.sourceKey])).toEqual([['shop-missed', 'visit-missed:BFL-0007:2026-11-12:s2']])
  })

  it('raises off-list and typed-in visits straight away, keyed by visit', () => {
    const day = { employee, date: '2026-11-12', dayOver: false, proof: proof({ offList: [{ visit: visit('v1', 's9'), status: 'off-list' }, { visit: visit('v2', null, 'Mama Shop'), status: 'not-in-list' }] }) }
    const issues = run([day])
    expect(issues.map((i) => [i.type, i.sourceKey])).toEqual([['visit-off-list', 'visit-off-list:v1'], ['visit-off-list', 'visit-off-list:v2']])
    expect(issues[1].description).toContain('Mama Shop')
  })

  it('raises nothing for proven, pending or unmeasured shops', () => {
    const day = { employee, date: '2026-11-12', dayOver: true, proof: proof({ listed: [listed('a', 'proven'), listed('b', 'pending'), listed('c', 'unmeasured')] }) }
    expect(run([day])).toEqual([])
  })

  it('registers the three types under Sales Rep Monitoring', () => {
    expect(NOTIFICATION_TYPES['visit-not-proven']).toMatchObject({ category: 'sales-monitoring', severity: 'medium', kind: 'exception' })
    expect(NOTIFICATION_TYPES['shop-missed']).toMatchObject({ category: 'sales-monitoring', severity: 'medium', kind: 'exception' })
    expect(NOTIFICATION_TYPES['visit-off-list']).toMatchObject({ category: 'sales-monitoring', severity: 'low', kind: 'exception' })
  })
})
