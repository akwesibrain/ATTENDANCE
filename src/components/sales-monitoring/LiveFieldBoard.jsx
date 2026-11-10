import { useEffect, useMemo, useState } from 'react'
import { FIELD_STATE, getLiveFieldBoard } from '../../services/salesMonitoringService'
import { RESULT_LABELS, initials } from './labels'
import { formatAccraTime } from '../../utils/accraTime'

const REFRESH_SECONDS = 30
const ON_DUTY = ['inside', 'outside', 'face-failed', 'location-unknown', 'no-response', 'awaiting-check']
const MAP_W = 720
const MAP_H = 360
const PAD = 60

function ago(minutes) {
  if (minutes == null) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const h = Math.floor(minutes / 60)
  return `${h} h ${minutes % 60} min ago`
}

/** Plot shops by their recorded Shop Directory coordinates (equirectangular). */
function useProjection(shops) {
  return useMemo(() => {
    const located = shops.filter((s) => s.latitude != null && s.longitude != null)
    if (!located.length) return { located, project: () => [MAP_W / 2, MAP_H / 2] }
    const lats = located.map((s) => s.latitude)
    const lngs = located.map((s) => s.longitude)
    let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
    // Keep a sensible minimum span so one or two shops are not stretched.
    const span = 0.02
    if (maxLat - minLat < span) { const c = (maxLat + minLat) / 2; minLat = c - span / 2; maxLat = c + span / 2 }
    if (maxLng - minLng < span) { const c = (maxLng + minLng) / 2; minLng = c - span / 2; maxLng = c + span / 2 }
    const sx = (MAP_W - PAD * 2) / (maxLng - minLng)
    const sy = (MAP_H - PAD * 2) / (maxLat - minLat)
    const scale = Math.min(sx, sy)
    const offX = (MAP_W - (maxLng - minLng) * scale) / 2
    const offY = (MAP_H - (maxLat - minLat) * scale) / 2
    return {
      located,
      project: (s) => [offX + (s.longitude - minLng) * scale, MAP_H - (offY + (s.latitude - minLat) * scale)],
    }
  }, [shops])
}

/**
 * Live field board: each field rep shown at their assigned shop with the
 * result of their latest recorded verification check. No continuous tracking
 * and no invented positions — between checks the location is unknown.
 */
