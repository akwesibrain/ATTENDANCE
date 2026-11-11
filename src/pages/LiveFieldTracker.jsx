import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GHANA_CITIES } from '../constants/ghanaMap'
import { POSITION_SOURCE, TRACKER_GROUPS, getLiveTracker } from '../services/liveTrackerService'
import { GHANA_MAP_H, GHANA_MAP_W, ghanaOutlinePath, makeGhanaProjection } from '../utils/ghanaProjection'
import { formatAccraTime } from '../utils/accraTime'
import StreetPlane from '../components/tracker/StreetPlane'
import { locationServiceStatus, searchMapPlace } from '../services/geocodingService'
import { monitoringSettings, saveMonitoring } from '../services/settingsService'
import { getSessionUser } from '../services/permissionsService'
import { pxToLatLng, worldPx } from '../utils/webMercator'

const REFRESH_SECONDS = 30
const STALE_MINUTES = 60
const VIEWS = {
  '3d': { tilt: 54, spin: -16, zoom: 1 },
  top: { tilt: 0, spin: 0, zoom: 1 },
}
const BADGE = { supervisor: 'S', 'sales-rep': 'R', merchandiser: 'M' }
// Extruded edge of the 3D outline: a few stacked copies of the border.
const SLAB_LAYERS = [5, 4, 3, 2, 1]
const ringColor = (category) => (category === 'merchandiser' ? '#e5edf9' : TRACKER_GROUPS[category].color)
// Street map: whole of Ghana at zoom 7; street level (markets, shops) from ~15.
const STREET_HOME = { lat: 7.95, lng: -1.03, z: 7, tilt: 48, spin: -10 }
const PLACES = [
  { name: 'Accra', lat: 5.6037, lng: -0.187, z: 13 },
  { name: 'Kumasi', lat: 6.6885, lng: -1.6244, z: 13 },
  { name: 'Takoradi', lat: 4.9339, lng: -1.7137, z: 13 },
  { name: 'Tamale', lat: 9.4008, lng: -0.8393, z: 13 },
]
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function minutesAgo(iso, now) {
  if (!iso) return null
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
}

const lastSeen = (p, now) => minutesAgo(p.position?.at ?? p.lastEventAt, now)

function agoText(m) {
  if (m == null) return 'not seen today'
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}

/**
 * A person figure in the category colour, with a letter badge (S / R / M) so
 * colour is never the only cue: Supervisors green, Sales Reps red,
 * Merchandisers black.
 */
export const PersonFigure = memo(function PersonFigure({ category, size = 44 }) {
  const g = TRACKER_GROUPS[category]
  return (
    <svg width={size * 0.72} height={size} viewBox="0 0 36 50" aria-hidden="true" className={`lt-person lt-person-${category}`}>
      <ellipse cx="18" cy="47" rx="11" ry="2.6" className="lt-person-shadow" />
      <circle cx="18" cy="9" r="7" fill={g.color} stroke="#fff" strokeWidth="2" />
      <path d="M6 44V29c0-7.2 5.4-12 12-12s12 4.8 12 12v15H6Z" fill={g.color} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 44V33M24 44V33" stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="18" cy="31" r="6.4" fill="#fff" />
      <text x="18" y="35" textAnchor="middle" className="lt-person-badge" fill={g.color}>{BADGE[category]}</text>
    </svg>
  )
})

/** Small legend version of the figure. */
export function LegendKey({ category }) {
  return <PersonFigure category={category} size={22} />
}

