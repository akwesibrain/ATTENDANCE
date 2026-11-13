import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/backend/client', () => ({ api: vi.fn(), submit: vi.fn() }))
vi.mock('../src/services/backend/cache', () => ({ refresh: vi.fn() }))

const { hrEmployeeBody, setupLinkUrl } = await import('../src/services/onboardingService.js')

const registration = {
  companyId: 'box-for-less',
  firstName: 'Ama',
  middleName: '',
  lastName: 'Owusu',
  phone: '0241234567',
  email: '',
  address: 'Accra',
  emergencyContactName: 'Kofi',
  emergencyContactPhone: '0201234567',
  paymentMethod: 'mobile-money',
  position: 'Cashier',
  shopMode: 'existing',
  assignedShopId: '',
  newShop: null,
  faceImage: null,
  faceDescriptor: null,
  confirmed: false,
}

describe('hrEmployeeBody', () => {
  it('leaves the face out and asks for a link when HR sends one', () => {
    const body = hrEmployeeBody(registration, { sendFaceLink: true })
    expect(body).not.toHaveProperty('faceImage')
    expect(body).not.toHaveProperty('faceDescriptor')
    expect(body.sendFaceLink).toBe(true)
    expect(body.biometricConsent).toBe(false)
    expect(body.firstName).toBe('Ama')
  })

  it('sends the face and consent when HR scanned it, and no link', () => {
    const body = hrEmployeeBody({ ...registration, faceImage: 'data:image/jpeg;base64,AAA', faceDescriptor: [0.1], confirmed: true }, { sendFaceLink: true })
    expect(body.faceImage).toBe('data:image/jpeg;base64,AAA')
    expect(body.faceDescriptor).toEqual([0.1])
    expect(body.biometricConsent).toBe(true)
    expect(body.sendFaceLink).toBe(false)
  })
})

describe('setupLinkUrl', () => {
  it('builds face and HR links from the page address', () => {
    expect(setupLinkUrl('https://app.example', 'face', 'abc')).toBe('https://app.example/enroll/abc')
    expect(setupLinkUrl('https://app.example', 'hr-invite', 'abc')).toBe('https://app.example/hr/setup/abc')
  })
})
