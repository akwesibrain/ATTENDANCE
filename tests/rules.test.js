import { describe, expect, it } from 'vitest'
import { evaluateAction, isWeekend } from '../supabase/functions/_shared/rules/policy.js'
import { accraDateKey, addDaysToKey, dayOfWeekForKey } from '../supabase/functions/_shared/rules/accraTime.js'
import { calculateRecordOvertime, overtimeKindFor, overtimePay } from '../supabase/functions/_shared/rules/overtime.js'
import { holidayNameFor, holidaysInYear, validateHoliday } from '../supabase/functions/_shared/rules/holidays.js'
import { elapsedPeriodDateKeys, periodDateKeys, periodForDateKey } from '../supabase/functions/_shared/rules/attendanceRules.js'
import { tenureBetween } from '../supabase/functions/_shared/rules/tenure.js'

/** A Monday, Saturday and Sunday in Africa/Accra. */
const MON = '2026-11-09'
const SAT = '2026-11-07'
const SUN = '2026-11-08'
const at = (date, time) => new Date(`${date}T${time}:00Z`)

const HOURS = { endTime: '17:00', overtimeStart: '17:01' }

function record(date, clockIn, clockOut, extra = {}) {
  return {
    date,
    status: 'present',
    hasAttendance: true,
    expectedEnd: `${date}T17:00:00.000Z`,
    clockIn: clockIn ? `${date}T${clockIn}:00.000Z` : null,
    clockOut: clockOut ? `${date}T${clockOut}:00.000Z` : null,
    ...extra,
  }
}

const overtime = (r, context = {}) =>
  calculateRecordOvertime(r, { rate: 60, holidayName: null, hours: HOURS, ...context })

describe('time zone', () => {
  it('uses the Accra calendar date regardless of the device', () => {
    expect(accraDateKey(new Date('2026-11-09T23:59:59Z'))).toBe('2026-11-09')
    expect(accraDateKey(new Date('2026-11-10T00:00:00Z'))).toBe('2026-11-10')
  })

  it('knows the day of the week and steps across months', () => {
    expect(dayOfWeekForKey(MON)).toBe(1)
    expect(dayOfWeekForKey(SAT)).toBe(6)
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01')
  })
})

describe('check-in window', () => {
  it('refuses a weekday check-in before 06:00', () => {
    expect(evaluateAction('check-in', at(MON, '05:59')).allowed).toBe(false)
  })

  it('is on time from 06:00 up to and including 09:00', () => {
    expect(evaluateAction('check-in', at(MON, '06:00')).status).toBe('on-time')
    expect(evaluateAction('check-in', at(MON, '09:00')).status).toBe('on-time')
  })

  it('records a check-in after 09:00 as late', () => {
    const result = evaluateAction('check-in', at(MON, '09:01'))
    expect(result.allowed).toBe(true)
    expect(result.status).toBe('late')
  })
})

describe('check-out window', () => {
  it('refuses a weekday check-out before 17:00', () => {
    expect(evaluateAction('check-out', at(MON, '16:59')).allowed).toBe(false)
  })

  it('allows 17:00 to 18:59', () => {
    expect(evaluateAction('check-out', at(MON, '17:00')).allowed).toBe(true)
    expect(evaluateAction('check-out', at(MON, '18:59')).allowed).toBe(true)
  })

  it('records nothing from 19:00', () => {
    expect(evaluateAction('check-out', at(MON, '19:00')).allowed).toBe(false)
  })
})

describe('weekends', () => {
  it('are not bound by the check-in or check-out windows', () => {
    expect(isWeekend(at(SAT, '03:00'))).toBe(true)
    expect(isWeekend(at(SUN, '03:00'))).toBe(true)
    expect(evaluateAction('check-in', at(SAT, '03:00')).allowed).toBe(true)
    expect(evaluateAction('check-out', at(SUN, '22:00')).allowed).toBe(true)
  })
})