export default function LiveFieldBoard({ company, onViewRep }) {
  const [tick, setTick] = useState(0)
  const [paused, setPaused] = useState(false)
  const [stateFilter, setStateFilter] = useState('')
  const [shopFilter, setShopFilter] = useState('')

  useEffect(() => {
    if (paused) return undefined
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_SECONDS * 1000)
    return () => clearInterval(id)
  }, [paused])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const board = useMemo(() => getLiveFieldBoard(company.id), [company.id, tick])
  const { located, project } = useProjection(board.shops)
  const unlocated = board.shops.filter((s) => s.latitude == null || s.longitude == null)
  const repsAt = (shopId) => board.reps.filter((r) => r.shop?.shopId === shopId)

  const filtered = board.reps.filter((r) => {
    if (stateFilter === 'on-duty' && !ON_DUTY.includes(r.state)) return false
    if (stateFilter && stateFilter !== 'on-duty' && r.state !== stateFilter) return false
    if (shopFilter && r.shop?.shopId !== shopFilter) return false
    return true
  })

  const card = (label, value, tone, filterKey) => (
    <button type="button" className={`sm-stat lf-stat${stateFilter === filterKey ? ' is-active' : ''}`} onClick={() => setStateFilter(stateFilter === filterKey ? '' : filterKey)} aria-pressed={stateFilter === filterKey}>
      <span className="sm-stat-label">{label}</span>
      <span className={`sm-stat-value${tone ? ` sm-stat-${tone}` : ''}`}>{value}</span>
    </button>
  )

  return (
    <div className="lf-wrap">
      <div className="lf-bar">
        <span className={`lf-live${paused ? ' is-paused' : ''}`}>
          <span className="lf-live-dot" aria-hidden="true" />
          {paused ? 'Paused' : 'Live'}
        </span>
        <span className="sm-muted">Updated {formatAccraTime(board.asOf)} · refreshes every {REFRESH_SECONDS} s</span>
        <div className="lf-bar-actions">
          <button type="button" className="sm-actions-btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</button>
          <button type="button" className="sm-actions-btn" onClick={() => setTick((t) => t + 1)}>Refresh now</button>
        </div>
      </div>

      <p className="lf-note" role="note">
        Reps are not tracked continuously. Each rep is shown at their assigned shop with the result of their most recent
        verification check that has already happened. Between checks their location is unknown, and future check times are
        never shown. A missed check is an exception for review, not an absence or misconduct.
      </p>

      <div className="sm-stats lf-stats" role="group" aria-label="Field summary">
        {card('On duty now', board.counts.onDuty, 'accent', 'on-duty')}
        {card('Inside geofence (last check)', board.counts.inside, 'ok', 'inside')}
        {card('Outside geofence (last check)', board.counts.outside, 'crit', 'outside')}
        {card('No response (last check)', board.counts['no-response'], 'warn', 'no-response')}
        {card('Not checked in', board.counts['not-checked-in'], 'warn', 'not-checked-in')}
        {card('Not scheduled today', board.counts['off-schedule'], null, 'off-schedule')}
      </div>

      <section className="sm-panel">
        <div className="sm-panel-head">
          <h3>Shops — {company.name}</h3>
          <span className="sm-muted">Positions from Shop Directory coordinates · geofence rings not to scale</span>
        </div>
        {located.length === 0 ? (
          <p className="sm-empty">No shops have GPS coordinates yet, so nothing can be placed on the map.</p>
        ) : (
          <div className="lf-map-wrap">
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="lf-map" role="img" aria-label={`Map of ${located.length} shops with their reps' latest check results`}>
              {[1, 2, 3].map((i) => <line key={`h${i}`} x1="0" x2={MAP_W} y1={(MAP_H / 4) * i} y2={(MAP_H / 4) * i} className="lf-grid" />)}
              {[1, 2, 3, 4, 5].map((i) => <line key={`v${i}`} y1="0" y2={MAP_H} x1={(MAP_W / 6) * i} x2={(MAP_W / 6) * i} className="lf-grid" />)}
              {located.map((s) => {
                const [x, y] = project(s)
                const reps = repsAt(s.shopId)
                const active = shopFilter === s.shopId
                return (
                  <g key={s.shopId} className={`lf-shop${active ? ' is-active' : ''}`} tabIndex={0} role="button"
                    aria-label={`${s.shopName}: ${reps.length} reps. ${reps.map((r) => `${r.fullName}, ${FIELD_STATE[r.state].short}`).join('; ')}`}
                    onClick={() => setShopFilter(active ? '' : s.shopId)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShopFilter(active ? '' : s.shopId) } }}
                  >
                    <circle cx={x} cy={y} r={34} className="lf-geofence" />
                    <circle cx={x} cy={y} r={7} className="lf-pin" />
                    <text x={x} y={y - 42} className="lf-shop-label" textAnchor="middle">{s.baseName}</text>
                    {reps.map((r, i) => {
                      const angle = (Math.PI * 2 * i) / Math.max(reps.length, 1) - Math.PI / 2
                      const rx = x + Math.cos(angle) * 22
                      const ry = y + Math.sin(angle) * 22
                      return (
                        <g key={r.employeeId}>
                          <circle cx={rx} cy={ry} r={9} className={`lf-rep lf-tone-${FIELD_STATE[r.state].tone}`} />
                          <text x={rx} y={ry + 3} className="lf-rep-label" textAnchor="middle">{initials(r.fullName)}</text>
                        </g>
                      )
                    })}
                  </g>
                )
              })}
            </svg>
            <ul className="lf-legend" aria-label="Legend">
              {['inside', 'outside', 'no-response', 'awaiting-check', 'not-checked-in', 'off-schedule'].map((k) => (
                <li key={k}><span className={`lf-key lf-tone-${FIELD_STATE[k].tone}`} aria-hidden="true" />{FIELD_STATE[k].short}</li>
              ))}
            </ul>
          </div>
        )}
        {unlocated.length > 0 && (
          <p className="at-rules">Not on the map (GPS location not set): {unlocated.map((s) => s.shopName).join(', ')}.</p>
        )}
      </section>

      <section className="sm-panel">
        <div className="at-filters">
          <select className="sm-select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by field status">
            <option value="">All statuses</option>
            <option value="on-duty">On duty now</option>
            {Object.entries(FIELD_STATE).map(([k, v]) => <option key={k} value={k}>{v.short}</option>)}
          </select>
          <select className="sm-select" value={shopFilter} onChange={(e) => setShopFilter(e.target.value)} aria-label="Filter by shop">
            <option value="">All shops</option>
            {board.shops.map((s) => <option key={s.shopId} value={s.shopId}>{s.shopName}</option>)}
          </select>
          {(stateFilter || shopFilter) && <button type="button" className="hr-link at-clear" onClick={() => { setStateFilter(''); setShopFilter('') }}>Clear filters</button>}
        </div>
        <div className="sm-panel-head at-table-head">
          <h3>Field reps</h3>
          <span className="sm-muted">{filtered.length} of {board.reps.length}</span>
        </div>
        {filtered.length === 0 ? (
          <p className="sm-empty">No reps match these filters.</p>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table lf-table">
              <thead>
                <tr><th scope="col">Rep</th><th scope="col">Shop</th><th scope="col">Field status</th><th scope="col">Last check</th><th scope="col">Distance from shop</th><th scope="col">Checks today</th><th scope="col"><span className="sr-only">Profile</span></th></tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.employeeId}>
                    <td data-label="Rep"><span className="at-stack"><span className="at-emp-name">{r.fullName}</span><span className="at-sub"><span className="sm-mono">{r.employeeId}</span>{r.checkInTime ? ` · in ${formatAccraTime(r.checkInTime)}` : ''}</span></span></td>
                    <td data-label="Shop">{r.shop ? r.shop.shopName : <span className="at-none">Not assigned</span>}</td>
                    <td data-label="Field status"><span className={`at-badge at-tone-${FIELD_STATE[r.state].tone}`} title={FIELD_STATE[r.state].label}>{FIELD_STATE[r.state].short}</span></td>
                    <td data-label="Last check">
                      {r.lastCheck ? (
                        <span className="at-stack">
                          {formatAccraTime(r.lastCheckAt)} <span className="at-sub">{RESULT_LABELS[r.lastCheck.result]} · {ago(r.minutesSinceLastCheck)}</span>
                        </span>
                      ) : <span className="at-none">{r.hasData ? 'None yet today' : 'No verification data'}</span>}
                    </td>
                    <td data-label="Distance from shop">
                      {r.lastDistance != null ? (
                        <span className="at-stack">{r.lastDistance} m <span className="at-sub">±{r.lastAccuracy} m · geofence {r.shop?.geofenceRadius ?? 150} m</span></span>
                      ) : <span className="at-none">Not recorded</span>}
                    </td>
                    <td data-label="Checks today">{r.hasData ? `${r.checksDone} of 3` : '—'}</td>
                    <td data-label="Profile" className="at-actions">{r.hasData && <button type="button" className="sm-actions-btn" onClick={() => onViewRep?.(r)}>Profile</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mock-banner" style={{ textAlign: 'center', margin: 0 }}>Demo data — verification results are simulated, not genuine GPS evidence.</p>
    </div>
  )
}
