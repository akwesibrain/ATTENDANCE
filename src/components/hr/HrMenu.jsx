import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The HR portal's menu on phones and small tablets: a panel that slides in
 * from the left over a dimmed page. It closes on a section pick, the close
 * button, a tap on the dimmed page or Escape; focus stays inside while it is
 * open and goes back to the menu button when it closes.
 */
export default function HrMenu({ open, onClose, returnFocusRef, children, footer }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const returnTo = returnFocusRef?.current
    const panel = panelRef.current
    panel?.querySelector('.hr-drawer-item.is-active, .hr-drawer-item')?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    // The page behind stays put while the menu is open.
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      returnTo?.focus()
    }
  }, [open, onClose, returnFocusRef])

  if (!open) return null
  return (
    <div className="hr-drawer-layer">
      <div className="hr-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        id="hr-menu-panel"
        className="hr-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="hr-drawer-head">
          <span className="hr-drawer-title">Menu</span>
          <button type="button" className="hr-icon-btn hr-drawer-close" onClick={onClose} aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="hr-drawer-nav" aria-label="HR sections">
          {children}
        </nav>
        {footer && <div className="hr-drawer-foot">{footer}</div>}
      </aside>
    </div>
  )
}
