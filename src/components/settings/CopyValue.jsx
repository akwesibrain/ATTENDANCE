import { useEffect, useState } from 'react'

/** A read-only value with a copy button, such as a temporary password. */
export default function CopyValue({ value, label, copyLabel = 'Copy' }) {
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    if (copied === null) return undefined
    const timer = setTimeout(() => setCopied(null), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="link-result-row">
      <input className="sh-form-input link-result-url pw-value" readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
      <button type="button" className="btn btn-secondary" onClick={copy}>
        {copied === true ? 'Copied' : copied === false ? 'Select and copy it' : copyLabel}
      </button>
    </div>
  )
}
