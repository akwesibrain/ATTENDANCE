/**
 * Skeleton loaders: grey shapes in the layout of the content that is loading,
 * so the page does not jump when it arrives. Hidden from screen readers; the
 * wrapper announces "Loading" once.
 */

export function SkeletonLine({ width = '100%', size = '', style }) {
  return <span className={`skel skel-line${size ? ` is-${size}` : ''}`} style={{ width, ...style }} aria-hidden="true" />
}

/** Stat tiles (label + number). */
export function SkeletonStats({ count = 4 }) {
  return (
    <div className="skel-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-card" key={i}>
          <SkeletonLine width="55%" />
          <SkeletonLine width="35%" size="xl" />
        </div>
      ))}
    </div>
  )
}

/** A panel with a title and table-like rows (avatar, name, values). */
export function SkeletonTable({ rows = 6 }) {
  return (
    <div className="skel-card" aria-hidden="true">
      <SkeletonLine width="30%" size="lg" />
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          <span className="skel skel-circle" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <SkeletonLine width={`${28 + ((i * 17) % 22)}%`} />
          <SkeletonLine width="14%" style={{ marginLeft: 'auto' }} />
          <SkeletonLine width="10%" />
        </div>
      ))}
    </div>
  )
}

/** Section loading inside the HR portal (heading, stats, table). */
export function SectionSkeleton({ label = 'Loading' }) {
  return (
    <div className="skel-stack" role="status" aria-live="polite" aria-label={label}>
      <SkeletonLine width="22%" size="xl" />
      <SkeletonStats />
      <SkeletonTable />
    </div>
  )
}

/** Whole-page loading: the HR portal shell, or a centred card for the employee portal. */
export function PageSkeleton({ variant = 'portal', label = 'Loading' }) {
  if (variant === 'hr') {
    return (
      <div className="skel-page" role="status" aria-live="polite" aria-label={label}>
        <div className="skel-side" aria-hidden="true">
          <SkeletonLine width="70%" size="xl" />
          {Array.from({ length: 6 }, (_, i) => <SkeletonLine key={i} width="80%" size="lg" />)}
        </div>
        <div className="skel-main">
          <SkeletonLine width="100%" size="xl" />
          <SectionSkeleton label={label} />
        </div>
      </div>
    )
  }
  return (
    <div className="skel-page" role="status" aria-live="polite" aria-label={label}>
      <div className="skel-center">
        <div className="skel-card" style={{ width: 'min(520px, 100%)' }} aria-hidden="true">
          <SkeletonLine width="40%" size="xl" />
          <SkeletonLine width="85%" />
          <SkeletonLine width="70%" />
          <span className="skel" style={{ height: 220, marginTop: 8 }} />
          <SkeletonLine width="45%" size="lg" />
        </div>
      </div>
    </div>
  )
}
