import { Component } from 'react'

const SHELL_STYLE = {
  flex: 1,
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 16px',
  background: 'var(--ground, #f6f9fd)',
  color: 'var(--ink, #0e1f3d)',
}

const CARD_STYLE = {
  width: '100%',
  maxWidth: '480px',
  background: 'var(--surface, #ffffff)',
  border: '1px solid var(--rule, #e2eaf4)',
  borderRadius: 'var(--radius-lg, 18px)',
  boxShadow: 'var(--shadow-card, 0 4px 16px rgba(11, 61, 145, 0.08))',
  padding: '28px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
}

const BRAND_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--brand, #0b3d91)',
  fontWeight: 700,
  marginBottom: '4px',
}

const MARK_STYLE = {
  width: '34px',
  height: '34px',
  borderRadius: '10px',
  background: 'var(--brand, #0b3d91)',
  color: '#ffffff',
  display: 'grid',
  placeItems: 'center',
  fontSize: '15px',
  fontWeight: 800,
}

const BUTTON_STYLE = {
  marginTop: '6px',
  minHeight: '44px',
  padding: '12px 20px',
  borderRadius: 'var(--radius-md, 12px)',
  border: '1px solid transparent',
  background: 'var(--accent, #1864cc)',
  color: 'var(--accent-ink, #ffffff)',
  fontWeight: 600,
  fontSize: '16px',
  cursor: 'pointer',
}

/**
 * Top-level recovery boundary so a failed lazy-route import (e.g. after a new
 * deploy or a dropped mobile connection) shows a clean recovery card instead
 * of a blank screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.handleReload = this.handleReload.bind(this)
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, info)
    }
  }

  handleReload() {
    if (typeof this.props.onReload === 'function') {
      this.props.onReload()
      return
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }
    return (
      <main style={SHELL_STYLE}>
        <section style={CARD_STYLE} role="alert">
          <div style={BRAND_STYLE}>
            <span style={MARK_STYLE} aria-hidden="true">WA</span>
            <span>Workforce Attendance</span>
          </div>
          <h1 style={{ fontSize: 'var(--t-h1, 1.5rem)', lineHeight: 1.25 }}>
            This screen needs a refresh
          </h1>
          <p style={{ color: 'var(--ink-2, #51637f)', fontSize: '15px', lineHeight: 1.5 }}>
            A newer version of the app may be available, or your connection
            dropped while opening this page. Reload to continue.
          </p>
          <button type="button" style={BUTTON_STYLE} onClick={this.handleReload}>
            Reload app
          </button>
        </section>
      </main>
    )
  }
}
