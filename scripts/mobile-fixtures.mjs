/**
 * Sample answers for the mobile layout check, so every screen and state can be
 * shown in a browser without a backend. Long names and links are deliberate:
 * they must wrap rather than widen the page.
 */

export const REF = 'aiiglvsvrbtahihttwge'
const LONG_NAME = 'Abenaa Oforiwaa Konadu-Mensah Asantewaa'
const LONG_SHOP = 'Melcom Superstore Spintex Road Branch (Near Coca-Cola Roundabout)'
const LONG_TOKEN = 'k3J9xQ2mV7pL0aZr8tY6wE4uI1oP5sD3fG7hJ9kL2zX4cV6bN8mQ0'
const FUTURE = new Date(Date.now() + 6 * 3600000).toISOString()
const NOW = new Date().toISOString()

export const TRACKING_SESSION = { token: LONG_TOKEN, closesAt: FUTURE, staffId: 'BFL-0007', canRecordVisits: true }

const shops = [
  { shopId: 'shop-1', companyId: 'box-for-less', shopName: LONG_SHOP, town: 'Accra', area: 'Spintex', address: '' },
  { shopId: 'shop-2', companyId: 'box-for-less', shopName: 'China Mall', town: 'Accra', area: 'Spintex', address: '' },
  { shopId: 'shop-3', companyId: 'box-for-less', shopName: 'Shoprite Accra Mall', town: 'Accra', area: 'Tetteh Quarshie', address: '' },
]

/** Edge Function answers: [status, body] for a method and path. */
export function apiFixture(method, path) {
  if (path.startsWith('/public/time')) return [200, { now: NOW }]
  if (path.startsWith('/public/shops')) return [200, { shops }]
  if (path.startsWith('/attendance/lookup/')) {
    return [200, { staffId: 'BFL-0007', fullName: LONG_NAME, companyName: 'Box For Less', position: 'Sales Representative', nextAction: 'check-in', attemptsLeft: 5, blockedReason: null }]
  }
  if (path === '/attendance/events' && method === 'POST') {
    return [200, {
      id: 'e1', staffId: 'BFL-0007', fullName: LONG_NAME, companyName: 'Box For Less', position: 'Sales Representative',
      type: 'check-in', status: 'on-time', date: NOW.slice(0, 10), time: NOW, weekend: false, overtimeHours: null,
      trackingToken: LONG_TOKEN, trackingClosesAt: FUTURE, canRecordVisits: true,
    }]
  }
  if (path === '/tracking/visits' && method === 'GET') {
    return [200, {
      shops: [
        { shopId: 'shop-1', shopName: LONG_SHOP, hasLocation: true, visited: true },
        { shopId: 'shop-2', shopName: 'China Mall', hasLocation: true, visited: false },
        { shopId: 'shop-3', shopName: 'Shoprite Accra Mall', hasLocation: false, visited: false },
      ],
      visits: [{ id: 'v1', time: NOW, outlet: { shopId: 'shop-1', name: null, town: null }, onList: true, distanceM: 40, status: 'recorded' }],
      attemptsLeft: 5,
    }]
  }
  if (path === '/tracking/visits' && method === 'POST') {
    return [201, { visit: { id: 'v2', time: NOW, outlet: { shopId: 'shop-2', name: null, town: null }, onList: true, distanceM: 40, status: 'recorded' } }]
  }
  if (path.startsWith('/public/enroll/closed')) return [404, { error: 'This link has already been used or has expired. Ask HR for a new one.' }]
  if (path.startsWith('/public/enroll/')) return [200, { staffId: 'BFL-0007', fullName: LONG_NAME, companyName: 'Box For Less' }]
  if (path.startsWith('/public/hr-setup/')) return [200, { email: 'abenaa.konadu-mensah.hr@boxforless.example.com', name: LONG_NAME, existingAccount: false }]
  if (path.startsWith('/public/password-reset/')) return [200, { email: 'abenaa.konadu-mensah.hr@boxforless.example.com', name: LONG_NAME }]
  if (path.startsWith('/verify/')) {
    return [200, { employeeName: LONG_NAME, fullName: LONG_NAME, companyName: 'Box For Less', shopName: LONG_SHOP, verificationNumber: 2, expiresAt: FUTURE, status: 'pending' }]
  }
  if (path === '/hr/me') return [200, { user: HR_USER_API, smsProvider: 'txtconnect', faceProvider: 'faceapi' }]
  if (path.startsWith('/hr/')) return [200, {}]
  return [404, { error: 'Not found.' }]
}

/* --------------------------------------------------------------------------
 * HR portal: a signed-in session with MFA, and sample rows
 * ------------------------------------------------------------------------ */

const HR_ID = '00000000-0000-4000-8000-000000000001'
const HR_USER_API = { id: HR_ID, name: 'HR Manager', role: 'HR Manager', companyIds: ['box-for-less', 'double-a'] }

function b64url(object) {
  return Buffer.from(JSON.stringify(object)).toString('base64url')
}

