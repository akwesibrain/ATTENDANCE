import { Fragment, useEffect } from 'react'
import { LEGAL_DOCS } from '../content/legalDocs'
import { LEGAL_GAP_LABELS, legalIsDraft, legalValues } from '../constants/legal'
import '../styles/registration.css'
import '../styles/legal.css'

/**
 * One page for the four policies (Privacy, Tracking, Terms, Cookies), with
 * tabs to move between them. Text lives in src/content/legalDocs.js; company
 * details and retention periods in src/constants/legal.js.
 */
export default function LegalPage({ docId, onNavigate, onBack }) {
  const doc = LEGAL_DOCS.find((d) => d.id === docId) ?? LEGAL_DOCS[0]
  const values = legalValues()
  const draft = legalIsDraft()

  useEffect(() => {
    document.title = `${doc.title} · Workforce Attendance`
    window.scrollTo?.(0, 0)
    return () => { document.title = 'Workforce Attendance' }
  }, [doc])

  const go = (e, path) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return
    e.preventDefault()
    onNavigate(path)
  }

  return (
    <main className="registration-page legal-page">
      <div className="legal-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">WA</span>
          Workforce Attendance
        </header>

        <nav className="legal-tabs" aria-label="Policies">
          {LEGAL_DOCS.map((d) => (
            <a key={d.id} href={d.path} className="legal-tab" aria-current={d.id === doc.id ? 'page' : undefined} onClick={(e) => go(e, d.path)}>
              {d.short}
            </a>
          ))}
        </nav>

        <article className="card legal-doc">
          {draft && (
            <p className="legal-draft" role="note">
              <strong>Draft.</strong> Some company details are not filled in yet (highlighted below). This policy must be completed and checked before the app goes live.
            </p>
          )}
          <h1 className="step-title">{doc.title}</h1>
          <p className="legal-meta">Version {values.version} · Effective {values.effectiveDate}</p>
          <p className="legal-summary">{doc.summary}</p>

          <nav className="legal-toc" aria-label="On this page">
            <ol>
              {doc.sections.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.heading}</a></li>)}
            </ol>
          </nav>

          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section" aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}>{s.heading}</h2>
              {s.blocks.map((b, i) => <Block key={i} block={b} values={values} go={go} />)}
            </section>
          ))}
        </article>

        <div className="legal-actions">
          <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
        </div>
      </div>
    </main>
  )
}

function Block({ block, values, go }) {
  const t = (s) => <Inline text={s} values={values} go={go} />
  if (block.p) return <p>{t(block.p)}</p>
  if (block.ul) return <ul>{block.ul.map((li, i) => <li key={i}>{t(li)}</li>)}</ul>
  if (block.table) {
    return (
      <div className="legal-table-wrap">
        <table className="legal-table">
          <thead><tr>{block.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {block.table.rows.map((row, r) => (
              <tr key={r}>{row.map((cell, c) => <td key={c} data-label={block.table.head[c]}>{t(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\{\{[^}]+\}\})/g

/** **bold**, [link](/path) and {{value}} inside policy text. */
function Inline({ text, values, go }) {
  return text.split(TOKEN).map((part, i) => {
    if (!part) return null
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('[')) {
      const [, label, path] = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      return <a key={i} href={path} onClick={(e) => go(e, path)}>{label}</a>
    }
    if (part.startsWith('{{')) {
      const key = part.slice(2, -2)
      const v = values[key]
      return v
        ? <Fragment key={i}>{v}</Fragment>
        : <mark key={i} className="legal-gap">[{LEGAL_GAP_LABELS[key] ?? key} — to be completed]</mark>
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
