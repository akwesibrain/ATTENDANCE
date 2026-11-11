import { memo, useMemo } from 'react'
import { GHANA_OUTLINE } from '../../constants/ghanaMap'
import { TILE, tilesFor, worldPx } from '../../utils/webMercator'

/** How much bigger than the stage the tilted map plane is (so the horizon is covered). */
const PLANE_SCALE = { x: 1.7, y: 2.3 }
const ORIGIN = { lat: 11.6, lng: -3.8 }

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
function StreetPlane({ size, view, tileUrl, dark, people, renderMarker, renderRing }) {
  const { z } = view
  const PW = Math.round(size.w * PLANE_SCALE.x)
  const PH = Math.round(size.h * PLANE_SCALE.y)
  const [cx, cy] = worldPx(view.lat, view.lng, z)
  const left = Math.round(cx - PW / 2)
  const top = Math.round(cy - PH / 2)
  // Fixed origin (north-west of Ghana, on a tile corner) so CSS/SVG numbers
  // stay small even at street zoom, where world pixels run into the millions.
  const origin = useMemo(() => worldPx(ORIGIN.lat, ORIGIN.lng, z).map((v) => Math.floor(v / TILE) * TILE), [z])
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

  const onScreen = groupedPeople.filter((m) => m.x - ox > -60 && m.y - oy > -60 && m.x - ox < PW + 60 && m.y - oy < PH + 60)
  const shift = `translate(${-ox}px, ${-oy}px)`

  return (
    <div
      className={`lt-plane${dark ? ' is-dark' : ''}`}
      style={{ width: PW, height: PH, marginLeft: -PW / 2, marginTop: -PH / 2, transform: `rotateX(${view.tilt}deg) rotateZ(${view.spin}deg)` }}
    >
      <div className="lt-tiles" aria-hidden="true">
        <div className="lt-tiles-world" style={{ transform: shift }}>
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
      <svg className="lt-plane-svg" width={PW} height={PH} aria-hidden="true">
        <g transform={`translate(${-ox} ${-oy})`}>
          <path d={`M${ox} ${oy}h${PW}v${PH}h${-PW}Z ${border}`} className="lt-outside" fillRule="evenodd" />
          <path d={border} className="lt-border-glow" />
          <path d={border} className="lt-border" />
        </g>
      </svg>
      {onScreen.map((m) => renderRing(m.p, { left: m.bx - ox, top: m.by - oy }))}
      {onScreen.map((m) => renderMarker(m.p, { left: m.x - ox, top: m.y - oy }))}
    </div>
  )
}

export default memo(StreetPlane)
