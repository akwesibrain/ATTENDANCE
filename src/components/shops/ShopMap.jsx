import { useEffect, useRef, useState } from 'react'

const TILE = 256
const GHANA = { latitude: 7.95, longitude: -1.03 }

function worldSize(z) {
  return TILE * 2 ** z
}

function toPixel(lat, lng, z) {
  const ws = worldSize(z)
  const latR = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180
  return [((lng + 180) / 360) * ws, ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * ws]
}

function toLatLng(px, py, z) {
  const ws = worldSize(z)
  const lng = (px / ws) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / ws))) * 180) / Math.PI
  return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]
}

function useWidth(fallback = 560) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/**
 * Small slippy map. Shows OpenStreetMap tiles when location services are
 * configured; HR clicks (or uses the nudge buttons) to place/move the pin.
 * Without tiles it shows a plain grid and the pin only if coordinates exist.
 */
export default function ShopMap({ latitude, longitude, tileUrl, attribution, onPick, height = 280, label = 'Shop location' }) {
  const hasPin = latitude != null && longitude != null
  const [zoom, setZoom] = useState(hasPin ? 17 : 7)
  const [center, setCenter] = useState(hasPin ? { latitude, longitude } : GHANA)
  const [ref, width] = useWidth()

  // Follow the pin when it changes from outside (e.g. a search result) —
  // derived during render rather than in an effect.
  const pinKey = hasPin ? `${latitude},${longitude}` : ''
  const [followed, setFollowed] = useState(pinKey)
  if (pinKey !== followed) {
    setFollowed(pinKey)
    if (hasPin) {
      setCenter({ latitude, longitude })
      setZoom((z) => Math.max(z, 16))
    }
  }

  const [cx, cy] = toPixel(center.latitude, center.longitude, zoom)
  const left = cx - width / 2
  const top = cy - height / 2
  const n = 2 ** zoom
  const tiles = []
  if (tileUrl) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
        if (ty < 0 || ty >= n) continue
        const wx = ((tx % n) + n) % n
        tiles.push({ key: `${zoom}-${tx}-${ty}`, src: tileUrl.replace('{z}', zoom).replace('{x}', wx).replace('{y}', ty), x: tx * TILE - left, y: ty * TILE - top })
      }
    }
  }
  const pin = hasPin ? (() => { const [px, py] = toPixel(latitude, longitude, zoom); return [px - left, py - top] })() : null

  const pick = (lat, lng) => {
    setCenter({ latitude: lat, longitude: lng })
    onPick?.(lat, lng)
  }
  const onClick = (e) => {
    if (!onPick || !tileUrl) return
    const rect = e.currentTarget.getBoundingClientRect()
    const [lat, lng] = toLatLng(left + (e.clientX - rect.left), top + (e.clientY - rect.top), zoom)
    pick(lat, lng)
  }
  const nudge = (dx, dy) => {
    if (!hasPin) return
    const [px, py] = toPixel(latitude, longitude, zoom)
    const [lat, lng] = toLatLng(px + dx, py + dy, zoom)
    pick(lat, lng)
  }

  return (
    <div className="smap">
      <div
        ref={ref}
        className={`smap-view${tileUrl ? '' : ' is-blank'}${onPick && tileUrl ? ' is-pickable' : ''}`}
        style={{ height }}
        onClick={onClick}
        role="img"
        aria-label={hasPin ? `${label}: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : `${label}: not set`}
      >
        {tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" draggable={false} className="smap-tile" style={{ left: t.x, top: t.y }} />
        ))}
        {!tileUrl && (
          <p className="smap-blank">
            {hasPin ? 'Map tiles are off (location services not configured). The pin shows the saved coordinates.' : 'Map not available: location services are not configured.'}
          </p>
        )}
        {pin && (
          <span className="smap-pin" style={{ left: tileUrl ? pin[0] : width / 2, top: tileUrl ? pin[1] : height / 2 }} aria-hidden="true">
            <svg width="28" height="36" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.3 12 32 12 32s12-11.7 12-20.3C24 5.2 18.6 0 12 0z" fill="currentColor" /><circle cx="12" cy="11.5" r="4.5" fill="#fff" /></svg>
          </span>
        )}
      </div>
      <div className="smap-controls">
        {tileUrl && (
          <>
            <button type="button" className="sm-actions-btn" onClick={() => setZoom((z) => Math.min(19, z + 1))} aria-label="Zoom in">+</button>
            <button type="button" className="sm-actions-btn" onClick={() => setZoom((z) => Math.max(3, z - 1))} aria-label="Zoom out">−</button>
          </>
        )}
        {onPick && hasPin && tileUrl && (
          <span className="smap-nudge" role="group" aria-label="Move pin">
            <button type="button" className="sm-actions-btn" onClick={() => nudge(0, -6)} aria-label="Move pin north">↑</button>
            <button type="button" className="sm-actions-btn" onClick={() => nudge(0, 6)} aria-label="Move pin south">↓</button>
            <button type="button" className="sm-actions-btn" onClick={() => nudge(-6, 0)} aria-label="Move pin west">←</button>
            <button type="button" className="sm-actions-btn" onClick={() => nudge(6, 0)} aria-label="Move pin east">→</button>
          </span>
        )}
        {onPick && tileUrl && <span className="smap-hint">Click the map to place or move the pin.</span>}
        {attribution && tileUrl && <span className="smap-attr">{attribution}</span>}
      </div>
    </div>
  )
}
