import { useMemo } from 'react'
import { GHANA_BOUNDS, GHANA_CITIES, GHANA_OUTLINE } from '../../constants/ghanaMap'
import { FIELD_STATE } from '../../services/salesMonitoringService'

const W = 520
const H = 720
const PAD = 28
// Shops closer than this (in degrees, ≈ 13 km) share one marker at country scale.
const CLUSTER_DEG = 0.12
// Worst result first, so a marker shows the status that needs attention.
const TONE_RANK = { crit: 0, warn: 1, pending: 2, ok: 3, muted: 4 }

/** Equirectangular projection fitted to Ghana (cos-latitude corrected). */
function makeProjection() {
  const { minLng, maxLng, minLat, maxLat } = GHANA_BOUNDS
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  const spanX = (maxLng - minLng) * k
  const spanY = maxLat - minLat
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY)
  const offX = (W - spanX * scale) / 2
  const offY = (H - spanY * scale) / 2
  return (lng, lat) => [offX + (lng - minLng) * k * scale, offY + (maxLat - lat) * scale]
}

function clusterShops(shops) {
  const groups = []
  shops.forEach((s) => {
    const g = groups.find((x) => Math.abs(x.latitude - s.latitude) < CLUSTER_DEG && Math.abs(x.longitude - s.longitude) < CLUSTER_DEG)
    if (g) {
      g.shops.push(s)
      g.latitude = g.shops.reduce((a, b) => a + b.latitude, 0) / g.shops.length
      g.longitude = g.shops.reduce((a, b) => a + b.longitude, 0) / g.shops.length
    } else {
      groups.push({ id: s.shopId, latitude: s.latitude, longitude: s.longitude, shops: [s] })
    }
  })
  return groups
}

/**
 * Country-scale map of Ghana for the live field board. Shops are plotted at
 * their recorded coordinates; nearby shops share one marker showing how many
 * reps are there and the most urgent latest-check result.
 */
export default function GhanaFieldMap({ shops, repsAt, onOpen }) {
  const project = useMemo(() => makeProjection(), [])
  const outline = useMemo(() => GHANA_OUTLINE.map(([lng, lat], i) => `${i ? 'L' : 'M'}${project(lng, lat).map((n) => n.toFixed(1)).join(' ')}`).join(' ') + ' Z', [project])
  // Sea: everything south of the coastline (the first five outline points run
  // east → west along the coast).
  const sea = useMemo(() => {
    const coast = GHANA_OUTLINE.slice(0, 5).map(([lng, lat]) => project(lng, lat))
    const pts = [[W, coast[0][1]], ...coast, [0, coast[coast.length - 1][1]], [0, H], [W, H]]
    return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z'
  }, [project])
  const groups = useMemo(() => clusterShops(shops), [shops])
  // Hide city names that a shop marker would cover.
  const markerPoints = groups.map((g) => project(g.longitude, g.latitude))
  const nearMarker = (x, y) => markerPoints.some(([mx, my]) => Math.abs(mx - x) < 70 && Math.abs(my - y) < 40)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lf-map lf-ghana" role="img" aria-label={`Map of Ghana with ${shops.length} shop${shops.length === 1 ? '' : 's'}`}>
      <defs>
        <pattern id="lf-sea" width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 7 Q3.5 4 7 7 T14 7" className="lf-sea-wave" />
        </pattern>
      </defs>
      <path d={sea} className="lf-sea" />
      <path d={sea} fill="url(#lf-sea)" />
      <path d={outline} className="lf-land" />

      {/* Neighbours and sea, for orientation */}
      <text x={PAD - 6} y={H * 0.42} className="lf-region-label" textAnchor="start" transform={`rotate(-90 ${PAD - 6} ${H * 0.42})`}>CÔTE D&apos;IVOIRE</text>
      <text x={W - PAD + 14} y={H * 0.52} className="lf-region-label" textAnchor="middle" transform={`rotate(90 ${W - PAD + 14} ${H * 0.52})`}>TOGO</text>
      <text x={W / 2} y={18} className="lf-region-label" textAnchor="middle">BURKINA FASO</text>
      <text x={W * 0.32} y={H - 22} className="lf-region-label lf-sea-label" textAnchor="middle">Gulf of Guinea</text>

      {GHANA_CITIES.map((c) => {
        const [x, y] = project(c.longitude, c.latitude)
        const covered = nearMarker(x, y)
        return (
          <g key={c.name} className="lf-city" aria-hidden="true">
            {c.capital ? <rect x={x - 4} y={y - 4} width="8" height="8" className="lf-city-dot" /> : <circle cx={x} cy={y} r="3" className="lf-city-dot" />}
            {!covered && <text x={x + 7} y={y + 4} className={`lf-city-label${c.capital ? ' is-capital' : ''}`}>{c.name}</text>}
          </g>
        )
      })}

      {groups.map((g) => {
        const [x, y] = project(g.longitude, g.latitude)
        const reps = g.shops.flatMap((s) => repsAt(s.shopId))
        const worst = reps.map((r) => FIELD_STATE[r.state].tone).sort((a, b) => TONE_RANK[a] - TONE_RANK[b])[0] ?? 'muted'
        const label = g.shops.length === 1 ? g.shops[0].baseName : `${g.shops.length} shops`
        const town = g.shops[0].town
        const summary = `${label}${town ? `, ${town}` : ''}: ${reps.length} rep${reps.length === 1 ? '' : 's'}. ${reps.map((r) => `${r.fullName}, ${FIELD_STATE[r.state].short}`).join('; ')}`
        return (
          <g key={g.id} className="lf-cluster" tabIndex={0} role="button" aria-label={`${summary}. Open close-up.`}
            onClick={() => onOpen(g.shops.map((s) => s.shopId))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(g.shops.map((s) => s.shopId)) } }}
          >
            <title>{summary}</title>
            <circle cx={x} cy={y} r="22" className="lf-cluster-halo" />
            <circle cx={x} cy={y} r="15" className={`lf-cluster-dot lf-tone-${worst}`} />
            <text x={x} y={y + 4.5} className="lf-cluster-count" textAnchor="middle">{reps.length}</text>
            <text x={x + 26} y={y - 10} className="lf-cluster-label">{label}</text>
            {town && <text x={x + 26} y={y + 6} className="lf-cluster-town">{town}</text>}
          </g>
        )
      })}
    </svg>
  )
}
