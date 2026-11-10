/**
 * Shared localStorage helpers and keys for mock services that would otherwise
 * import each other in a cycle (settings, audit, permissions).
 */

export const SETTINGS_KEY = 'mock-settings:v1'
export const AUDIT_KEY = 'mock-audit:events'

export function readJson(key, fallback) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
