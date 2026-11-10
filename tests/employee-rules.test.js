import { describe, expect, it } from 'vitest'
import {
  attendanceGate,
  nextAttendanceAction,
  normalizeStaffId,
} from '../supabase/functions/_shared/rules/checkin.js'
import {
  compareTemplates,
  decodeTemplate,
  encodeTemplate,
  FACE_MATCH_THRESHOLD,
  hasEnoughContrast,
  parseJpegDataUrl,
  templateFromRgba,
} from '../supabase/functions/_shared/rules/faceTemplate.js'
import { parseRegistration, requiresShop } from '../supabase/functions/_shared/rules/registration.js'

/** 2026-11-10 is a Tuesday. */
const at = (time, date = '2026-11-10') => new Date(`${date}T${time}:00.000Z`)
const gate = (eventTypes, now, status = 'ACTIVE') => attendanceGate({ fullName: 'Ama Mensah', status, eventTypes, now })

describe('staff IDs', () => {
  it('normalizes what people type', () => {
    expect(normalizeStaffId(' bfl-0001 ')).toBe('BFL-0001')
  })

  it('refuses anything that is not a Staff ID', () => {
    for (const value of ['', 'BFL', '0001', "BFL-1' or 1=1", null, 42]) expect(normalizeStaffId(value)).toBeNull()
  })
})

describe('next action', () => {
  it('goes check-in, check-out, then nothing', () => {
    expect(nextAttendanceAction([])).toBe('check-in')
    expect(nextAttendanceAction(['check-in'])).toBe('check-out')
    expect(nextAttendanceAction(['check-in', 'check-out'])).toBeNull()
  })

  it('stops once the kiosk has locked the Staff ID for the day', () => {
    expect(nextAttendanceAction(['check-in', 'face-lockout'])).toBeNull()
  })
})

describe('attendance gate', () => {
  it('allows an on-time check-in up to 09:00', () => {
    expect(gate([], at('09:00'))).toEqual({ nextAction: 'check-in', windowStatus: 'on-time', blockedReason: null })
  })

  it('records a check-in after 09:00 as late', () => {
    expect(gate([], at('09:01')).windowStatus).toBe('late')
  })

  it('refuses a check-in before 06:00', () => {
    expect(gate([], at('05:59')).blockedReason).toMatch(/opens at 6:00/)
  })

  it('keeps check-out open for the clock-out window, so late work is recorded', () => {
    expect(gate(['check-in'], at('16:59')).blockedReason).toMatch(/opens at 5:00 PM/)
    expect(gate(['check-in'], at('17:00')).blockedReason).toBeNull()
    expect(gate(['check-in'], at('21:30')).blockedReason).toBeNull()
    expect(gate(['check-in'], at('23:00')).blockedReason).toMatch(/closed at 11:00 PM/)
  })

  it('follows the hours and rules in Settings', () => {
    const hours = { workingDays: [1, 2, 3, 4, 5, 6], startTime: '07:00', lateAfter: '07:15', endTime: '16:00' }
    const rules = { clockOutWindowMinutes: 60 }
    const custom = (eventTypes, now) => attendanceGate({ fullName: 'Ama Mensah', status: 'ACTIVE', eventTypes, now, hours, rules })
    expect(custom([], at('07:15')).windowStatus).toBe('on-time')
    expect(custom([], at('07:16')).windowStatus).toBe('late')
    expect(custom(['check-in'], at('16:00')).blockedReason).toBeNull()
    expect(custom(['check-in'], at('17:00')).blockedReason).toMatch(/closed at 5:00 PM/)
    // Saturday is a working day here, so the windows apply.
    expect(custom(['check-in'], at('12:00', '2026-11-07')).blockedReason).toMatch(/opens at 4:00 PM/)
  })

  it('never keeps check-out open past midnight', () => {
    const hours = { workingDays: [2], startTime: '14:00', lateAfter: '14:30', endTime: '22:00' }
    const late = attendanceGate({ fullName: 'Ama Mensah', status: 'ACTIVE', eventTypes: ['check-in'], now: at('23:59'), hours, rules: { clockOutWindowMinutes: 360 } })
    expect(late.blockedReason).toBeNull()
  })

  it('leaves weekends outside the windows', () => {
    expect(gate(['check-in'], at('12:00', '2026-11-07')).blockedReason).toBeNull()
  })

  it('leaves holidays outside the windows, like weekends', () => {
    const onHoliday = (eventTypes, now) => attendanceGate({ fullName: 'Ama Mensah', status: 'ACTIVE', eventTypes, now, holiday: true })
    expect(onHoliday([], at('05:00'))).toEqual({ nextAction: 'check-in', windowStatus: 'on-time', blockedReason: null })
    expect(onHoliday([], at('11:00')).windowStatus).toBe('on-time')
    expect(onHoliday(['check-in'], at('13:00')).blockedReason).toBeNull()
    expect(onHoliday(['check-in'], at('20:00')).blockedReason).toBeNull()
  })

  it('still applies the windows on a normal weekday', () => {
    expect(gate(['check-in'], at('13:00')).blockedReason).toMatch(/opens at 5:00/)
  })

  it('blocks a completed day, a locked Staff ID and an inactive employee', () => {
    expect(gate(['check-in', 'check-out'], at('18:00')).blockedReason).toMatch(/already completed/)
    expect(gate(['face-lockout'], at('10:00')).blockedReason).toMatch(/HR has been alerted/)
    expect(gate(['face-lockout'], at('10:00')).blockedReason).not.toMatch(/absent/i)
    expect(gate([], at('08:00'), 'INACTIVE').blockedReason).toMatch(/not active/)
  })
})

