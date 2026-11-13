/**
 * Automatic mobile layout check. Opens every screen and state at phone sizes
 * in a headless browser, answering API calls with sample data, and fails if a
 * page scrolls sideways, a control is smaller than 44×44 px, or a text box's
 * font is under 16 px (iPhones zoom in on those). Saves screenshots to
 * mobile-screenshots/<size>/.
 *
 * It runs against the Vite dev server (so the face module can be swapped for a
 * stand-in): it uses one already running on :5173, or starts one.
 *
 * Usage: node scripts/mobile-check.mjs [--only <screen>] [--base <url>]
 */

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { REF, TRACKING_SESSION, apiFixture, hrSession, restFixture } from './mobile-fixtures.mjs'

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const ONLY = option('--only')
const SIZES = [
  { name: '360x800', width: 360, height: 800, blocking: true },
  { name: '390x844', width: 390, height: 844, blocking: true },
  { name: '320x640', width: 320, height: 640, blocking: false },
]
const LANDSCAPE = { name: '844x390', width: 844, height: 390, blocking: true }
const OUT = new URL('../mobile-screenshots/', import.meta.url)

const FACE_STUB = `
export class FaceNotUsable extends Error {}
export function preloadFaceModels() {}
export async function describeFace() { return Array.from({ length: 128 }, (_, i) => ((i % 7) - 3) / 50) }
`

async function reachable(url) {
  try { return (await fetch(url)).ok } catch { return false }
}

async function startServer() {
  const given = option('--base')
  if (given) return { base: given, stop: () => {} }
  if (await reachable('http://localhost:5173/')) return { base: 'http://localhost:5173', stop: () => {} }
  const child = spawn('npx', ['vite', '--port', '5179', '--strictPort'], { shell: true, stdio: 'ignore' })
  for (let i = 0; i < 60; i += 1) {
    if (await reachable('http://localhost:5179/')) return { base: 'http://localhost:5179', stop: () => child.kill() }
    await new Promise((r) => setTimeout(r, 500))
  }
  child.kill()
  throw new Error('The dev server did not start.')
}

/* --------------------------------------------------------------------------
 * Measuring a page
 * ------------------------------------------------------------------------ */

function measure(width) {
  // The layer's overflow-x: clip is a safety net; measure what it would hide.
  const unclip = document.createElement('style')
  unclip.textContent = 'html, body { overflow-x: visible !important; }'
  document.head.appendChild(unclip)
  const out = { overflow: document.documentElement.scrollWidth > width + 1, scrollWidth: document.documentElement.scrollWidth, small: [], tinyText: [], cut: [], squeezed: [] }
  unclip.remove()
  const describe = (el, r) => {
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.name || el.type || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${label}" ${Math.round(r.width)}×${Math.round(r.height)}`
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }
  // Inside a box that scrolls sideways on purpose (a wide table), going past the edge is fine.
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    return false
  }
  // Text squeezed into a column so narrow that words break letter by letter.
  document.querySelectorAll('body *').forEach((el) => {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    if (own.length < 8) return
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.width < 40 && r.height > 90) out.squeezed.push(`${el.tagName.toLowerCase()} "${own.slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`)
  })
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]').forEach((el) => {
    if (!visible(el) && !(el.type === 'radio' || el.type === 'checkbox')) return
    const cs = getComputedStyle(el)
    // Links inside a sentence are exempt from the tap size.
    if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li, td, small, span.form-hint, .ac-note')) return
    let box = el
    if (el.type === 'radio' || el.type === 'checkbox') box = el.closest('label') || el
    if (!visible(box)) return
    const r = box.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) out.small.push(describe(el, r))
    // A control that sticks out past the screen edge is cut off or unreachable.
    const er = el.getBoundingClientRect()
    if ((er.right > width + 1 || er.left < -1) && !inScroller(el)) out.cut.push(describe(el, er) + ` at x ${Math.round(er.left)}–${Math.round(er.right)}`)
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['radio', 'checkbox', 'file', 'range'].includes(el.type) && parseFloat(cs.fontSize) < 16) {
      out.tinyText.push(describe(el, r) + ` font ${cs.fontSize}`)
    }
  })
  return out
}

/** The last field of the form is still on screen after focusing it (the keyboard check). */
async function lastFieldVisible(page) {
  return await page.evaluate(() => {
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select')]
      .filter((el) => el.getBoundingClientRect().height > 0)
    const last = fields[fields.length - 1]
    if (!last) return true
    last.focus({ preventScroll: true })
    last.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = last.getBoundingClientRect()
    if (r.bottom <= 0 || r.top >= window.innerHeight) return false
    const covering = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return Boolean(covering && (covering === last || last.contains(covering) || covering.contains(last)))
  })
}

