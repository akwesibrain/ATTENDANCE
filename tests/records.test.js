import { describe, expect, it } from 'vitest'
import {
  buildRecord,
  buildRecords,
  createRecordContext,
  employmentStartFor,
  previewManualEntries,
  recordKey,
  validateCorrection,
} from '../supabase/functions/_shared/rules/records.js'
import { calculateRecordOvertime } from '../supabase/functions/_shared/rules/overtime.js'

/** 2026-11-09 is a Monday. */
const MON = '2026-11-09'
const TUE = '2026-11-10'
const SAT = '2026-11-07'

const HOURS = {
  effectiveFrom: '2000-01-01',
  workingDays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  lateAfter: '09:00',
  endTime: '17:00',
  overtimeStart: '17:01',
  breakStart: '12:30',
  breakMinutes: 0,
}

const emp = {
  employeeId: 'BFL-0001',
  fullName: 'Test Person',
  companyId: 'box-for-less',
  companyName: 'Box For Less',
  position: 'Cashier',
  isFieldRole: false,
  shopId: null,
  employmentStart: '2026-10-05',
}

const iso = (date, time) => `${date}T${time}:00.000Z`
const event = (date, type, time) => ({ staffId: emp.employeeId, date, type, time: iso(date, time) })

function context(overrides = {}) {
  return createRecordContext({
    now: new Date(iso(TUE, '12:00')),
    events: [],
    corrections: {},
    customHolidays: [],
    leaves: [],
    shopsById: new Map(),
    hoursFor: () => HOURS,
    attendanceRulesFor: () => ({ clockOutWindowMinutes: 120 }),
    ...overrides,
  })
}

const record = (date, overrides) => buildRecord(emp, date, context(overrides))

describe('one record per employee per day', () => {
  it('produces a single record whatever the sources', () => {
    const key = recordKey(emp.employeeId, MON)
    const ctx = context({
      events: [event(MON, 'check-in', '08:00'), event(MON, 'check-out', '17:00')],
      corrections: { [key]: { manualType: 'corrected', entryMethod: 'correction', clockIn: iso(MON, '07:45'), clockOut: iso(MON, '17:30'), history: [] } },
    })
    const list = buildRecords([emp], [MON], ctx)
    expect(list).toHaveLength(1)
    expect(list[0].clockIn).toBe(iso(MON, '07:45'))
    expect(list[0].source).toBe('hr-correction')
  })
})

describe('lateness', () => {
  it('is on time at 09:00 and late after', () => {
    expect(record(MON, { events: [event(MON, 'check-in', '09:00'), event(MON, 'check-out', '17:00')] }).status).toBe('present')
    const late = record(MON, { events: [event(MON, 'check-in', '09:01'), event(MON, 'check-out', '17:00')] })
    expect(late.status).toBe('late')
    expect(late.lateMinutes).toBe(61)
  })
})

describe('absence', () => {
  it('is never recorded before the working day has ended', () => {
    expect(record(TUE, { now: new Date(iso(TUE, '07:00')) }).status).toBe('scheduled')
    expect(record(TUE, { now: new Date(iso(TUE, '12:00')) }).status).toBe('awaiting')
    expect(record(TUE, { now: new Date(iso(TUE, '16:59')) }).status).toBe('awaiting')
  })

  it('is recorded once the working day has ended with no clock-in', () => {
    expect(record(TUE, { now: new Date(iso(TUE, '17:00')) }).status).toBe('absent')
    expect(record(MON).status).toBe('absent')
  })

  it('is never recorded on weekends, holidays or approved leave', () => {
    expect(record(SAT).status).toBe('rest-day')
    expect(record(MON, { customHolidays: [{ date: MON, name: 'Declared day' }] }).status).toBe('holiday')
    const leaves = [{ employeeId: emp.employeeId, leaveType: 'Annual leave', startDate: MON, endDate: MON, status: 'approved' }]
    expect(record(MON, { leaves }).status).toBe('on-leave')
  })

  it('still counts a pending leave request as absent', () => {
    const leaves = [{ employeeId: emp.employeeId, leaveType: 'Annual leave', startDate: MON, endDate: MON, status: 'pending' }]
    expect(record(MON, { leaves }).status).toBe('absent')
  })

  it('is not guessed before digital go-live', () => {
    expect(record('2026-09-14').status).toBe('unknown')
  })

  it('is marked after 5 failed face scans, with the reason', () => {
    const r = record(MON, { events: [{ ...event(MON, 'absent', '08:30'), reason: 'Failed scans' }] })
    expect(r.status).toBe('absent')
    expect(r.explicitAbsentReason).toBe('Failed scans')
  })
})

describe('incomplete days', () => {
  it('stays at work until the check-out window closes, then is incomplete', () => {
    const events = [event(TUE, 'check-in', '08:00')]
    expect(record(TUE, { events, now: new Date(iso(TUE, '18:59')) }).atWork).toBe(true)
    expect(record(TUE, { events, now: new Date(iso(TUE, '19:00')) }).status).toBe('incomplete')
  })
})

describe('holiday recalculation', () => {
  const events = [event(MON, 'check-in', '10:00'), event(MON, 'check-out', '12:00')]
  const overtimeFor = (r, holidayName) => calculateRecordOvertime(r, { rate: 60, holidayName, hours: HOURS })

  it('turns an absence into a holiday, then reverses', () => {
    expect(record(MON).status).toBe('absent')
    expect(record(MON, { customHolidays: [{ date: MON, name: 'Declared day' }] }).status).toBe('holiday')
    expect(record(MON, { customHolidays: [] }).status).toBe('absent')
  })

  it('turns the work into full-day overtime, then reverses', () => {
    const holiday = record(MON, { events, customHolidays: [{ date: MON, name: 'Declared day' }] })
    expect(overtimeFor(holiday, holiday.holidayName).minutes).toBe(120)
    const normal = record(MON, { events })
    expect(overtimeFor(normal, normal.holidayName).status).toBe('none')
  })
})

