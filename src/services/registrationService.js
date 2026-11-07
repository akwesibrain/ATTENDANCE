/**
 * ============================================================================
 * MOCK REGISTRATION SERVICE  —  NOT A PRODUCTION BACKEND
 * ============================================================================
 * This module simulates the backend employee-registration API so the
 * frontend flow can be built and tested end to end.
 *
 * In the real implementation:
 *   - Staff IDs are generated exclusively by the backend (unique, sequential
 *     per company, never reassigned).
 *   - The face image and profile data are uploaded to the server, which
 *     performs biometric enrollment and returns the created employee record.
 *
 * When the backend is ready, replace `submitRegistration` below with a real
 * API call (fetch/axios) to the registration endpoint. Do NOT invent
 * endpoints here — wire them up once the backend contract is defined.
 * ============================================================================
 */

import { getCompanyById } from '../constants/companies'

/** Company-specific Staff ID prefixes (mirrors the agreed ID format). */
const STAFF_ID_PREFIXES = {
  'box-for-less': 'BFL',
  'double-a': 'DAA',
}

/** localStorage key for the mock per-company ID counters. */
const COUNTER_STORAGE_KEY = 'mock-registration:id-counters'

/** localStorage key for the mock employee directory (registered employees). */
const EMPLOYEES_STORAGE_KEY = 'mock-registration:employees'

/** Simulated network latency (ms). */
const MOCK_LATENCY_MS = 1400

/**
 * TEST HOOK (mock only): entering this value as the first name forces the
 * mock service to reject, so error handling can be tested without a backend.
 */
export const MOCK_FAILURE_TRIGGER = 'fail'

function readCounters() {
  try {
    return JSON.parse(window.localStorage.getItem(COUNTER_STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeCounters(counters) {
  try {
    window.localStorage.setItem(COUNTER_STORAGE_KEY, JSON.stringify(counters))
  } catch {
    // Storage unavailable (private mode etc.) — the mock still works for
    // the current session; counters simply will not persist.
  }
}

function readEmployees() {
  try {
    return JSON.parse(window.localStorage.getItem(EMPLOYEES_STORAGE_KEY)) ?? []
  } catch {
    return []
  }
}

function writeEmployees(employees) {
  try {
    window.localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(employees))
  } catch {
    // Ignore — mock persistence only.
  }
}

/**
 * MOCK ONLY — persists a registered employee so the attendance flow can look
 * them up by Staff ID. The real backend owns the employee directory.
 */
function mockSaveEmployee(record) {
  const employees = readEmployees()
  employees.push(record)
  writeEmployees(employees)
}

/**
 * MOCK ONLY — find a registered employee by Staff ID (case-insensitive).
 * @returns {object|null} the employee record, or null if not found.
 */
export function mockFindEmployeeByStaffId(staffId) {
  const normalized = (staffId ?? '').trim().toUpperCase()
  if (!normalized) return null
  return (
    readEmployees().find(
      (employee) => employee.staffId.toUpperCase() === normalized,
    ) ?? null
  )
}

/**
 * MOCK ONLY — list all registered employees (for the HR dashboard).
 * The real backend owns this directory; here it is read from localStorage.
 * @returns {object[]} employee records, newest first.
 */
export function mockListEmployees() {
  return readEmployees().slice().reverse()
}

/**
 * MOCK ONLY — whether this device has completed at least one registration.
 * Used to enforce the rule that a registered device only sees attendance.
 * (Device-scoped; the real backend will key this off the authenticated user.)
 */
export function mockHasRegistered() {
  return readEmployees().length > 0
}

/**
 * MOCK ONLY — simulates backend Staff ID generation.
 * Real Staff IDs must always be issued by the backend; this exists purely
 * so the frontend can display a realistic result during development.
 */
function mockGenerateStaffId(companyId) {
  const prefix = STAFF_ID_PREFIXES[companyId]
  if (!prefix) {
    throw new Error('Unknown company. Please select a company and try again.')
  }
  const counters = readCounters()
  const next = (counters[companyId] ?? 0) + 1
  counters[companyId] = next
  writeCounters(counters)
  return `${prefix}-${String(next).padStart(4, '0')}`
}

/**
 * Submit a completed registration.
 *
 * @param {object} registration - Collected registration form data.
 * @returns {Promise<object>} Resolves with the created employee record:
 *   { staffId, status, companyId, companyName, fullName, position, registeredAt }
 */
export function submitRegistration(registration) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const company = getCompanyById(registration.companyId)
        if (!company) {
          reject(new Error('No company selected. Please go back and select your company.'))
          return
        }

        // TEST HOOK: allows the failure path to be exercised on demand.
        if (
          registration.firstName?.trim().toLowerCase() === MOCK_FAILURE_TRIGGER
        ) {
          reject(
            new Error(
              'Registration failed (simulated server error). Please try again.',
            ),
          )
          return
        }

        const position = registration.position.trim()

        const fullName = [
          registration.firstName,
          registration.middleName,
          registration.lastName,
        ]
          .filter((part) => part && part.trim())
          .map((part) => part.trim())
          .join(' ')

        const record = {
          staffId: mockGenerateStaffId(registration.companyId),
          status: 'ACTIVE',
          companyId: company.id,
          companyName: company.name,
          fullName,
          position,
          paymentMethod: registration.paymentMethod ?? '',
          faceImage: registration.faceImage ?? null,
          registeredAt: new Date().toISOString(),
        }
        mockSaveEmployee(record)
        resolve(record)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Registration failed.'))
      }
    }, MOCK_LATENCY_MS)
  })
}
