import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// The mobile layer: phone-sized controls and text boxes, on every screen.
import './styles/mobile.css'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
// Captures Android's install prompt as early as possible.
import './utils/installPrompt'

const PRELOAD_RELOAD_KEY = 'workforce:preload-reload-at'
const PRELOAD_RELOAD_COOLDOWN_MS = 15_000

// Recover automatically when a lazy route chunk from a previous deployment is
// no longer on the server, guarded so an offline or broken build reloads at
// most once per 15 seconds.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const now = Date.now()
    const last = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY) || 0)
    if (now - last < PRELOAD_RELOAD_COOLDOWN_MS) return
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(now))
  } catch {
    if (window.__workforcePreloadReloaded) return
    window.__workforcePreloadReloaded = true
  }
  event.preventDefault()
  window.location.reload()
})

// Installable app: register the service worker in production builds only
// (in development it would serve stale files over Vite's live reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
