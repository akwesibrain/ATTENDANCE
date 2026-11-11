import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GHANA_OUTLINE } from '../../constants/ghanaMap'
import { TILE, tilesFor, worldPx } from '../../utils/webMercator'

/** How much bigger than the stage the tilted map plane is (so the horizon is covered). */
const PLANE_SCALE = { x: 1.7, y: 2.3 }
/** Size of the grid the local origin snaps to (a whole number of tiles). */
const ANCHOR_GRID = TILE * 32
/** Keep the old zoom level on screen while new tiles load, for jumps up to this many levels. */
const BACKDROP_MAX_LEVELS = 3

/**
 * The street map plane for the Live Tracker: real OpenStreetMap tiles laid on
 * a plane that can be tilted and rotated in 3D, with Ghana's border on top
 * and people standing on their recorded positions.
 *
 * Everything that only depends on the zoom (border path, people grouping) is
 * computed once per zoom level in world pixels; panning just shifts it.
 *
 * view: { lat, lng, z, tilt, spin }  size: { w, h } of the stage in px
 */
function StreetPlane({ size, view, tileUrl, people, renderMarker, renderRing }) {
  const { z } = view
  const PW = Math.round(size.w * PLANE_SCALE.x)
  const PH = Math.round(size.h * PLANE_SCALE.y)
  const [cx, cy] = worldPx(view.lat, view.lng, z)
  const left = Math.round(cx - PW / 2)
  const top = Math.round(cy - PH / 2)
  // Local origin near the camera, snapped to a coarse grid, so every CSS/SVG
  // number stays within a few thousand pixels. At street zoom world pixels run
  // into the millions, and the tilted 3D plane loses precision on numbers that
  // large: the whole map rendered blank (white) when zoomed in deep. The origin
  // only moves when the camera crosses a grid cell, so panning stays cheap.
  const ax = Math.floor(cx / ANCHOR_GRID)
  const ay = Math.floor(cy / ANCHOR_GRID)
  const origin = useMemo(() => [(ax - 1) * ANCHOR_GRID, (ay - 1) * ANCHOR_GRID], [ax, ay])
  const ox = left - origin[0]
  const oy = top - origin[1]

  // Tiles only change when a new 256 px column/row comes into view.
  const tx0 = Math.floor(left / TILE)
  const ty0 = Math.floor(top / TILE)
  const tx1 = Math.floor((left + PW) / TILE)
  const ty1 = Math.floor((top + PH) / TILE)
  const tiles = useMemo(
    () => tilesFor(tx0 * TILE, ty0 * TILE, (tx1 - tx0) * TILE, (ty1 - ty0) * TILE, z),
    [tx0, ty0, tx1, ty1, z],
  )

  // When the zoom level changes, the last level's tiles stay underneath
  // (scaled to match) so the map never goes blank while new tiles download.
  const shown = useRef(null)
  const [backdrop, setBackdrop] = useState(null)
  useLayoutEffect(() => {
    const last = shown.current
    if (last && last.z !== z) setBackdrop(Math.abs(last.z - z) <= BACKDROP_MAX_LEVELS ? last : null)
    shown.current = { z, origin, tiles }
  }, [z, origin, tiles])
  const backK = backdrop ? 2 ** (z - backdrop.z) : 1

  // Ghana border in world pixels, once per zoom level.
  const border = useMemo(() => GHANA_OUTLINE.map(([lng, lat], i) => {
    const [x, y] = worldPx(lat, lng, z)
    return `${i ? 'L' : 'M'}${(x - origin[0]).toFixed(1)} ${(y - origin[1]).toFixed(1)}`
  }).join(' ') + ' Z', [z, origin])

  // People in world pixels; people at (almost) the same spot stand in a small
  // circle so each one can be seen and selected.
  const groupedPeople = useMemo(() => {
    const groups = []
    people.forEach((p) => {
      const [wx, wy] = worldPx(p.position.latitude, p.position.longitude, z)
      const x = wx - origin[0]
      const y = wy - origin[1]
      const g = groups.find((gr) => Math.abs(gr.x - x) < 22 && Math.abs(gr.y - y) < 22)
      if (g) g.items.push(p)
      else groups.push({ x, y, items: [p] })
    })
    return groups.flatMap((g) => g.items.map((p, i) => {
      if (g.items.length === 1) return { p, x: g.x, y: g.y, bx: g.x, by: g.y }
      const a = (i / g.items.length) * Math.PI * 2
      const r = 18 + g.items.length * 3
      return { p, bx: g.x, by: g.y, x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r }
    })).sort((a, b) => a.y - b.y)
  }, [people, z, origin])

  // Border, rings and people live in fixed world coordinates (relative to
  // `origin`) inside one layer that is only translated while panning, so a
  // drag is a single GPU transform. They are rebuilt only when a new tile
  // row/column comes into view, not on every frame.
  const gx = tx0 * TILE - origin[0]
  const gy = ty0 * TILE - origin[1]
  const gw = (tx1 - tx0 + 1) * TILE
  const gh = (ty1 - ty0 + 1) * TILE
  const overlay = useMemo(() => (
    <svg className="lt-plane-svg" style={{ left: gx, top: gy }} width={gw} height={gh} aria-hidden="true">
      <g transform={`translate(${-gx} ${-gy})`}>
        <path d={`M${gx} ${gy}h${gw}v${gh}h${-gw}Z ${border}`} className="lt-outside" fillRule="evenodd" />
        <path d={border} className="lt-border-glow" />
        <path d={border} className="lt-border" />
      </g>
    </svg>
  ), [gx, gy, gw, gh, border])
  const people3d = useMemo(() => {
    const near = groupedPeople.filter((m) => m.x > gx - 60 && m.y > gy - 60 && m.x < gx + gw + 60 && m.y < gy + gh + 60)
    return [
      ...near.map((m) => renderRing(m.p, { left: m.bx, top: m.by })),
      ...near.map((m) => renderMarker(m.p, { left: m.x, top: m.y })),
    ]
  }, [groupedPeople, gx, gy, gw, gh, renderMarker, renderRing])
  const shift = `translate(${-ox}px, ${-oy}px)`

  return (
    <div
      className="lt-plane"
      style={{ width: PW, height: PH, marginLeft: -PW / 2, marginTop: -PH / 2, transform: `rotateX(${view.tilt}deg) rotateZ(${view.spin}deg)` }}
    >
      <div className="lt-tiles" aria-hidden="true">
        <div className="lt-tiles-world" style={{ transform: shift }}>
          {backdrop && backdrop.z !== z && (
            <div
              className="lt-tiles-back"
              style={{ transform: `translate(${backdrop.origin[0] * backK - origin[0]}px, ${backdrop.origin[1] * backK - origin[1]}px) scale(${backK})` }}
            >
              {backdrop.tiles.map((t) => (
                <img
                  key={`${backdrop.z}/${t.tx}/${t.ty}`}
                  src={tileUrl.replace('{z}', backdrop.z).replace('{x}', t.x).replace('{y}', t.ty)}
                  alt=""
                  draggable={false}
                  width={TILE}
                  height={TILE}
                  style={{ left: t.tx * TILE - backdrop.origin[0], top: t.ty * TILE - backdrop.origin[1] }}
                />
              ))}
            </div>
          )}
          {tiles.map((t) => (
            <img
              key={`${z}/${t.tx}/${t.ty}`}
              src={tileUrl.replace('{z}', z).replace('{x}', t.x).replace('{y}', t.ty)}
              alt=""
              draggable={false}
              decoding="async"
              width={TILE}
              height={TILE}
              style={{ left: t.tx * TILE - origin[0], top: t.ty * TILE - origin[1] }}
            />
          ))}
        </div>
      </div>
      <div className="lt-world" style={{ transform: shift }}>
        {overlay}
        {people3d}
      </div>
    </div>
  )
}

export default memo(StreetPlane)
