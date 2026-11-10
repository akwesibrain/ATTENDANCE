import { useEffect, useRef, useState } from 'react'

/*
 * Small SVG chart kit for Reports & Analytics.
 * Mark specs: bars ≤ 24px with a 4px rounded data end (square at the baseline),
 * 2px surface gap between stacked segments, 2px lines, ≥ 8px markers with a
 * surface ring, solid hairline grid. Every chart has a hover/focus tooltip,
 * a legend when there are 2+ series, and a table view (ChartCard).
 * Text uses ink tokens, never series colours.
 */

function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

function niceMax(max) {
  if (max <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(max))
  const f = max / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * exp
}

const fmtInt = (n) => n.toLocaleString()

/** Rounded data end at the top, square at the baseline. */
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return ''
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

function barPath(x, y, w, h, r = 4) {
  if (w <= 0) return ''
  const rr = Math.min(r, w, h / 2)
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`
}

function Tooltip({ tip }) {
  if (!tip) return null
  return (
    <div className="rp-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="rp-tooltip-title">{tip.title}</div>
      {tip.rows.map((row) => (
        <div className="rp-tooltip-row" key={row.label}>
          {row.color && <span className="rp-key-line" style={{ background: row.color }} aria-hidden="true" />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }) {
  if (!items || items.length < 2) return null
  return (
    <ul className="rp-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`rp-swatch rp-swatch-${i.shape ?? 'rect'}`} style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

/** Card with title, legend, chart and a table-view twin. */
export function ChartCard({ title, subtitle, legend, table, empty, children }) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="rp-chart-card">
      <div className="rp-chart-head">
        <div>
          <h4>{title}</h4>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {!empty && table && (
          <button type="button" className="rp-toggle" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {empty ? (
        <p className="rp-empty">{empty}</p>
      ) : showTable ? (
        <div className="rp-table-view">{table}</div>
      ) : (
        <>
          <Legend items={legend} />
          {children}
        </>
      )}
    </section>
  )
}

/** Stacked columns (e.g. on time / late / absent per day). */
export function StackedColumns({ data, series, height = 220, ariaLabel }) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState(null)
  const m = { top: 10, right: 8, bottom: 26, left: 36 }
  const plotW = width - m.left - m.right
  const plotH = height - m.top - m.bottom
  const totals = data.map((d) => series.reduce((s, se) => s + (d.values[se.key] ?? 0), 0))
  const max = niceMax(Math.max(1, ...totals))
  const band = plotW / Math.max(1, data.length)
  const barW = Math.max(2, Math.min(24, band * 0.7))
  const y = (v) => (v / max) * plotH
  const ticks = [0, max / 2, max]
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)))

  const show = (d, i, total) => {
    const cx = m.left + band * i + band / 2
    setTip({
      x: Math.min(Math.max(cx, 80), width - 80),
      y: 0,
      title: d.label,
      rows: [...series.map((se) => ({ label: se.label, value: fmtInt(d.values[se.key] ?? 0), color: se.color })), { label: 'Total', value: fmtInt(total) }],
    })
  }

  return (
    <div className="rp-chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={m.top + plotH - y(t)} y2={m.top + plotH - y(t)} className="rp-grid" />
            <text x={m.left - 6} y={m.top + plotH - y(t) + 4} className="rp-axis" textAnchor="end">{fmtInt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = m.left + band * i + (band - barW) / 2
          let acc = 0
          const segs = series.map((se, si) => {
            const v = d.values[se.key] ?? 0
            const h = y(v)
            const top = m.top + plotH - acc - h
            acc += h
            const isTop = series.slice(si + 1).every((s2) => !(d.values[s2.key] > 0))
            const gap = acc - h > 0 ? 2 : 0 // surface gap above the segment below
            const hh = Math.max(0, h - gap)
            return hh > 0 ? (
              isTop
                ? <path key={se.key} d={columnPath(x, top, barW, hh)} fill={se.color} />
                : <rect key={se.key} x={x} y={top} width={barW} height={hh} fill={se.color} />
            ) : null
          })
          return (
            <g key={d.key}>
              {segs}
              <rect
                x={m.left + band * i}
                y={m.top}
                width={band}
                height={plotH}
                className="rp-hit"
                tabIndex={0}
                aria-label={`${d.label}: ${series.map((se) => `${se.label} ${d.values[se.key] ?? 0}`).join(', ')}`}
                onMouseMove={() => show(d, i, totals[i])}
                onFocus={() => show(d, i, totals[i])}
                onBlur={() => setTip(null)}
              />
              {i % labelEvery === 0 && (
                <text x={m.left + band * i + band / 2} y={height - 8} className="rp-axis" textAnchor="middle">{d.short ?? d.label}</text>
              )}
            </g>
          )
        })}
        <line x1={m.left} x2={width - m.right} y1={m.top + plotH} y2={m.top + plotH} className="rp-baseline" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Single-series columns (e.g. late arrivals per period). Null = no data. */
export function Columns({ data, color = 'var(--viz-1)', height = 200, ariaLabel, format = fmtInt }) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState(null)
  const m = { top: 18, right: 8, bottom: 26, left: 36 }
  const plotW = width - m.left - m.right
  const plotH = height - m.top - m.bottom
  const max = niceMax(Math.max(1, ...data.map((d) => d.value ?? 0)))
  const band = plotW / Math.max(1, data.length)
  const barW = Math.max(2, Math.min(24, band * 0.6))
  const y = (v) => (v / max) * plotH
  return (
    <div className="rp-chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={m.top + plotH - y(t)} y2={m.top + plotH - y(t)} className="rp-grid" />
            <text x={m.left - 6} y={m.top + plotH - y(t) + 4} className="rp-axis" textAnchor="end">{fmtInt(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.left + band * i + band / 2
          const h = d.value == null ? 0 : y(d.value)
          const show = () => setTip({ x: Math.min(Math.max(cx, 80), width - 80), y: 0, title: d.label, rows: [{ label: d.seriesLabel ?? '', value: d.value == null ? 'No data' : format(d.value) }] })
          return (
            <g key={d.key}>
              {d.value == null ? (
                <text x={cx} y={m.top + plotH - 6} className="rp-axis" textAnchor="middle">n/a</text>
              ) : (
                <>
                  <path d={columnPath(cx - barW / 2, m.top + plotH - h, barW, h)} fill={color} />
                  <text x={cx} y={m.top + plotH - h - 5} className="rp-value" textAnchor="middle">{format(d.value)}</text>
                </>
              )}
              <rect x={m.left + band * i} y={m.top} width={band} height={plotH} className="rp-hit" tabIndex={0} aria-label={`${d.label}: ${d.value == null ? 'no data' : format(d.value)}`} onMouseMove={show} onFocus={show} onBlur={() => setTip(null)} />
              <text x={cx} y={height - 8} className="rp-axis" textAnchor="middle">{d.short ?? d.label}</text>
            </g>
          )
        })}
        <line x1={m.left} x2={width - m.right} y1={m.top + plotH} y2={m.top + plotH} className="rp-baseline" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Single-series line with a crosshair. Null points break the line. */
export function LineChart({ points, yMin = 0, yMax = 100, height = 200, ariaLabel, format = (v) => `${v.toFixed(1)}%`, refLine, seriesLabel }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { top: 14, right: 16, bottom: 26, left: 40 }
  const plotW = width - m.left - m.right
  const plotH = height - m.top - m.bottom
  const lo = yMin
  const hi = yMax === 'auto' ? niceMax(Math.max(1, ...points.map((p) => p.value ?? 0))) : yMax
  const x = (i) => m.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const y = (v) => m.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH
  const segments = []
  let cur = []
  points.forEach((p, i) => {
    if (p.value == null) { if (cur.length) segments.push(cur); cur = [] } else cur.push([x(i), y(p.value)])
  })
  if (cur.length) segments.push(cur)
  const ticks = [lo, (lo + hi) / 2, hi]
  const labelEvery = Math.ceil(points.length / Math.max(1, Math.floor(plotW / 54)))

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i })
    setHover(best)
  }
  const hp = hover != null ? points[hover] : null

  return (
    <div className="rp-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="rp-grid" />
            <text x={m.left - 6} y={y(t) + 4} className="rp-axis" textAnchor="end">{format(t).replace('.0%', '%')}</text>
          </g>
        ))}
        {refLine && refLine.value >= lo && refLine.value <= hi && (
          <g>
            <line x1={m.left} x2={width - m.right} y1={y(refLine.value)} y2={y(refLine.value)} className="rp-ref" />
            <text x={width - m.right} y={y(refLine.value) - 4} className="rp-axis" textAnchor="end">{refLine.label}</text>
          </g>
        )}
        {segments.map((seg, i) => (
          <polyline key={i} points={seg.map((p) => p.join(',')).join(' ')} className="rp-line" />
        ))}
        {points.map((p, i) => p.value != null && (segments.some((s) => s.length === 1 && s[0][0] === x(i)) || hover === i) && (
          <circle key={p.key} cx={x(i)} cy={y(p.value)} r={4} className="rp-dot" />
        ))}
        {hp && <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + plotH} className="rp-crosshair" />}
        {points.map((p, i) => (
          <g key={p.key}>
            {i % labelEvery === 0 && <text x={x(i)} y={height - 8} className="rp-axis" textAnchor="middle">{p.short ?? p.label}</text>}
            <rect x={x(i) - 8} y={m.top} width={16} height={plotH} className="rp-hit" tabIndex={0} aria-label={`${p.label}: ${p.value == null ? 'no data' : format(p.value)}`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          </g>
        ))}
        {(() => {
          const last = [...points].reverse().find((p) => p.value != null)
          if (!last) return null
          const i = points.indexOf(last)
          return <text x={Math.min(x(i) + 6, width - m.right)} y={y(last.value) - 8} className="rp-value" textAnchor={i === points.length - 1 ? 'end' : 'start'}>{format(last.value)}</text>
        })()}
      </svg>
      {hp && <Tooltip tip={{ x: Math.min(Math.max(x(hover), 80), width - 80), y: 0, title: hp.label, rows: [{ label: seriesLabel ?? '', value: hp.value == null ? 'No data' : format(hp.value), color: 'var(--viz-1)' }, ...(hp.extra ?? [])] }} />}
    </div>
  )
}

/** Horizontal bars, single series (e.g. attendance rate by shop). */
export function HBars({ rows, max = 100, format = (v) => `${v.toFixed(1)}%`, color = 'var(--viz-1)', ariaLabel }) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState(null)
  const labelW = Math.min(180, Math.max(110, width * 0.32))
  const valueW = 56
  const barMax = Math.max(40, width - labelW - valueW - 8)
  const rowH = 32
  const height = rows.length * rowH + 4
  return (
    <div className="rp-chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {rows.map((r, i) => {
          const yTop = i * rowH + 4
          const w = r.value == null ? 0 : (Math.max(0, r.value) / max) * barMax
          const label = r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label
          const show = () => setTip({ x: Math.min(labelW + w / 2 + 40, width - 90), y: yTop + 20, title: r.label, rows: [{ label: r.detail ?? '', value: r.value == null ? 'No data' : format(r.value) }] })
          return (
            <g key={r.key}>
              <text x={0} y={yTop + 16} className="rp-axis rp-axis-label">{label}</text>
              <line x1={labelW} x2={labelW} y1={yTop} y2={yTop + 22} className="rp-baseline" />
              {r.value == null ? (
                <text x={labelW + 6} y={yTop + 16} className="rp-axis">No data</text>
              ) : (
                <>
                  <path d={barPath(labelW, yTop + 3, w, 16)} fill={color} />
                  <text x={labelW + w + 6} y={yTop + 16} className="rp-value">{format(r.value)}</text>
                </>
              )}
              <rect x={0} y={yTop} width={width} height={rowH - 4} className="rp-hit" tabIndex={0} aria-label={`${r.label}: ${r.value == null ? 'no data' : format(r.value)}`} onMouseMove={show} onFocus={show} onBlur={() => setTip(null)} />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Tall segmented bar: one whole split into parts (≤ 6). */
export function SegmentedBar({ parts, ariaLabel }) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState(null)
  const total = parts.reduce((s, p) => s + p.value, 0)
  const visible = parts.filter((p) => p.value > 0)
  const gap = 2
  const usable = width - gap * Math.max(0, visible.length - 1)
  // Left edge of each part, computed up front (no reassignment during render).
  const lefts = visible.reduce((acc, p, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (visible[i - 1].value / total) * usable + gap], [])
  return (
    <div className="rp-chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={28} role="img" aria-label={ariaLabel}>
        {visible.map((p, i) => {
          const w = (p.value / total) * usable
          const share = Math.round((p.value / total) * 100)
          const label = `${share}%`
          const fits = w > label.length * 7 + 12
          const px = lefts[i]
          const show = () => setTip({ x: Math.min(Math.max(px + w / 2, 80), width - 80), y: 30, title: p.label, rows: [{ label: `${share}% of ${fmtInt(total)} checks`, value: fmtInt(p.value), color: p.color }] })
          return (
            <g key={p.key}>
              <rect x={px} y={0} width={w} height={28} rx={4} fill={p.color} />
              {fits && <text x={px + 8} y={18} className="rp-seg-label" style={{ fill: p.ink ?? '#fff' }}>{label}</text>}
              <rect x={px} y={0} width={w} height={28} className="rp-hit" tabIndex={0} aria-label={`${p.label}: ${p.value} (${share}%)`} onMouseMove={show} onFocus={show} onBlur={() => setTip(null)} />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}