/** A session the browser client accepts (it only decodes the token; the API is answered here). */
export function hrSession() {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600
  const payload = { sub: HR_ID, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: exp - 3600 }], session_id: '00000000-0000-4000-8000-0000000000aa', exp, email: 'hr@example.com' }
  const accessToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2ln`
  const user = {
    id: HR_ID, aud: 'authenticated', role: 'authenticated', email: 'hr@example.com',
    factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Authenticator app' }],
    app_metadata: {}, user_metadata: {}, created_at: NOW,
  }
  return { access_token: accessToken, refresh_token: 'refresh', token_type: 'bearer', expires_in: 86400, expires_at: exp, user }
}

const employees = [
  ['BFL-0007', LONG_NAME, 'Sales Representative', 'shop-1'],
  ['BFL-0008', 'Kwame Boateng Asamoah-Gyamfi Ofori', 'Merchandiser', 'shop-2'],
  ['BFL-0009', 'Efua Sarpong', 'Supervisor', 'shop-3'],
  ['BFL-0010', 'Yaw Darko', 'Warehouse Worker', null],
].map(([staffId, name, position, shop]) => ({
  staff_id: staffId, company_id: 'box-for-less', company_name: 'Box For Less', full_name: name, position,
  payment_method: 'mobile-money', phone: '0241234567', email: '', address: 'Accra', emergency_contact_name: '', emergency_contact_phone: '',
  assigned_shop_id: shop, face_photo_path: 'x.jpg', status: 'ACTIVE', registered_at: '2026-01-05T08:00:00Z', joined_on: '2026-01-05', left_on: null,
}))

/** PostgREST answers by table name (unknown tables get an empty list). */
export function restFixture(table) {
  switch (table) {
    case 'hr_users': return [{ id: HR_ID, name: 'HR Manager', email: 'hr@example.com', role_id: 'hr-manager', company_ids: ['box-for-less', 'double-a'], grants: {}, status: 'active' }]
    case 'companies': return [{ id: 'box-for-less', name: 'Box For Less' }, { id: 'double-a', name: 'Double A' }]
    case 'employees': return employees
    case 'shops': return shops.map((s) => ({ shop_id: s.shopId, company_id: s.companyId, shop_name: s.shopName, town: s.town, area: s.area, address: '', latitude: 5.6037, longitude: -0.187, location_source: 'manual', status: 'active', geofence_radius: 150 }))
    case 'attendance_events': return [{ id: 'a1', employee_id: 'BFL-0007', company_id: 'box-for-less', company_name: 'Box For Less', full_name: LONG_NAME, type: 'check-in', status: 'on-time', date: NOW.slice(0, 10), occurred_at: NOW, weekend: false, source: 'face' }]
    case 'shop_assignments': return employees.filter((e) => e.assigned_shop_id).map((e, i) => ({ id: `sa-${i}`, company_id: 'box-for-less', employee_id: e.staff_id, shop_id: e.assigned_shop_id, previous_shop_id: null, effective_date: '2026-01-05T08:00:00Z', assigned_at: '2026-01-05T08:00:00Z', assigned_by: 'HR Manager', assigned_by_role: 'HR Manager', active: true }))
    case 'employee_shops': return employees.filter((e) => e.assigned_shop_id).map((e) => ({ staff_id: e.staff_id, shop_id: e.assigned_shop_id, company_id: 'box-for-less', position: 1, assigned_at: '2026-01-05T08:00:00Z', assigned_by: 'HR Manager' }))
    case 'settings_company': return [
      { company_id: 'box-for-less', profile: { displayName: 'Box For Less', code: 'BFL', phone: '', email: '', address: '', logo: null, status: 'active' }, vat_rate: 0, require_workplace_code: false },
      { company_id: 'double-a', profile: { displayName: 'Double A', code: 'DAA', phone: '', email: '', address: '', logo: null, status: 'active' }, vat_rate: 0, require_workplace_code: false },
    ]
    case 'settings_general': return [
      { key: 'general', value: { systemName: 'Workforce Pro', logo: null, description: '', language: 'en-GB', dateFormat: 'd MMM yyyy', timeFormat: '12h', landingPage: 'dashboard' } },
      { key: 'monitoring', value: { defaultGeofenceRadius: 150, responseWindowMinutes: 15, faceRequired: true, gpsRequired: true, smsEnabled: true, repeatedExceptionThreshold: 2, locationProvider: 'none' } },
      { key: 'security', value: { sessionTimeoutMinutes: 60, loginAttemptLimit: 5, passwordMinLength: 12, passwordRequireMixed: true, mfaPolicy: 'required-in-production' } },
      { key: 'notifications', value: {} },
      { key: 'data', value: { lastConfigExportAt: null } },
    ]
    case 'settings_versions': {
      const hours = { workingDays: [1, 2, 3, 4, 5], startTime: '08:00', lateAfter: '09:00', endTime: '17:00', overtimeStart: '17:01', breakStart: '12:30', breakMinutes: 0 }
      const row = (id, kind, companyId, values) => ({ id, kind, company_id: companyId, effective_from: '2000-01-01', values, changed_by: 'System default', changed_at: '2026-01-01T00:00:00Z' })
      return [
        row(1, 'attendance', null, { graceMinutes: 60, clockOutWindowMinutes: 120, missingClockIn: 'absent-after-shift-end', incompleteHandling: 'flag-and-notify', minCorrectionRemarks: 10, correctionApproval: 'not-required' }),
        row(2, 'working-hours', 'box-for-less', hours),
        row(3, 'working-hours', 'double-a', hours),
        row(4, 'pay', 'box-for-less', { overtimeRate: 60 }),
        row(5, 'pay', 'double-a', { overtimeRate: 60 }),
      ]
    }
    default: return []
  }
}