/* --------------------------------------------------------------------------
 * Screens and states
 * ------------------------------------------------------------------------ */

const fillPersonal = async (page) => {
  await page.fill('#field-firstName', 'Abenaa')
  await page.fill('#field-lastName', 'Konadu-Mensah')
  await page.fill('#field-phone', '0241234567')
  await page.getByRole('radio', { name: /mobile money/i }).click()
}
const startRegistration = async (page) => {
  await page.getByRole('radio', { name: /box for less/i }).first().click()
  await page.getByRole('button', { name: /continue/i }).last().click()
  await page.waitForSelector('#field-firstName')
}
const toFaceStep = async (page) => {
  await startRegistration(page)
  await fillPersonal(page)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await page.waitForTimeout(800)
}
const captureFace = async (page) => {
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 8000 })
  await page.getByRole('button', { name: /capture|take photo|scan/i }).first().click()
  await page.waitForTimeout(600)
}
const toPositionStep = async (page) => {
  await toFaceStep(page)
  await captureFace(page)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await page.waitForSelector('#field-position')
}
const toCheckInScan = async (page) => {
  await page.fill('#field-staffId', 'BFL-0007')
  await page.keyboard.press('Enter')
  await page.waitForSelector('video', { timeout: 8000 })
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 8000 })
}
const withVisitSession = (session = TRACKING_SESSION) => async (context) => {
  await context.addInitScript((s) => { try { localStorage.setItem('tracking:session', JSON.stringify(s)) } catch { /* none */ } }, session)
}
/** A visit session on a phone whose GPS answers at once (the headless browser's own never does). */
const withGpsSession = async (context) => {
  await withVisitSession()(context)
  await context.addInitScript(() => {
    const fix = { coords: { latitude: 5.6037, longitude: -0.187, accuracy: 8 }, timestamp: Date.now() }
    const gps = { watchPosition: (ok) => { setTimeout(() => ok(fix), 50); return 1 }, getCurrentPosition: (ok) => setTimeout(() => ok(fix), 50), clearWatch: () => {} }
    Object.defineProperty(navigator, 'geolocation', { value: gps, configurable: true })
  })
}
const withHrSession = async (context) => {
  await context.addInitScript(([key, session]) => { try { localStorage.setItem(key, JSON.stringify(session)) } catch { /* none */ } }, [`sb-${REF}-auth-token`, hrSession()])
}

