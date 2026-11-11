import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { makeSiteCode, msUntilNextStep, siteCodeUrl, CODE_STEP_SECONDS } from '../../supabase/functions/_shared/rules/siteCode.js'
import { ApiFailure } from '../services/backend/client'
import { claimDisplay, clockOffsetMs, forgetDisplay, passFromCode, thisDisplay } from '../services/workplaceDisplayService'
import '../styles/registration.css'
import '../styles/display.css'

const HEALTH_CHECK_MS = 5 * 60 * 1000
const CLOCK_SYNC_MS = 10 * 60 * 1000

/**
 * The screen at a workplace. With `setupToken` it first turns this device into
 * the display HR created; after that it shows the changing QR code.
 */
export default function WorkplaceDisplay({ setupToken = null }) {
  const [display, setDisplay] = useState(() => (setupToken ? null : thisDisplay()))
  const [setupError, setSetupError] = useState(null)

  useEffect(() => {
    if (!setupToken) return
    claimDisplay(setupToken)
      .then((claimed) => {
        setDisplay(claimed)
        window.history.replaceState(null, '', '/display')
      })
      .catch((error) => setSetupError(error.message))
  }, [setupToken])

  if (setupToken && !display) {
    return (
      <DisplayMessage title={setupError ? 'Setup did not work' : 'Setting up this display…'}>
        {setupError ?? 'One moment.'}
      </DisplayMessage>
    )
  }
  if (!display) {
    return (
      <DisplayMessage title="This screen is not set up">
        In the HR portal, open Settings → Workplace displays, add a display and open its setup link on this device.
      </DisplayMessage>
    )
  }
  return <QrScreen display={display} onSwitchedOff={() => { forgetDisplay(); setDisplay(null) }} />
}

function QrScreen({ display, onSwitchedOff }) {
  const [svg, setSvg] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(CODE_STEP_SECONDS)
  const [clock, setClock] = useState('')
  const [switchedOff, setSwitchedOff] = useState(false)
  const offset = useRef(0)
  const lastStepCode = useRef(null)

  // Keep the screen on while the display is showing.
  useEffect(() => {
    let lock = null
    const request = () => navigator.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    request()
    const onVisible = () => { if (document.visibilityState === 'visible') request() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [])

  // Codes are checked against the server's clock, so follow it, not the tablet's.
  useEffect(() => {
    const sync = () => clockOffsetMs().then((ms) => { offset.current = ms }).catch(() => {})
    sync()
    const id = setInterval(sync, CLOCK_SYNC_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const now = Date.now() + offset.current
      setSecondsLeft(Math.ceil(msUntilNextStep(now) / 1000))
      setClock(new Date(now).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' }))
      const code = await makeSiteCode(display.displayId, display.secret, now)
      if (cancelled || code === lastStepCode.current) return
      lastStepCode.current = code
      const image = await QRCode.toString(siteCodeUrl(window.location.origin, code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      if (!cancelled) setSvg(image)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [display])

  // Notice when HR switches this display off, instead of showing dead codes.
  useEffect(() => {
    const check = async () => {
      const code = await makeSiteCode(display.displayId, display.secret, Date.now() + offset.current)
      passFromCode(code).catch((error) => {
        if (error instanceof ApiFailure && error.data?.code === 'site-invalid') setSwitchedOff(true)
      })
    }
    const first = setTimeout(check, 15000)
    const id = setInterval(check, HEALTH_CHECK_MS)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [display])

  if (switchedOff) {
    return (
      <DisplayMessage title="This display was switched off">
        HR switched off &ldquo;{display.name}&rdquo;. To use this screen again, open a new setup link from Settings → Workplace displays.
        <div className="step-actions" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={onSwitchedOff}>OK</button>
        </div>
      </DisplayMessage>
    )
  }

  return (
    <main className="wd-screen">
      <header className="wd-head">
        <span className="wd-company">{display.companyName}</span>
        <span className="wd-clock" aria-label="Time now">{clock}</span>
      </header>
      <section className="wd-body">
        <h1 className="wd-title">Scan to check in or out</h1>
        <p className="wd-sub">Open your phone camera and point it at the code.</p>
        <div className="wd-qr" role="img" aria-label="Attendance QR code" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="wd-timer" aria-hidden="true">
          <span style={{ width: `${(secondsLeft / CODE_STEP_SECONDS) * 100}%` }} />
        </div>
        <p className="wd-note">New code in {secondsLeft}s · {display.name}</p>
      </section>
    </main>
  )
}

function DisplayMessage({ title, children }) {
  return (
    <main className="registration-page">
      <div className="registration-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">WA</span>
          Workforce Attendance
        </header>
        <section className="card">
          <h2 className="step-title">{title}</h2>
          <div className="step-description">{children}</div>
        </section>
      </div>
    </main>
  )
}
