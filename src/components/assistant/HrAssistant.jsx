import { useEffect, useRef, useState } from 'react'
import { SUGGESTIONS, askAssistant } from '../../services/assistantService'
import '../../styles/assistant.css'

let nextId = 1

function BotIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </svg>
  )
}

/**
 * HR Assistant: a read-only chat that answers from the system's own records,
 * within the signed-in user's permissions and companies. Rule-based demo,
 * not an AI model; nothing typed here is sent anywhere.
 */
export default function HrAssistant({ user, companyId, companyLabel, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [messages, setMessages] = useState(() => [{
    id: nextId++,
    from: 'bot',
    text: `Hi ${user.name.split(' ')[0]}, I’m the HR Assistant. Ask me about attendance, exceptions, verifications, imports, working hours or shops. I only use records you’re allowed to see, and I can’t change anything.`,
    items: [],
    links: [],
    suggestions: SUGGESTIONS.slice(0, 5),
  }])
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const launcherRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        launcherRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking])

  const ask = (text) => {
    const question = text.trim()
    if (!question || thinking) return
    setMessages((m) => [...m, { id: nextId++, from: 'user', text: question }])
    setInput('')
    setThinking(true)
    // A short pause so the reply reads as a response; the answer is local.
    setTimeout(() => {
      let answer
      try {
        answer = askAssistant(question, { user, companyId })
      } catch {
        answer = { text: 'Something went wrong while reading the records. Please try again.', items: [], links: [], suggestions: [] }
      }
      setMessages((m) => [...m, { id: nextId++, from: 'bot', ...answer }])
      setThinking(false)
    }, 250)
  }

  const submit = (e) => {
    e.preventDefault()
    ask(input)
  }

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className="as-launcher"
          onClick={() => setOpen(true)}
          aria-label="Open HR Assistant"
          aria-haspopup="dialog"
        >
          <BotIcon />
          <span className="as-launcher-text">Ask HR Assistant</span>
        </button>
      )}

      {open && (
        <section className="as-panel" role="dialog" aria-modal="false" aria-labelledby="as-title">
          <header className="as-head">
            <span className="as-avatar" aria-hidden="true"><BotIcon size={18} /></span>
            <div className="as-head-text">
              <h2 id="as-title">HR Assistant</h2>
              <p>{companyLabel} · read-only demo</p>
            </div>
            <button type="button" className="as-close" onClick={() => { setOpen(false); launcherRef.current?.focus() }} aria-label="Close HR Assistant">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </header>

          <ol className="as-messages" ref={listRef} aria-live="polite" aria-label="Conversation">
            {messages.map((m) => (
              <li key={m.id} className={`as-msg as-msg-${m.from}`}>
                <span className="sr-only">{m.from === 'bot' ? 'HR Assistant:' : 'You:'}</span>
                <div className="as-bubble">
                  <p>{m.text}</p>
                  {m.items?.length > 0 && (
                    <ul className="as-items">
                      {m.items.map((it, i) => (
                        <li key={`${it.primary}-${i}`}>
                          <strong>{it.primary}</strong>
                          {it.secondary && <span>{it.secondary}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.links?.length > 0 && (
                    <div className="as-links">
                      {m.links.map((l) => (
                        <button key={l.label} type="button" className="as-link" onClick={() => onNavigate(l.nav, l.focus)}>
                          {l.label} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {m.suggestions?.length > 0 && (
                  <div className="as-chips" aria-label="Suggested questions">
                    {m.suggestions.map((sug) => (
                      <button key={sug} type="button" className="as-chip" onClick={() => ask(sug)} disabled={thinking}>{sug}</button>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {thinking && (
              <li className="as-msg as-msg-bot">
                <div className="as-bubble as-typing" aria-label="HR Assistant is answering"><span /><span /><span /></div>
              </li>
            )}
          </ol>

          <form className="as-form" onSubmit={submit}>
            <label htmlFor="as-input" className="sr-only">Ask the HR Assistant</label>
            <input
              id="as-input"
              ref={inputRef}
              className="as-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Who is late today?"
              maxLength={300}
              autoComplete="off"
            />
            <button type="submit" className="as-send" disabled={!input.trim() || thinking} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>
            </button>
          </form>
          <p className="as-foot">Answers come from this system’s demo records using built-in rules, not an AI model. Nothing you type is sent anywhere.</p>
        </section>
      )}
    </>
  )
}