export const SCREENS = [
  { name: 'home', path: '/', states: [{ name: 'default' }] },
  {
    name: 'register', path: '/register', form: true, states: [
      { name: 'welcome' },
      { name: 'personal', act: startRegistration },
      { name: 'face', act: toFaceStep, camera: true },
      { name: 'position', act: toPositionStep },
      {
        name: 'shop-picker', act: async (page) => {
          await toPositionStep(page)
          await page.fill('#field-position', 'Sales Representative')
          await page.waitForTimeout(400)
        },
      },
    ],
  },
  {
    name: 'attendance', path: '/attendance', states: [
      { name: 'staff-id' },
      { name: 'scan', act: toCheckInScan, camera: true },
      {
        name: 'success', act: async (page) => {
          await toCheckInScan(page)
          await page.getByRole('button', { name: /scan/i }).last().click()
          await page.waitForSelector('.success-card', { timeout: 8000 })
        },
      },
    ],
  },
  {
    name: 'visit', path: '/visit', states: [
      { name: 'no-session' },
      { name: 'shops', setup: withVisitSession() },
      { name: 'other-outlet', setup: withVisitSession(), act: async (page) => { await page.getByLabel(/other outlet/i).check() } },
      {
        name: 'camera', setup: withVisitSession(), camera: true, act: async (page) => {
          await page.getByRole('button', { name: /scan face and save/i }).click()
          await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 8000 })
        },
      },
      {
        name: 'saved', setup: withVisitSession(), act: async (page) => {
          await page.getByRole('button', { name: /scan face and save/i }).click()
          await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 8000 })
          await page.getByRole('button', { name: /save visit/i }).click()
          await page.waitForSelector('[role=status]', { timeout: 8000 })
        },
      },
    ],
  },
  {
    name: 'shop-location', path: '/shop-location', states: [
      { name: 'no-session' },
      { name: 'shops', setup: withVisitSession() },
      {
        name: 'reading', setup: withGpsSession, act: async (page) => {
          await page.getByRole('button', { name: /set location here/i }).click()
          await page.getByRole('button', { name: /send this location to hr/i }).waitFor({ timeout: 8000 })
        },
      },
      {
        name: 'sent', setup: withGpsSession, act: async (page) => {
          await page.getByRole('button', { name: /set location here/i }).click()
          await page.getByRole('button', { name: /send this location to hr/i }).click({ timeout: 8000 })
          await page.waitForSelector('.form-success', { timeout: 8000 })
        },
      },
    ],
  },
  { name: 'enroll', path: '/enroll/sample-token', states: [{ name: 'valid' }] },
  { name: 'enroll-closed', path: '/enroll/closed', states: [{ name: 'closed' }] },
  { name: 'verify', path: '/verify/sample-token', states: [{ name: 'default' }] },
  { name: 'hr-setup', path: '/hr/setup/sample-token', form: true, states: [{ name: 'default' }] },
  { name: 'hr-reset', path: '/hr/reset/sample-token', form: true, states: [{ name: 'default' }] },
  { name: 'privacy', path: '/privacy', states: [{ name: 'default' }] },
  { name: 'tracking-policy', path: '/tracking-policy', states: [{ name: 'default' }] },
  { name: 'terms', path: '/terms', states: [{ name: 'default' }] },
  { name: 'cookies', path: '/cookies', states: [{ name: 'default' }] },
  { name: 'display', path: '/display', overflowOnly: true, states: [{ name: 'default' }] },
  { name: 'hr-sign-in', path: '/hr', form: true, states: [{ name: 'default' }] },
  {
    name: 'hr-dashboard', path: '/hr#dashboard', hr: true,
    states: [{ name: 'default', setup: withHrSession, act: async (page) => { await page.waitForSelector('.hr-sidebar, .hr-nav', { timeout: 10000 }) } }],
  },
  // The HR menu on phones: one bar with a menu button; the sections open in a panel.
  {
    name: 'hr-menu', path: '/hr#settings', hr: true, states: [
      {
        name: 'closed', setup: withHrSession, act: async (page) => {
          await page.waitForSelector('.hr-menu-btn', { state: 'visible', timeout: 10000 })
          if (await page.locator('.hr-sidebar .hr-nav').isVisible()) throw new Error('the sideways section strip is still shown')
          if (!(await page.locator('.hr-current-title', { hasText: 'Settings' }).isVisible())) throw new Error('the bar does not name the current section')
        },
      },
      {
        name: 'open', setup: withHrSession, act: async (page) => {
          await page.click('.hr-menu-btn')
          const panel = page.getByRole('dialog', { name: /menu/i })
          await panel.waitFor({ state: 'visible', timeout: 5000 })
          for (const label of ['Dashboard', 'Employees', 'Attendance', 'Settings', 'Sign out', 'Exit']) {
            if (!(await panel.getByRole('button', { name: label, exact: true }).first().isVisible())) throw new Error(`the menu has no ${label}`)
          }
          if ((await page.locator('.hr-menu-btn').getAttribute('aria-expanded')) !== 'true') throw new Error('the menu button does not say it is open')
          if (!(await panel.getByRole('button', { name: 'Close menu' }).isVisible())) throw new Error('the menu has no visible close button')
        },
      },
      {
        name: 'close-button', setup: withHrSession, act: async (page) => {
          await page.click('.hr-menu-btn')
          const panel = page.getByRole('dialog', { name: /menu/i })
          await panel.getByRole('button', { name: 'Close menu' }).click({ timeout: 5000 })
          await panel.waitFor({ state: 'hidden', timeout: 5000 })
        },
      },
      {
        name: 'escape-closes', setup: withHrSession, act: async (page) => {
          await page.click('.hr-menu-btn')
          await page.getByRole('dialog', { name: /menu/i }).waitFor({ state: 'visible', timeout: 5000 })
          await page.keyboard.press('Escape')
          await page.getByRole('dialog', { name: /menu/i }).waitFor({ state: 'hidden', timeout: 5000 })
          if (!(await page.evaluate(() => document.activeElement?.classList.contains('hr-menu-btn')))) throw new Error('focus did not return to the menu button')
        },
      },
      {
        name: 'pick-section', setup: withHrSession, act: async (page) => {
          await page.click('.hr-menu-btn')
          const panel = page.getByRole('dialog', { name: /menu/i })
          await panel.getByRole('button', { name: 'Employees', exact: true }).click()
          await panel.waitFor({ state: 'hidden', timeout: 5000 })
          if (!(await page.locator('.hr-current-title', { hasText: 'Employees' }).isVisible())) throw new Error('picking a section did not open it')
        },
      },
    ],
  },
  // The other HR screens are kept per company: open Box For Less, as HR would.
  ...['employees', 'attendance', 'live-tracker', 'sales-monitoring', 'sales-rep-monitoring', 'reports', 'payroll', 'settings'].map((section) => ({
    name: `hr-${section}`, path: `/hr#${section}`, hr: true, states: [{
      name: 'box-for-less', setup: withHrSession, act: async (page) => {
        await page.waitForSelector('.hr-sidebar, .hr-nav', { timeout: 10000 })
        await page.selectOption('.hr-company-select', 'box-for-less').catch(() => {})
        await page.waitForTimeout(800)
      },
    }],
  })),
]