describe('registration', () => {
  const valid = {
    companyId: 'box-for-less',
    firstName: ' Ama ',
    middleName: '',
    lastName: 'Mensah',
    phone: '+233 24 123 4567',
    paymentMethod: 'mobile-money',
    position: 'Warehouse Worker',
    biometricConsent: true,
  }

  it('accepts a valid form and builds the full name', () => {
    const { value } = parseRegistration(valid)
    expect(value.fullName).toBe('Ama Mensah')
    expect(value.shopId).toBeNull()
  })

  it('requires consent, a payment method and a phone number', () => {
    const { errors } = parseRegistration({ ...valid, biometricConsent: 'yes', paymentMethod: 'cash', phone: '12' })
    expect(Object.keys(errors).sort()).toEqual(['biometricConsent', 'paymentMethod', 'phone'])
  })

  it('refuses privileged titles', () => {
    expect(parseRegistration({ ...valid, position: 'HR Manager' }).errors.position).toMatch(/cannot be self-assigned/)
  })

  it('requires a shop for field positions only', () => {
    expect(requiresShop(' sales representative ')).toBe(true)
    expect(parseRegistration({ ...valid, position: 'Merchandiser' }).errors.shop).toMatch(/required/)
    expect(parseRegistration({ ...valid, assignedShopId: 'shop-1' }).value.shopId).toBeNull()
    expect(parseRegistration({ ...valid, position: 'Merchandiser', assignedShopId: 'shop-1' }).value.shopId).toBe('shop-1')
  })

  it('checks a new shop and drops any coordinates sent with it', () => {
    const shop = { shopName: 'Melcom', town: 'Kumasi', area: 'Adum', latitude: 1, longitude: 2 }
    const { value } = parseRegistration({ ...valid, position: 'Merchandiser', shopMode: 'new', newShop: shop })
    expect(value.newShop).toEqual({ shopName: 'Melcom', town: 'Kumasi', area: 'Adum', address: '' })
    expect(parseRegistration({ ...valid, position: 'Merchandiser', shopMode: 'new', newShop: { shopName: 'M' } }).errors.shop).toBeDefined()
  })

  it('survives a malformed request', () => {
    expect(parseRegistration(null).errors.companyId).toBeDefined()
    expect(parseRegistration({ ...valid, firstName: { $ne: 1 } }).errors.firstName).toBeDefined()
  })
})

describe('face template', () => {
  function image(width, height, shade) {
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = shade(x / width, y / height)
        data.set([value, value, value, 255], (y * width + x) * 4)
      }
    }
    return { width, height, data }
  }
  const stripes = (x) => (Math.floor(x * 8) % 2 ? 230 : 25)
  const inverted = (x) => (Math.floor(x * 8) % 2 ? 25 : 230)

  it('scores the same picture as identical, at any size', () => {
    const score = compareTemplates(templateFromRgba(image(64, 64, stripes)), templateFromRgba(image(640, 640, stripes)))
    expect(score).toBeGreaterThan(0.99)
  })

  it('crops to the center, so a wider frame of the same picture still matches', () => {
    const wide = (x) => stripes(Math.min(Math.max((x * 2 - 0.5), 0), 0.999))
    expect(compareTemplates(templateFromRgba(image(64, 64, stripes)), templateFromRgba(image(128, 64, wide)))).toBeGreaterThan(0.99)
  })

  it('rejects a different picture', () => {
    const score = compareTemplates(templateFromRgba(image(64, 64, stripes)), templateFromRgba(image(64, 64, inverted)))
    expect(score).toBeLessThan(FACE_MATCH_THRESHOLD)
  })

  it('treats a blank frame as unusable', () => {
    expect(hasEnoughContrast(templateFromRgba(image(64, 64, () => 3)))).toBe(false)
    expect(hasEnoughContrast(templateFromRgba(image(64, 64, stripes)))).toBe(true)
  })

  it('refuses an image smaller than the grid', () => {
    expect(() => templateFromRgba(image(16, 16, stripes))).toThrow()
  })

  it('stores and restores a template exactly', () => {
    const template = templateFromRgba(image(64, 64, stripes))
    expect(decodeTemplate(encodeTemplate(template))).toEqual(template)
  })

  it('accepts only JPEG data URLs within the size limit', () => {
    const jpegUrl = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xe0data')}`
    expect(parseJpegDataUrl(jpegUrl)).toBeInstanceOf(Uint8Array)
    expect(parseJpegDataUrl(`data:image/jpeg;base64,${btoa('not a jpeg')}`)).toBeNull()
    expect(parseJpegDataUrl(`data:image/png;base64,${btoa('\xff\xd8\xff\xe0')}`)).toBeNull()
    expect(parseJpegDataUrl(`data:image/jpeg;base64,${'A'.repeat(1_400_000)}`)).toBeNull()
    expect(parseJpegDataUrl(undefined)).toBeNull()
  })
})
