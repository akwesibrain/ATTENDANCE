import { useEffect } from 'react'

const DEFAULT_SELECTOR = '.hr-panel, .sm-panel, .st-card, .emp-card, .hr-stat, .sm-stat, .hr-chooser-card, .landing-option'

/**
 * Subtle scroll animation: elements matching `selector` inside the container
 * that start BELOW the visible area fade and rise into view when scrolled to.
 * Anything already on screen is left alone (no flash on load). New content
 * (page switches) is picked up automatically. Does nothing under reduced
 * motion or where IntersectionObserver is unavailable.
 */
export default function useScrollReveal(containerRef, selector = DEFAULT_SELECTOR) {
  useEffect(() => {
    const root = containerRef.current
    if (!root || typeof window === 'undefined' || !('IntersectionObserver' in window)) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    const seen = new WeakSet()
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const el = entry.target
        io.unobserve(el)
        el.classList.add('reveal-in')
        el.classList.remove('reveal-pending')
        // Clean up after the transition so hover effects work normally.
        setTimeout(() => { el.classList.remove('reveal-in'); el.style.removeProperty('--reveal-i') }, 900)
      })
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })

    const scan = () => {
      const viewBottom = window.innerHeight
      const groups = new Map()
      root.querySelectorAll(selector).forEach((el) => {
        if (seen.has(el)) return
        seen.add(el)
        if (el.getBoundingClientRect().top < viewBottom) return // already visible: never hide it
        // Small stagger between siblings revealed together.
        const i = groups.get(el.parentElement) ?? 0
        groups.set(el.parentElement, i + 1)
        el.style.setProperty('--reveal-i', String(Math.min(i, 5)))
        el.classList.add('reveal-pending')
        io.observe(el)
      })
    }

    scan()
    let frame = 0
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(scan)
    })
    mo.observe(root, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      mo.disconnect()
      io.disconnect()
      root.querySelectorAll('.reveal-pending').forEach((el) => el.classList.remove('reveal-pending'))
    }
  }, [containerRef, selector])
}