/* --------------------------------------------------------------------------
 * Running
 * ------------------------------------------------------------------------ */

async function newContext(browser, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 5.6037, longitude: -0.187 },
  })
  await context.route('**/functions/v1/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^.*\/functions\/v1\/api/, '')
    const [status, body] = apiFixture(route.request().method(), path + (url.search || ''))
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/rest/v1/')[1].split('?')[0]
    const rows = restFixture(table)
    const accept = route.request().headers().accept ?? ''
    const single = accept.includes('vnd.pgrst.object')
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(single ? rows[0] ?? null : rows) })
  })
  await context.route('**/storage/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await context.route('**/auth/v1/**', async (route) => {
    const session = hrSession()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/user') ? session.user : session) })
  })
  await context.route('**/realtime/**', (route) => route.abort())
  await context.route(new RegExp('/src/services/faceRecognition\\.js'), (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FACE_STUB }))
  return context
}

async function runState(browser, base, size, screen, state) {
  const context = await newContext(browser, size)
  try {
    if (state.setup) await state.setup(context)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(base + screen.path, { waitUntil: 'networkidle' })
    if (state.act) await state.act(page)
    await page.waitForTimeout(300)
    const m = await page.evaluate(measure, size.width)
    const reasons = []
    if (m.overflow) reasons.push(`scrolls sideways (${m.scrollWidth}px wide)`)
    if (m.cut.length) reasons.push(`cut off at the screen edge: ${m.cut.slice(0, 4).join('; ')}`)
    if (m.squeezed.length) reasons.push(`table text squeezed: ${m.squeezed.slice(0, 3).join('; ')}`)
    if (!screen.overflowOnly) {
      if (m.small.length) reasons.push(`small targets: ${m.small.slice(0, 6).join('; ')}${m.small.length > 6 ? ` …+${m.small.length - 6}` : ''}`)
      if (m.tinyText.length) reasons.push(`inputs under 16px: ${m.tinyText.slice(0, 4).join('; ')}`)
      if (screen.form && !(await lastFieldVisible(page))) reasons.push('the last field is covered when focused')
    }
    if (errors.length) reasons.push(`page error: ${errors[0].slice(0, 120)}`)
    const dir = new URL(`${size.name}/`, OUT)
    mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: fileURLToPath(new URL(`${screen.name}--${state.name}.png`, dir)), fullPage: true })
    return reasons
  } catch (error) {
    return [`could not reach this state: ${String(error.message).split('\n')[0].slice(0, 140)}`]
  } finally {
    await context.close()
  }
}

const server = await startServer()
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
let failures = 0
let warnings = 0
let passes = 0
try {
  for (const screen of SCREENS.filter((s) => !ONLY || s.name === ONLY || s.name.startsWith(`${ONLY}`))) {
    for (const state of screen.states) {
      const sizes = [...SIZES, ...(state.camera ? [LANDSCAPE] : [])].filter((s) => !(screen.hr && !s.blocking))
      for (const size of sizes) {
        const reasons = await runState(browser, server.base, size, screen, state)
        const label = `${size.name} ${screen.name}/${state.name}`
        if (!reasons.length) { passes += 1; console.log(`pass  ${label}`) } else if (size.blocking) { failures += 1; console.log(`FAIL  ${label}  ->  ${reasons.join(' | ')}`) } else { warnings += 1; console.log(`warn  ${label}  ->  ${reasons.join(' | ')}`) }
      }
    }
  }
} finally {
  await browser.close()
  server.stop()
}
console.log(`\n${passes} passed, ${failures} failed, ${warnings} warnings (320 px, not blocking)`)
process.exit(failures ? 1 : 0)
