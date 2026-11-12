/**
 * Browser storage for FRONTEND-ONLY features that have no backend yet
 * (live-tracking points and summaries, daily shop lists). Each use is
 * temporary: the backend replaces it — see
 * docs/backend-live-tracker-and-sms-verification.md.
 */
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
