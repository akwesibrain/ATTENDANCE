/*
 * Service worker for the installable app.
 *
 * - Pages: network first, caching only valid HTML responses in SHELL and
 *   falling back to the saved app shell on a weak or missing connection.
 * - App manifest and icons: stale-while-revalidate from SHELL.
 * - Built files under /assets/ (their names change on every build): cache first.
 * - Anything from another site (map tiles, fonts, a future API) is never
 *   cached here, so live data is never served stale.
 *
 * Bump VERSION to drop old caches after a release.
 */
const VERSION = 'v2'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

function isHtmlResponse(res) {
  return Boolean(res && res.ok && (res.headers.get('content-type') || '').includes('text/html'))
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isHtmlResponse(res)) {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    )
    return
  }

  if (url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(SHELL).then((cache) =>
        cache.match(req).then((cached) => {
          const revalidate = fetch(req)
            .then((res) => {
              if (res.ok && !isHtmlResponse(res)) {
                cache.put(req, res.clone())
              }
              return res
            })
            .catch(() => cached || Response.error())
          if (cached) {
            event.waitUntil(revalidate)
            return cached
          }
          return revalidate
        }),
      ),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res.ok && !isHtmlResponse(res)) {
            cache.put(req, res.clone())
          }
          return res
        })),
      ),
    )
  }
})