/** The 3D outline's static drawing (land, extrusion, cities) — never redrawn on camera moves. */
const SlabMap = memo(function SlabMap({ project }) {
  const outline = useMemo(() => ghanaOutlinePath(project), [project])
  const viewBox = `0 0 ${GHANA_MAP_W} ${GHANA_MAP_H}`
  return (
    <>
      <div className="lt-grid" aria-hidden="true" />
      {SLAB_LAYERS.map((i) => (
        <svg key={i} className="lt-layer" viewBox={viewBox} style={{ transform: `translateZ(${-i * 4.3}px)` }} aria-hidden="true">
          <path d={outline} className="lt-land-side" />
        </svg>
      ))}
      <svg className="lt-layer" viewBox={viewBox} aria-hidden="true">
        <defs>
          <linearGradient id="lt-land-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1f56a8" />
            <stop offset="100%" stopColor="#0f3471" />
          </linearGradient>
        </defs>
        <path d={outline} className="lt-land" />
        {GHANA_CITIES.map((c) => {
          const [x, y] = project(c.longitude, c.latitude)
          return (
            <g key={c.name}>
              <circle cx={x} cy={y} r={c.capital ? 4 : 2.6} className="lt-city" />
              <text x={x + 7} y={y + 4} className={`lt-city-label${c.capital ? ' is-capital' : ''}`}>{c.name}</text>
            </g>
          )
        })}
      </svg>
    </>
  )
})

