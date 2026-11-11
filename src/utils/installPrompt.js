/**
 * "Install app" support.
 *
 * Android (Chrome, Edge, Samsung Internet) fires `beforeinstallprompt` once,
 * often before any page has mounted, so it is captured here at start-up and
 * handed to whoever asks. iPhone/iPad Safari has no install prompt: the user
 * adds the app from the Share menu, so we only detect it to show instructions.
 */
let deferred = null
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

/** Already running as an installed app (opened from the home screen). */
export function isInstalled() {
  if (typeof window === 'undefined') return false
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone)
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function canPromptInstall() {
  return Boolean(deferred)
}

/** Show Android's install dialog. Resolves to 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferred) return 'unavailable'
  const e = deferred
  deferred = null
  notify()
  e.prompt()
  const { outcome } = await e.userChoice
  return outcome
}

export function onInstallChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
