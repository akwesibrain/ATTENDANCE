import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// The mobile layer: phone-sized controls and text boxes, on every screen.
import './styles/mobile.css'
import App from './App.jsx'
// Captures Android's install prompt as early as possible.
import './utils/installPrompt'

// Installable app: register the service worker in production builds only
// (in development it would serve stale files over Vite's live reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