describe('overtime', () => {
  it('counts weekday time only after 17:01', () => {
    const result = overtime(record(MON, '08:00', '18:01'))
    expect(result.status).toBe('counted')
    expect(result.kind).toBe('after-hours')
    expect(result.minutes).toBe(60)
    expect(result.pay).toBe(60)
  })

  it('counts nothing for a weekday clock-out at or before 17:01', () => {
    expect(overtime(record(MON, '08:00', '17:01')).status).toBe('none')
    expect(overtime(record(MON, '08:00', '17:00')).status).toBe('none')
  })

  it('counts Saturday and Sunday from clock-in to clock-out', () => {
    expect(overtime(record(SAT, '10:00', '13:30')).minutes).toBe(210)
    expect(overtime(record(SUN, '10:00', '11:00')).kind).toBe('weekend')
  })

  it('counts a weekday holiday from clock-in to clock-out', () => {
    const result = overtime(record(MON, '10:00', '12:00'), { holidayName: 'Declared day' })
    expect(result.kind).toBe('holiday')
    expect(result.minutes).toBe(120)
  })

  it('reverses to after-hours rules when the holiday is removed', () => {
    const r = record(MON, '10:00', '12:00')
    expect(overtime(r, { holidayName: 'Declared day' }).status).toBe('counted')
    expect(overtime(r, { holidayName: null }).status).toBe('none')
  })

  it('uses the rate passed for that day and rounds to the pesewa', () => {
    expect(overtime(record(SAT, '10:00', '11:00'), { rate: 75 }).pay).toBe(75)
    expect(overtimePay(100, 33.33)).toBe(55.55)
  })

  it('excludes leave, missing clock-out, unknown and invalid times with a reason', () => {
    expect(overtime(record(MON, '08:00', '18:00', { status: 'on-leave' })).reason).toBe('Approved leave')
    expect(overtime(record(MON, '08:00', null, { status: 'incomplete' })).reason).toMatch(/no clock-out/)
    expect(overtime(record(MON, '08:00', '18:00', { clockOutUnknown: true })).reason).toMatch(/Unknown/)
    expect(overtime(record(MON, '18:00', '08:00')).reason).toMatch(/Invalid/)
  })

  it('skips a day still in progress', () => {
    expect(overtime(record(MON, '08:00', null)).status).toBe('skip')
  })

  it('picks the kind from the date and holiday', () => {
    expect(overtimeKindFor(MON, null)).toBe('after-hours')
    expect(overtimeKindFor(SAT, null)).toBe('weekend')
    expect(overtimeKindFor(SAT, 'Declared day')).toBe('holiday')
  })
})

describe('holidays', () => {
  const custom = [{ id: 'h1', date: '2026-11-09', name: 'Declared day' }]

  it('recognises recurring public holidays in any year', () => {
    expect(holidayNameFor('2031-03-06')).toBe('Independence Day')
  })

  it('recognises holidays set by HR, and not after removal', () => {
    expect(holidayNameFor('2026-11-09', custom)).toBe('Declared day')
    expect(holidayNameFor('2026-11-09', [])).toBeNull()
  })

  it('lists public and HR holidays in date order', () => {
    const list = holidaysInYear(2026, custom)
    expect(list.find((h) => h.date === '2026-11-09').kind).toBe('custom')
    expect(list.map((h) => h.date)).toEqual(list.map((h) => h.date).slice().sort())
  })

  it('refuses duplicates, impossible dates and short names', () => {
    expect(validateHoliday({ date: '2026-11-09', name: 'Another' }, custom).date).toMatch(/already set/)
    expect(validateHoliday({ date: '2026-03-06', name: 'Another' }).date).toMatch(/public holiday/)
    expect(validateHoliday({ date: '2026-02-30', name: 'Another' }).date).toMatch(/valid date/)
    expect(validateHoliday({ date: '2026-11-10', name: 'ab' }).name).toBeDefined()
  })
})

describe('periods', () => {
  it('runs from the 26th to the 25th', () => {
    const dates = periodDateKeys(periodForDateKey('2026-11-09'))
    expect(dates[0]).toBe('2026-10-26')
    expect(dates[dates.length - 1]).toBe('2026-11-25')
  })

  it('starts a new period on the 26th', () => {
    expect(periodForDateKey('2026-11-25').key).toBe('2026-11')
    expect(periodForDateKey('2026-11-26').key).toBe('2026-12')
  })

  it('never includes future dates in elapsed days', () => {
    const elapsed = elapsedPeriodDateKeys(periodForDateKey('2026-11-09'), '2026-11-09')
    expect(elapsed[elapsed.length - 1]).toBe('2026-11-09')
  })
})

describe('tenure', () => {
  it('counts whole years, months and days', () => {
    expect(tenureBetween('2024-01-15', '2026-03-20')).toMatchObject({ years: 2, months: 2, days: 5 })
  })

  it('returns null for a future joining date', () => {
    expect(tenureBetween('2027-01-01', '2026-03-20')).toBeNull()
  })
})