describe('effective-dated settings', () => {
  it('changes only the days from the effective date', () => {
    const LATER = { ...HOURS, effectiveFrom: TUE, lateAfter: '08:30', startTime: '08:00' }
    const hoursFor = (_company, date) => (date >= TUE ? LATER : HOURS)
    const events = [
      event(MON, 'check-in', '08:45'), event(MON, 'check-out', '17:00'),
      event(TUE, 'check-in', '08:45'), event(TUE, 'check-out', '11:00'),
    ]
    expect(record(MON, { events, hoursFor }).status).toBe('present')
    expect(record(TUE, { events, hoursFor }).status).toBe('late')
  })
})

describe('employment start', () => {
  it('is the later of the joining and registration dates', () => {
    expect(employmentStartFor('2026-01-01', '2026-10-05T09:00:00Z')).toBe('2026-10-05')
    expect(employmentStartFor('2026-11-01', '2026-10-05T09:00:00Z')).toBe('2026-11-01')
  })

  it('lists no days before it, unless HR entered one', () => {
    const before = '2026-10-02'
    expect(buildRecords([emp], [before], context())).toHaveLength(0)
    const corrections = { [recordKey(emp.employeeId, before)]: { manualType: 'created', entryMethod: 'manual-entry', clockIn: iso(before, '08:00'), clockOut: iso(before, '17:00'), history: [] } }
    expect(buildRecords([emp], [before], context({ corrections }))).toHaveLength(1)
  })

  it('never lists future dates', () => {
    expect(buildRecords([emp], ['2026-11-11'], context())).toHaveLength(0)
  })
})

describe('SMS verification for field staff', () => {
  const field = { ...emp, isFieldRole: true }
  const missed = { eventId: 'e1', result: 'missed', dispatchedAt: iso(MON, '10:00'), respondedAt: null, gpsVerificationStatus: 'pending' }
  const smsDay = () => ({ events: [missed] })

  it('does not turn a missed check into an absence', () => {
    const events = [event(MON, 'check-in', '08:00'), event(MON, 'check-out', '17:00')]
    const r = buildRecord(field, MON, context({ events, smsDay }))
    expect(r.status).toBe('present')
    expect(r.verification).toBe('review')
    expect(r.notes.join(' ')).toMatch(/does not make the employee absent/)
  })

  it('keeps the kiosk clock-in as the source of the record', () => {
    const events = [event(MON, 'check-in', '08:00')]
    expect(buildRecord(field, MON, context({ events, smsDay })).source).toBe('digital')
  })

  it('ignores SMS data for non-field staff', () => {
    expect(buildRecord(emp, MON, context({ smsDay })).smsEvents).toHaveLength(0)
  })
})

describe('corrections', () => {
  const rules = { minRemarks: 10, today: TUE, nowMs: Date.parse(iso(TUE, '12:00')) }
  const valid = { employeeId: emp.employeeId, date: MON, clockInTime: '08:00', clockOutTime: '17:00', reason: 'Other', remarks: 'Checked against the register.' }

  it('accepts a valid correction', () => {
    expect(validateCorrection(valid, record(MON), rules)).toEqual({})
  })

  it('refuses future dates and times', () => {
    expect(validateCorrection({ ...valid, date: '2026-11-11' }, record(MON), rules).date).toMatch(/future/)
    expect(validateCorrection({ ...valid, date: TUE, clockInTime: '13:00', clockOutTime: '' }, record(TUE), rules).clockInTime).toMatch(/future/)
  })

  it('needs a known reason and enough remarks', () => {
    const errors = validateCorrection({ ...valid, reason: 'Because', remarks: 'short' }, record(MON), rules)
    expect(errors.reason).toBeDefined()
    expect(errors.remarks).toBeDefined()
  })

  it('refuses clock-out before clock-in', () => {
    expect(validateCorrection({ ...valid, clockOutTime: '07:00' }, record(MON), rules).clockOutTime).toMatch(/later/)
  })

  it('refuses a change that alters nothing', () => {
    const events = [event(MON, 'check-in', '08:00'), event(MON, 'check-out', '17:00')]
    expect(validateCorrection(valid, record(MON, { events }), rules).form).toMatch(/nothing to change/)
  })

  it('refuses a day on approved leave', () => {
    const leaves = [{ employeeId: emp.employeeId, leaveType: 'Annual leave', startDate: MON, endDate: MON, status: 'approved' }]
    expect(validateCorrection(valid, record(MON, { leaves }), rules).date).toMatch(/leave/)
  })
})

describe('manual entries', () => {
  const row = { date: MON, clockInTime: '08:00', clockOutTime: '17:00' }

  it('marks a day with no record as new', () => {
    expect(previewManualEntries(emp, [row], context())[0].state).toBe('new')
  })

  it('marks a day with a kiosk record as needing review', () => {
    const events = [event(MON, 'check-in', '08:00')]
    expect(previewManualEntries(emp, [row], context({ events }))[0].state).toBe('exists-system')
  })

  it('refuses the same date twice and future dates', () => {
    expect(previewManualEntries(emp, [row, row], context())[0].errors.date).toMatch(/more than once/)
    expect(previewManualEntries(emp, [{ ...row, date: '2026-11-11' }], context())[0].state).toBe('blocked')
  })
})