/** Table of field staff under the map. Memoised so camera moves don't re-render it. */
const StaffTable = memo(function StaffTable({ companyName, visible, placedCount, selected, nowMs, onPick }) {
  return (
    <section className="sm-panel lt-table">
      <div className="sm-panel-head"><h3>Field staff today</h3><span className="sm-muted">{visible.length} shown · {placedCount} on the map</span></div>
      {visible.length === 0 ? (
        <p className="sm-empty">No Supervisors, Sales Representatives or Merchandisers for {companyName}.</p>
      ) : (
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead><tr><th scope="col">Employee</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Position</th><th scope="col">Last seen</th></tr></thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.employeeId} className={selected === p.employeeId ? 'is-selected' : ''}>
                  <td data-label="Employee">{p.position ? <button type="button" className="hr-link" onClick={() => onPick(p)}>{p.fullName}</button> : p.fullName}<span className="at-sub"> · <span className="sm-mono">{p.employeeId}</span></span></td>
                  <td data-label="Category"><span className="lt-cat"><LegendKey category={p.category} /> {TRACKER_GROUPS[p.category].single}</span></td>
                  <td data-label="Status">{p.duty}</td>
                  <td data-label="Position">{p.position ? <>{POSITION_SOURCE[p.position.source]}{p.position.place && <span className="at-sub"> · {p.position.place}</span>}</> : <span className="at-none">No position yet</span>}</td>
                  <td data-label="Last seen">{agoText(lastSeen(p, nowMs))}{p.lastEvent && <span className="at-sub"> · {p.lastEvent}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
})

/**
 * Live Tracker: Supervisors, Sales Reps and Merchandisers as figures on a 3D
 * map of Ghana that fills the screen. HR can tilt, rotate and zoom it (drag,
 * buttons or keyboard) and switch to full screen. People are placed only from
 * recorded positions — see liveTrackerService.
 */
export default function LiveFieldTracker({ company }) {
  const reduced = prefersReducedMotion()
  const [tick, setTick] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [view, setView] = useState(VIEWS['3d'])
  const [autoSpin, setAutoSpin] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [show, setShow] = useState({ supervisor: true, 'sales-rep': true, merchandiser: true })
  const [selected, setSelected] = useState(null)
  const [full, setFull] = useState(false)
  const shellRef = useRef(null)
  const stageRef = useRef(null)
  const drag = useRef(null)
  const [svc, setSvc] = useState(() => locationServiceStatus())
  const [mode, setMode] = useState(() => (locationServiceStatus().tiles ? 'street' : 'slab'))
  const [sview, setSview] = useState(STREET_HOME)
  // null = automatic: dark at country scale, light from city zoom (easier to read streets).
  const [darkPref, setDarkPref] = useState(null)
  const [size, setSize] = useState({ w: 1100, h: 680 })
  const [search, setSearch] = useState({ q: '', status: 'idle', results: [], message: '' })
  const [enableError, setEnableError] = useState('')
  const street = mode === 'street' && svc.tiles
  const darkMap = darkPref ?? sview.z < 13

  // The street map needs the stage's size in pixels.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Refresh every 30 s, but not while paused or while the tab is hidden.
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  useEffect(() => {
    if (paused || hidden) return undefined
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_SECONDS * 1000)
    return () => clearInterval(id)
  }, [paused, hidden])

  useEffect(() => {
    if (!autoSpin || reduced || hidden) return undefined
    let frame = 0
    let last = performance.now()
    const step = (t) => {
      const dt = (t - last) / 1000
      last = t
      const spinBy = (v) => ({ ...v, spin: (v.spin + dt * 8) % 360 })
      if (street) setSview(spinBy)
      else setView(spinBy)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [autoSpin, reduced, hidden, street])

  // Full screen: the browser API when available, otherwise a fixed overlay.
  useEffect(() => {
    const onFs = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  const toggleFull = async () => {
    const el = shellRef.current
    if (document.fullscreenElement) { await document.exitFullscreen?.(); return }
    if (el?.requestFullscreen) {
      try { await el.requestFullscreen(); return } catch { /* fall back below */ }
    }
    setFull((f) => !f)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => getLiveTracker(company.id), [company.id, tick])
  const nowMs = Date.parse(data.asOf)
  const project = useMemo(() => makeGhanaProjection(), [])

  const visible = useMemo(() => data.people.filter((p) => show[p.category]), [data, show])
  const placed = useMemo(() => visible.filter((p) => p.position), [visible])
  const staleIds = useMemo(
    () => new Set(data.people.filter((p) => (lastSeen(p, nowMs) ?? Infinity) > STALE_MINUTES).map((p) => p.employeeId)),
    [data, nowMs],
  )
  const markers = useMemo(() => {
    const groups = new Map()
    placed.forEach((p) => {
      const key = `${p.position.latitude.toFixed(3)},${p.position.longitude.toFixed(3)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(p)
    })
    // People recorded at the same place stand in a small circle so each can
    // be seen and selected (their recorded coordinates are unchanged).
    return [...groups.values()].flatMap((list) => list.map((p, i) => {
      const [x, y] = project(p.position.longitude, p.position.latitude)
      const angle = (i / list.length) * Math.PI * 2
      const r = list.length > 1 ? 16 + list.length * 3 : 0
      return { p, x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r, bx: x, by: y }
    })).sort((a, b) => a.y - b.y)
  }, [placed, project])

  const sel = selected ? data.people.find((p) => p.employeeId === selected) : null
  const set = (patch) => { setAutoSpin(false); setView((v) => ({ ...v, ...patch })) }
  const setStreet = (patch) => { setAutoSpin(false); setSview((v) => ({ ...v, ...patch })) }
  const rotateBy = (deg) => (street ? setStreet({ spin: sview.spin + deg }) : set({ spin: view.spin + deg }))
  const tiltBy = (deg) => (street ? setStreet({ tilt: clamp(sview.tilt + deg, 0, 65) }) : set({ tilt: clamp(view.tilt + deg, 0, 70) }))
  const zoomBy = (step) => (street ? setStreet({ z: clamp(sview.z + step, 6, 18) }) : set({ zoom: clamp(view.zoom + step * 0.15, 0.6, 2) }))
  // Move the street map by a screen-space amount (undoing the 3D tilt and spin).
  const panBy = (dx, dy, base = sview) => {
    const t = (base.tilt * Math.PI) / 180
    const s = (-base.spin * Math.PI) / 180
    const vx = dx
    const vy = dy / Math.max(0.35, Math.cos(t))
    const mx = vx * Math.cos(s) - vy * Math.sin(s)
    const my = vx * Math.sin(s) + vy * Math.cos(s)
    const [cx, cy] = worldPx(base.lat, base.lng, base.z)
    const [lat, lng] = pxToLatLng(cx - mx, cy - my, base.z)
    setSview({ ...base, lat: clamp(lat, 4.2, 11.6), lng: clamp(lng, -3.8, 1.7) })
  }
  const flyTo = useCallback((lat, lng, z) => { setAutoSpin(false); setSview((v) => ({ ...v, lat, lng, z })) }, [])

  const enableStreetMap = () => {
    const r = saveMonitoring({ ...monitoringSettings(), locationProvider: 'nominatim' }, getSessionUser())
    if (r.errors) { setEnableError(r.errors.form ?? 'Could not switch on the street map.'); return }
    setEnableError('')
    setSvc(locationServiceStatus())
    setMode('street')
  }
  const runSearch = async (e) => {
    e.preventDefault()
    setSearch((st) => ({ ...st, status: 'loading', results: [], message: '' }))
    const r = await searchMapPlace(search.q)
    setSearch((st) => ({ ...st, ...r, status: r.status }))
    if (r.status === 'ok' && r.results.length === 1) flyTo(r.results[0].latitude, r.results[0].longitude, 17)
  }
  const onDuty = data.people.filter((p) => p.onDuty).length

  // Dragging: apply at most one camera update per animation frame.
  const onPointerDown = (e) => {
    if (e.target.closest('.lt-marker, .lt-hud, .lt-dock, .lt-panel')) return
    drag.current = { x: e.clientX, y: e.clientY, view, sview, rotate: !street || e.shiftKey, frame: 0, dx: 0, dy: 0 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setAutoSpin(false)
    setDragging(true)
  }
  const applyDrag = () => {
    const d = drag.current
    if (!d) return
    d.frame = 0
    if (street && !d.rotate) { panBy(d.dx, d.dy, d.sview); return }
    if (street) { setSview({ ...d.sview, spin: d.sview.spin + d.dx * 0.4, tilt: clamp(d.sview.tilt - d.dy * 0.3, 0, 65) }); return }
    setView({ ...d.view, spin: d.view.spin + d.dx * 0.4, tilt: clamp(d.view.tilt - d.dy * 0.3, 0, 70) })
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    d.dx = e.clientX - d.x
    d.dy = e.clientY - d.y
    if (!d.frame) d.frame = requestAnimationFrame(applyDrag)
  }
  const onPointerUp = () => {
    const d = drag.current
    if (!d) return
    if (d.frame) { cancelAnimationFrame(d.frame); applyDrag() }
    drag.current = null
    setDragging(false)
  }
  const onKeyDown = (e) => {
    const keys = street ? {
      ArrowLeft: () => panBy(80, 0),
      ArrowRight: () => panBy(-80, 0),
      ArrowUp: () => panBy(0, 80),
      ArrowDown: () => panBy(0, -80),
      '[': () => rotateBy(-10),
      ']': () => rotateBy(10),
      PageUp: () => tiltBy(5),
      PageDown: () => tiltBy(-5),
      '+': () => zoomBy(1),
      '=': () => zoomBy(1),
      '-': () => zoomBy(-1),
      0: () => setStreet(STREET_HOME),
      Escape: () => setSelected(null),
    } : {
      ArrowLeft: () => set({ spin: view.spin - 10 }),
      ArrowRight: () => set({ spin: view.spin + 10 }),
      ArrowUp: () => set({ tilt: clamp(view.tilt + 5, 0, 70) }),
      ArrowDown: () => set({ tilt: clamp(view.tilt - 5, 0, 70) }),
      '+': () => set({ zoom: clamp(view.zoom + 0.1, 0.6, 2) }),
      '=': () => set({ zoom: clamp(view.zoom + 0.1, 0.6, 2) }),
      '-': () => set({ zoom: clamp(view.zoom - 0.1, 0.6, 2) }),
      0: () => set(VIEWS['3d']),
      Escape: () => setSelected(null),
    }
    if (keys[e.key]) { e.preventDefault(); keys[e.key]() }
  }

  const wheelRef = useRef({ acc: 0 })
  useEffect(() => {
    const el = stageRef.current
    if (!el || !street) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      wheelRef.current.acc += e.deltaY
      if (Math.abs(wheelRef.current.acc) >= 100) {
        const step = wheelRef.current.acc > 0 ? -1 : 1
        wheelRef.current.acc = 0
        setAutoSpin(false)
        setSview((v) => ({ ...v, z: clamp(v.z + step, 6, 18) }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [street])

  const cam = street ? sview : view
  const billboard = `translate(-50%, -100%) rotateZ(${-cam.spin}deg) rotateX(${-cam.tilt}deg)`
  const toggleSelected = useCallback((id) => setSelected((cur) => (cur === id ? null : id)), [])
  const renderMarker = useCallback((p, pos) => (
    <button
      key={p.employeeId}
      type="button"
      className={`lt-marker${selected === p.employeeId ? ' is-selected' : ''}${staleIds.has(p.employeeId) ? ' is-stale' : ''}`}
      style={{ ...pos, transform: billboard }}
      onClick={() => toggleSelected(p.employeeId)}
      aria-label={`${p.fullName}, ${TRACKER_GROUPS[p.category].single}, ${p.duty}, last seen ${agoText(lastSeen(p, nowMs))}. ${POSITION_SOURCE[p.position.source]}${p.position.place ? ` — ${p.position.place}` : ''}.`}
    >
      <span className="lt-tag">{initials(p.fullName)}</span>
      <PersonFigure category={p.category} />
    </button>
  ), [selected, staleIds, billboard, nowMs, toggleSelected])
  // Pulsing ring on the ground: an HTML element so the pulse runs on the GPU
  // without repainting the map.
  const renderRing = useCallback((p, pos) => (
    <span
      key={`ring-${p.employeeId}`}
      className={`lt-ring${staleIds.has(p.employeeId) ? ' is-stale' : ''}`}
      style={{ ...pos, borderColor: ringColor(p.category) }}
      aria-hidden="true"
    />
  ), [staleIds])

  // Latest values for the table's (stable) click handler.
  const pickRef = useRef(null)
  pickRef.current = (p) => {
    setSelected(p.employeeId)
    if (street) flyTo(p.position.latitude, p.position.longitude, 16)
    shellRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }
  const onPick = useCallback((p) => pickRef.current(p), [])

  const live = !paused && !hidden
  const moving = dragging || autoSpin

  return (
    <div className="lt-page">
      <div ref={shellRef} className={`lt-shell${full ? ' is-full' : ''}`}>
        <div
          ref={stageRef}
          className={`lt-stage${street ? ' is-street' : ''}${moving ? ' is-moving' : ''}`}
          tabIndex={0}
          role="application"
          aria-roledescription="3D map"
          aria-label={street
            ? `Street map of Ghana, ${company.name}. Drag or arrow keys to move, plus and minus or the mouse wheel to zoom, Shift-drag or [ and ] to rotate, Page Up and Page Down to tilt, 0 resets.`
            : `Live map of Ghana, ${company.name}. Arrow keys rotate and tilt, plus and minus zoom, 0 resets.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {street ? (
            <StreetPlane
              size={size}
              view={sview}
              tileUrl={svc.tileUrl}
              dark={darkMap}
              people={placed}
              renderMarker={renderMarker}
              renderRing={renderRing}
            />
          ) : (
            <div className="lt-scene" style={{ transform: `rotateX(${view.tilt}deg) rotateZ(${view.spin}deg) scale(${view.zoom})` }}>
              <SlabMap project={project} />
              {markers.map(({ p, bx, by }) => renderRing(p, { left: `${(bx / GHANA_MAP_W) * 100}%`, top: `${(by / GHANA_MAP_H) * 100}%` }))}
              {markers.map(({ p, x, y }) => renderMarker(p, { left: `${(x / GHANA_MAP_W) * 100}%`, top: `${(y / GHANA_MAP_H) * 100}%` }))}
            </div>
          )}
          {street && <p className="lt-attribution">{svc.attribution} · zoom {sview.z}</p>}

          {/* Heads-up display */}
          <div className="lt-hud lt-hud-top">
            <div className="lt-title">
              <h2>Live Tracker</h2>
              <span className="lt-sub">{company.name} · field staff on the map of Ghana</span>
            </div>
            <p className={`lt-status${live ? '' : ' is-paused'}`} role="status" aria-atomic="true">
              <span className="lt-status-dot" aria-hidden="true" />
              {live ? 'Live' : paused ? 'Paused' : 'Paused (tab hidden)'} · {placed.length} of {visible.length} on the map · {onDuty} on duty · updated {formatAccraTime(data.asOf)}
            </p>
            <div className="lt-mode" role="group" aria-label="Map type">
              <button type="button" className={`lt-btn${street ? ' is-on' : ''}`} aria-pressed={street} onClick={() => (svc.tiles ? setMode('street') : enableStreetMap())}>Street map</button>
              <button type="button" className={`lt-btn${!street ? ' is-on' : ''}`} aria-pressed={!street} onClick={() => setMode('slab')}>3D outline</button>
              {street && <button type="button" className="lt-btn" onClick={() => setDarkPref(!darkMap)}>{darkMap ? 'Light map' : 'Dark map'}</button>}
            </div>
            {!svc.tiles && (
              <p className="lt-note">
                The street map (roads, markets, supermarkets, shops) comes from OpenStreetMap. Switching it on loads map images and place
                search from openstreetmap.org — the areas you view are sent to that service, but no employee data is.
                {enableError && <strong role="alert"> {enableError}</strong>}
              </p>
            )}
            {street && (
              <form className="lt-search" onSubmit={runSearch} role="search">
                <label className="sr-only" htmlFor="lt-search-input">Find a place</label>
                <input id="lt-search-input" className="lt-input" placeholder="Find a market, shop, road… e.g. Makola Market" value={search.q} onChange={(e) => setSearch((st) => ({ ...st, q: e.target.value }))} />
                <button type="submit" className="lt-btn" disabled={search.status === 'loading'}>{search.status === 'loading' ? 'Searching…' : 'Find'}</button>
              </form>
            )}
            {street && search.status !== 'idle' && search.status !== 'loading' && (
              <div className="lt-results" role="status" aria-atomic="true">
                {search.status === 'ok' ? (
                  <ul>
                    {search.results.map((r) => (
                      <li key={r.id}><button type="button" className="lt-result" onClick={() => flyTo(r.latitude, r.longitude, 17)}>{r.label}{r.kind && <span> · {r.kind}</span>}</button></li>
                    ))}
                  </ul>
                ) : <p>{search.status === 'no-results' ? `Nothing found for “${search.query}”.` : search.message}</p>}
              </div>
            )}
            {street && (
              <div className="lt-places" role="group" aria-label="Go to">
                <button type="button" className="lt-btn" onClick={() => setStreet(STREET_HOME)}>Ghana</button>
                {PLACES.map((pl) => <button key={pl.name} type="button" className="lt-btn" onClick={() => flyTo(pl.lat, pl.lng, pl.z)}>{pl.name}</button>)}
              </div>
            )}
            <div className="lt-hud-actions">
              <button type="button" className="lt-btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</button>
              <button type="button" className="lt-btn" onClick={() => setTick((t) => t + 1)}>Refresh</button>
              <button type="button" className="lt-btn lt-btn-primary" onClick={toggleFull} aria-pressed={full}>{full ? 'Exit full screen' : 'Full screen'}</button>
            </div>
          </div>

          <div className="lt-hud lt-chips" role="group" aria-label="Show on the map">
            {Object.entries(TRACKER_GROUPS).map(([id, g]) => (
              <button key={id} type="button" className={`lt-chip${show[id] ? ' is-on' : ''}`} aria-pressed={show[id]} onClick={() => setShow((s) => ({ ...s, [id]: !s[id] }))}>
                <LegendKey category={id} />
                <span className="lt-chip-text"><strong>{g.label}</strong><span>{data.counts[id].placed} on map · {data.counts[id].onDuty} on duty</span></span>
              </button>
            ))}
          </div>

          <div className="lt-dock" role="group" aria-label="Map controls">
            <button type="button" className="lt-btn" onClick={() => rotateBy(-15)} aria-label="Rotate left" title="Rotate left">⟲</button>
            <button type="button" className="lt-btn" onClick={() => rotateBy(15)} aria-label="Rotate right" title="Rotate right">⟳</button>
            <span className="lt-sep" aria-hidden="true" />
            <button type="button" className="lt-btn" onClick={() => tiltBy(8)} aria-label="Tilt more" title="Tilt more">Tilt +</button>
            <button type="button" className="lt-btn" onClick={() => tiltBy(-8)} aria-label="Tilt less" title="Tilt less">Tilt −</button>
            <span className="lt-sep" aria-hidden="true" />
            <button type="button" className="lt-btn" onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in">+</button>
            <button type="button" className="lt-btn" onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out">−</button>
            <span className="lt-sep" aria-hidden="true" />
            <button type="button" className={`lt-btn${cam.tilt > 0 ? ' is-on' : ''}`} onClick={() => (street ? setStreet({ tilt: STREET_HOME.tilt, spin: STREET_HOME.spin }) : set(VIEWS['3d']))}>3D</button>
            <button type="button" className={`lt-btn${cam.tilt === 0 ? ' is-on' : ''}`} onClick={() => (street ? setStreet({ tilt: 0, spin: 0 }) : set(VIEWS.top))}>Top</button>
            {!reduced && (
              <button type="button" className={`lt-btn${autoSpin ? ' is-on' : ''}`} aria-pressed={autoSpin} onClick={() => setAutoSpin((a) => !a)}>Auto-rotate</button>
            )}
          </div>

          <aside className="lt-panel" aria-live="polite">
            {sel ? (
              <>
                <div className="lt-panel-head">
                  <PersonFigure category={sel.category} size={40} />
                  <div>
                    <h3>{sel.fullName}</h3>
                    <span className="lt-panel-cat">{TRACKER_GROUPS[sel.category].single} · <span className="sm-mono">{sel.employeeId}</span></span>
                  </div>
                  <button type="button" className="lt-close" onClick={() => setSelected(null)} aria-label="Close details">×</button>
                </div>
                <dl>
                  <dt>Status</dt><dd>{sel.duty}</dd>
                  <dt>Last seen</dt><dd>{agoText(lastSeen(sel, nowMs))}{sel.lastEventAt ? ` (${formatAccraTime(sel.lastEventAt)})` : ''}</dd>
                  <dt>Position</dt><dd>{sel.position ? `${POSITION_SOURCE[sel.position.source]}${sel.position.place ? ` — ${sel.position.place}` : ''}` : 'No position recorded yet'}</dd>
                  {sel.position?.accuracy != null && <><dt>Accuracy</dt><dd>±{sel.position.accuracy} m</dd></>}
                  {sel.visitsToday != null && <><dt>Visits today</dt><dd>{sel.visitsToday}</dd></>}
                  {sel.lastEvent && <><dt>Latest</dt><dd>{sel.lastEvent}</dd></>}
                </dl>
                {street && sel.position && (
                  <button type="button" className="lt-btn lt-btn-primary lt-focus" onClick={() => flyTo(sel.position.latitude, sel.position.longitude, 17)}>Zoom to street level</button>
                )}
              </>
            ) : (
              <>
                <h3>How to read the map</h3>
                <ul className="lt-legend">
                  {Object.entries(TRACKER_GROUPS).map(([id, g]) => <li key={id}><LegendKey category={id} /> {g.label} <span className="lt-legend-badge">{BADGE[id]}</span></li>)}
                </ul>
                <p>Select a person for details. Faded figures were last seen over an hour ago. Positions come only from recorded events — the phone’s GPS at an outlet visit, the visited outlet, or a merchandiser’s shop — not continuous tracking.</p>
                <p className="lt-help">{street ? 'Drag to move · wheel or + − to zoom · Shift-drag to rotate · zoom in to see roads, markets and shops' : 'Drag to rotate · arrow keys rotate and tilt · + − zoom · 0 resets'}</p>
              </>
            )}
          </aside>
        </div>
      </div>

      <StaffTable companyName={company.name} visible={visible} placedCount={placed.length} selected={selected} nowMs={nowMs} onPick={onPick} />
      <p className="mock-banner" style={{ textAlign: 'center', margin: 0 }}>Demo data — merchandiser check results are simulated. Visit locations come from the employee’s phone.</p>
    </div>
  )
}
