import { readFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import vm from 'node:vm'
import { createElement } from 'react'
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createStorage() {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

function renderAsync(element) {
  return new Promise((resolve, reject) => {
    let html = ''
    const writable = new Writable({
      write(chunk, _encoding, cb) {
        html += chunk.toString()
        cb()
      },
    })
    const { pipe } = renderToPipeableStream(element, {
      onAllReady() {
        pipe(writable)
      },
      onError(err) {
        reject(err)
      },
    })
    writable.on('finish', () => resolve(html))
    writable.on('error', reject)
  })
}

const localStore = createStorage()
const sessionStore = createStorage()

function setupWindow({ pathname = '/', search = '', standalone = false } = {}) {
  const listeners = new Map()
  const historyEntries = [`${pathname}${search}`]
  const win = {
    location: {
      origin: 'https://workrecords.online',
      pathname,
      search,
      href: `https://workrecords.online${pathname}${search}`,
      reload: vi.fn(),
    },
    navigator: {
      standalone,
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      maxTouchPoints: 5,
    },
    localStorage: localStore,
    sessionStorage: sessionStore,
    matchMedia: (query) => ({
      matches: query === '(display-mode: standalone)' ? standalone : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    history: {
      get length() {
        return historyEntries.length
      },
      pushState(_state, _title, url) {
        const parsed = new URL(url, 'https://workrecords.online')
        historyEntries.push(`${parsed.pathname}${parsed.search}`)
        win.location.pathname = parsed.pathname
        win.location.search = parsed.search
        win.location.href = parsed.href
      },
      replaceState(_state, _title, url) {
        const parsed = new URL(url, 'https://workrecords.online')
        historyEntries[historyEntries.length - 1] = `${parsed.pathname}${parsed.search}`
        win.location.pathname = parsed.pathname
        win.location.search = parsed.search
        win.location.href = parsed.href
      },
      back() {
        if (historyEntries.length > 1) {
          historyEntries.pop()
          const top = historyEntries[historyEntries.length - 1]
          const parsed = new URL(top, 'https://workrecords.online')
          win.location.pathname = parsed.pathname
          win.location.search = parsed.search
          win.location.href = parsed.href
        }
        win.dispatchEvent({ type: 'popstate' })
      },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type)
      if (!set) return true
      for (const fn of [...set]) fn(event)
      return !event.defaultPrevented
    },
    scrollTo: () => {},
    _historyEntries: historyEntries,
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('localStorage', localStore)
  vi.stubGlobal('sessionStorage', sessionStore)
  vi.stubGlobal('navigator', win.navigator)
  return win
}

beforeEach(() => {
  localStore.clear()
  sessionStore.clear()
  setupWindow()
})

describe('1. Installed PWA routing & field navigation (#1 & #11)', () => {
  it('renders kiosk AttendanceCheckIn on / and /attendance when installed, but renders explicit policy/register routes', async () => {
    const { default: App } = await import('../src/App.jsx')

    setupWindow({ pathname: '/', standalone: true })
    const homeInstalled = await renderAsync(createElement(App))
    expect(homeInstalled).toContain('Enter your Staff ID')
    expect(homeInstalled).not.toContain('>Back<')

    setupWindow({ pathname: '/attendance', standalone: true })
    const attendanceInstalled = await renderAsync(createElement(App))
    expect(attendanceInstalled).toContain('Enter your Staff ID')
    expect(attendanceInstalled).not.toContain('>Back<')

    setupWindow({ pathname: '/tracking-policy', standalone: true })
    const trackingPolicyHtml = await renderAsync(createElement(App))
    expect(trackingPolicyHtml).toContain('Tracking')
    expect(trackingPolicyHtml).not.toContain('Enter your Staff ID')

    setupWindow({ pathname: '/privacy', standalone: true })
    const privacyHtml = await renderAsync(createElement(App))
    expect(privacyHtml).toContain('Privacy')
    expect(privacyHtml).not.toContain('Enter your Staff ID')

    setupWindow({ pathname: '/terms', standalone: true })
    const termsHtml = await renderAsync(createElement(App))
    expect(termsHtml).toContain('Terms')

    setupWindow({ pathname: '/cookies', standalone: true })
    const cookiesHtml = await renderAsync(createElement(App))
    expect(cookiesHtml).toContain('Cookie')
  })

  it('includes Record visit, Set shop GPS, and Clock out navigation in LocationSharingBar based on session & route', async () => {
    const { saveTrackingSession } = await import('../src/services/visitService.js')
    const { default: LocationSharingBar } = await import('../src/components/tracking/LocationSharingBar.jsx')
    const future = new Date(Date.now() + 3_600_000).toISOString()

    // Sales Rep on /visit: sees Record visit, Set shop GPS, AND Clock out
    setupWindow({ pathname: '/visit', standalone: true })
    saveTrackingSession({
      type: 'check-in',
      staffId: 'BFL-0007',
      fullName: 'Kofi Boateng',
      trackingToken: 'tok-rep',
      trackingClosesAt: future,
      canRecordVisits: true,
    })
    const onVisitHtml = renderToStaticMarkup(createElement(LocationSharingBar))
    expect(onVisitHtml).toContain('href="/visit"')
    expect(onVisitHtml).toContain('Record visit')
    expect(onVisitHtml).toContain('href="/shop-location"')
    expect(onVisitHtml).toContain('Set shop GPS')
    expect(onVisitHtml).toContain('href="/attendance"')
    expect(onVisitHtml).toContain('Clock out')

    // On /attendance: hides redundant Clock out link while keeping Record visit & Set shop GPS
    setupWindow({ pathname: '/attendance', standalone: true })
    const onAttendanceHtml = renderToStaticMarkup(createElement(LocationSharingBar))
    expect(onAttendanceHtml).toContain('Record visit')
    expect(onAttendanceHtml).toContain('Set shop GPS')
    expect(onAttendanceHtml).not.toContain('Clock out')

    // Merchandiser (canRecordVisits: false) on /shop-location: hides Record visit, keeps Set shop GPS & Clock out
    saveTrackingSession({
      type: 'check-in',
      staffId: 'BFL-0009',
      fullName: 'Ama Mensah',
      trackingToken: 'tok-merch',
      trackingClosesAt: future,
      canRecordVisits: false,
    })
    setupWindow({ pathname: '/shop-location', standalone: true })
    const merchHtml = renderToStaticMarkup(createElement(LocationSharingBar))
    expect(merchHtml).not.toContain('Record visit')
    expect(merchHtml).toContain('Set shop GPS')
    expect(merchHtml).toContain('Clock out')
  })

  it('gives standalone users a clear link back to /attendance on both RecordVisit and SetShopLocation', async () => {
    const { default: RecordVisit } = await import('../src/pages/RecordVisit.jsx')
    const { default: SetShopLocation } = await import('../src/pages/SetShopLocation.jsx')

    setupWindow({ pathname: '/visit', standalone: true })
    const visitClosedHtml = renderToStaticMarkup(createElement(RecordVisit))
    expect(visitClosedHtml).toContain('href="/attendance"')

    setupWindow({ pathname: '/shop-location', standalone: true })
    const shopClosedHtml = renderToStaticMarkup(createElement(SetShopLocation))
    expect(shopClosedHtml).toContain('href="/attendance"')
  })

  it('does not re-push stale ?site= query params on kiosk popstate and strips ?site= in AttendanceCheckIn (#11)', () => {
    const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const checkInSrc = readFileSync(new URL('../src/pages/AttendanceCheckIn.jsx', import.meta.url), 'utf8')

    expect(appSrc).toContain("const hold = () => window.history.pushState(null, '', '/attendance')")
    expect(checkInSrc).toContain("window.history.replaceState(null, '', window.location.pathname)")
  })
})

describe('2. Stationary Kiosk GPS Guard (#2A)', () => {
  it('guards saveTrackingSession against Workplace Display site-pass check-ins', () => {
    const checkInSrc = readFileSync(new URL('../src/pages/AttendanceCheckIn.jsx', import.meta.url), 'utf8')
    expect(checkInSrc).toContain("const isSitePassCheckIn = Boolean(site?.pass) && event.type === 'check-in'")
    expect(checkInSrc).toMatch(/if\s*\(!isSitePassCheckIn\)\s*\{\s*saveTrackingSession\(event\)/)
  })
})

describe('3. Service Worker, ErrorBoundary, preload recovery & Vercel routing (#3)', () => {
  function bootServiceWorker(fetchImpl) {
    const swCode = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    const handlers = {}
    const buckets = new Map()
    const keyOf = (req) => (typeof req === 'string' ? `https://workrecords.online${req}` : req.url)

    const caches = {
      async open(name) {
        if (!buckets.has(name)) buckets.set(name, new Map())
        const bucket = buckets.get(name)
        return {
          async addAll(urls) {
            for (const u of urls) {
              bucket.set(keyOf(u), { ok: true, status: 200, body: `precached:${u}`, headers: new Headers({ 'content-type': u === '/' ? 'text/html' : 'application/octet-stream' }), clone() { return { ...this } } })
            }
          },
          async put(req, res) {
            bucket.set(keyOf(req), res)
          },
          async match(req) {
            return bucket.get(keyOf(req))
          },
        }
      },
      async keys() {
        return [...buckets.keys()]
      },
      async delete(name) {
        return buckets.delete(name)
      },
      async match(req) {
        for (const bucket of buckets.values()) {
          if (bucket.has(keyOf(req))) return bucket.get(keyOf(req))
        }
        return undefined
      },
    }

    const self = {
      location: { origin: 'https://workrecords.online' },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
      addEventListener(type, fn) {
        handlers[type] = fn
      },
    }

    vm.runInNewContext(swCode, {
      self,
      caches,
      fetch: fetchImpl,
      URL,
      Headers,
      Response: { error: () => ({ ok: false, status: 0, type: 'error' }) },
    })

    return { handlers, buckets, caches }
  }

  function makeResponse({ status = 200, contentType = 'text/html', body = '' } = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      body,
      headers: new Headers({ 'content-type': contentType }),
      clone() {
        return makeResponse({ status, contentType, body })
      },
    }
  }

  it('uses VERSION v2, purges v1 caches, only caches HTML on navigate, and serves manifest/icons stale-while-revalidate', async () => {
    let fetchHandler = async () => makeResponse({ status: 200, contentType: 'text/html', body: '<html>fresh</html>' })
    const { handlers, buckets } = bootServiceWorker((...args) => fetchHandler(...args))

    // Seed old v1 caches to verify activate cleanup
    buckets.set('shell-v1', new Map())
    buckets.set('assets-v1', new Map())

    let installDone
    handlers.install({ waitUntil: (p) => { installDone = p } })
    await installDone
    expect(buckets.has('shell-v2')).toBe(true)

    let activateDone
    handlers.activate({ waitUntil: (p) => { activateDone = p } })
    await activateDone
    expect(buckets.has('shell-v1')).toBe(false)
    expect(buckets.has('assets-v1')).toBe(false)

    // 1. Navigate 502 error page MUST NOT overwrite cached '/' shell
    fetchHandler = async () => makeResponse({ status: 502, contentType: 'text/html', body: 'Bad Gateway' })
    let navResponse
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://workrecords.online/attendance' },
      respondWith: (p) => { navResponse = p },
      waitUntil: () => {},
    })
    const badRes = await navResponse
    expect(badRes.status).toBe(502)
    expect(buckets.get('shell-v2').get('https://workrecords.online/').body).toBe('precached:/')

    // 2. Navigate 200 non-HTML response MUST NOT overwrite cached '/' shell
    fetchHandler = async () => makeResponse({ status: 200, contentType: 'application/json', body: '{}' })
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://workrecords.online/attendance' },
      respondWith: (p) => { navResponse = p },
      waitUntil: () => {},
    })
    await navResponse
    expect(buckets.get('shell-v2').get('https://workrecords.online/').body).toBe('precached:/')

    // 3. Navigate 200 text/html updates SHELL '/'
    fetchHandler = async () => makeResponse({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html>v2-shell</html>' })
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://workrecords.online/attendance' },
      respondWith: (p) => { navResponse = p },
      waitUntil: () => {},
    })
    await navResponse
    await new Promise((r) => setTimeout(r, 10))
    expect(buckets.get('shell-v2').get('https://workrecords.online/').body).toBe('<html>v2-shell</html>')

    // 4. Stale-while-revalidate on /manifest.webmanifest & /icons/*
    fetchHandler = async () => makeResponse({ status: 200, contentType: 'application/manifest+json', body: '{"name":"Updated"}' })
    let swrResponse
    let bgTask
    handlers.fetch({
      request: { method: 'GET', mode: 'cors', url: 'https://workrecords.online/manifest.webmanifest' },
      respondWith: (p) => { swrResponse = p },
      waitUntil: (p) => { bgTask = p },
    })
    const immediate = await swrResponse
    expect(immediate.body).toBe('precached:/manifest.webmanifest')
    await bgTask
    expect(buckets.get('shell-v2').get('https://workrecords.online/manifest.webmanifest').body).toBe('{"name":"Updated"}')

    // 5. Cache-first on /assets/*
    let assetNetworkCalls = 0
    fetchHandler = async () => {
      assetNetworkCalls += 1
      return makeResponse({ status: 200, contentType: 'application/javascript', body: 'console.log(1)' })
    }
    let assetResPromise
    const assetReq = { method: 'GET', mode: 'cors', url: 'https://workrecords.online/assets/index-abc.js' }
    handlers.fetch({ request: assetReq, respondWith: (p) => { assetResPromise = p }, waitUntil: () => {} })
    expect((await assetResPromise).body).toBe('console.log(1)')
    handlers.fetch({ request: assetReq, respondWith: (p) => { assetResPromise = p }, waitUntil: () => {} })
    expect((await assetResPromise).body).toBe('console.log(1)')
    expect(assetNetworkCalls).toBe(1)
  })

  it('renders ErrorBoundary recovery card with Reload app button when a child throws', async () => {
    const { default: ErrorBoundary } = await import('../src/components/common/ErrorBoundary.jsx')

    const okHtml = renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', null, 'Healthy screen')))
    expect(okHtml).toContain('Healthy screen')

    const onReload = vi.fn()
    const boundary = new ErrorBoundary({ onReload, children: null })
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('ChunkLoadError'))
    const fallbackHtml = renderToStaticMarkup(boundary.render())
    expect(fallbackHtml).toContain('Reload app')
    expect(fallbackHtml).toContain('role="alert"')
    boundary.handleReload()
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('reloads at most once per 15s on vite:preloadError in main.jsx', async () => {
    const win = setupWindow({ pathname: '/' })
    const renderSpy = vi.fn()
    vi.doMock('react-dom/client', () => ({
      createRoot: () => ({ render: renderSpy }),
    }))
    vi.stubGlobal('document', { getElementById: () => ({}) })

    await import('../src/main.jsx')
    expect(renderSpy).toHaveBeenCalledTimes(1)

    let prevented1 = false
    win.dispatchEvent({ type: 'vite:preloadError', preventDefault: () => { prevented1 = true } })
    expect(prevented1).toBe(true)
    expect(win.location.reload).toHaveBeenCalledTimes(1)

    // Second preload error within 15s must NOT trigger an infinite reload loop
    let prevented2 = false
    win.dispatchEvent({ type: 'vite:preloadError', preventDefault: () => { prevented2 = true } })
    expect(prevented2).toBe(false)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('configures vercel.json cache headers and excludes static files/directories from SPA rewrites', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const swHeader = config.headers.find((h) => h.source === '/sw.js')
    const assetsHeader = config.headers.find((h) => h.source === '/assets/(.*)')
    expect(swHeader?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-cache' })
    expect(assetsHeader?.headers).toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' })

    const source = config.rewrites[0].source
    // Convert "/(<inner>)" to an anchored RegExp matching URL pathnames
    const inner = source.slice(2, -1)
    const rewriteRegex = new RegExp(`^\\/(${inner})$`, 'i')

    for (const spaRoute of ['/', '/attendance', '/visit', '/shop-location', '/privacy', '/tracking-policy', '/terms', '/cookies', '/register', '/hr', '/hr/setup/tok123', '/verify/abc99']) {
      expect(rewriteRegex.test(spaRoute), `expected SPA route ${spaRoute} to rewrite`).toBe(true)
    }

    for (const staticPath of [
      '/sw.js',
      '/manifest.webmanifest',
      '/favicon.svg',
      '/favicon.ico',
      '/assets/index-FiMi1vqv.js',
      '/assets/old-chunk.mjs',
      '/assets/index.css',
      '/assets/chunk.js.map',
      '/face-models/ssd_mobilenetv1_model-shard1',
      '/face-models/ssd_mobilenetv1_model-weights_manifest.json',
      '/icons/icon-192.png',
      '/icons/icon.svg',
      '/fonts/inter.woff2',
      '/fonts/inter.woff',
      '/fonts/inter.ttf',
    ]) {
      expect(rewriteRegex.test(staticPath), `expected static path ${staticPath} NOT to rewrite`).toBe(false)
    }
  })
})

describe('4 & 5. Mobile bottom bar clearance (#10) and Home entry bundle trim (#13)', () => {
  it('offsets .ls-bar for safe-area-inset-bottom and pads pages when .ls-bar is present', () => {
    const lsCss = readFileSync(new URL('../src/components/tracking/location-sharing.css', import.meta.url), 'utf8')
    const mobileCss = readFileSync(new URL('../src/styles/mobile.css', import.meta.url), 'utf8')

    expect(lsCss).toContain('bottom: calc(16px + env(safe-area-inset-bottom, 0px))')
    expect(lsCss).toMatch(/body:has\(\.ls-bar\)\s+\.registration-page/)
    expect(mobileCss).toMatch(/body:has\(\.ls-bar\)\s+\.registration-page/)
  })

  it('trims Home.jsx duplicate CSS import and reads workforce:device-registered from localStorage without importing registrationService', async () => {
    const homeSrc = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8')
    const allImports = homeSrc.split(/\r?\n/).filter((line) => line.trim().startsWith('import '))
    const cssImportLines = allImports.filter((line) => line.includes('registration.css'))
    expect(cssImportLines).toHaveLength(1)
    expect(allImports.some((line) => line.includes('registrationService') || line.includes('supabase'))).toBe(false)
    expect(homeSrc).not.toContain('registrationService')

    const { default: Home } = await import('../src/pages/Home.jsx')
    setupWindow({ pathname: '/' })
    const freshDeviceHtml = renderToStaticMarkup(createElement(Home, {}))
    expect(freshDeviceHtml).toContain('New Employee Registration')

    localStore.setItem('workforce:device-registered', '1')
    const registeredDeviceHtml = renderToStaticMarkup(createElement(Home, {}))
    expect(registeredDeviceHtml).not.toContain('New Employee Registration')
  })
})
