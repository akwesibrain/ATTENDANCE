import { useEffect, useState } from 'react'
import { formatAccraDateTime } from '../../utils/accraTime'

const SMS_TEXT = {
  sent: () => 'SMS sent.',
  skipped: (reason) => `SMS not sent: ${reason}`,
  failed: (reason) => `SMS failed: ${reason}`,
}

/** A one-time setup link HR just made: whether it was texted, and a copy button. */
export default function LinkResult({ url, expiresAt, sms, smsReason }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="link-result" role="status">
      <p className={`link-result-sms link-result-sms-${sms}`}>{(SMS_TEXT[sms] ?? SMS_TEXT.skipped)(smsReason)}</p>
      <div className="link-result-row">
        <input className="sh-form-input link-result-url" readOnly value={url} aria-label="Setup link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <p className="ed-hint">Works once. Expires {formatAccraDateTime(expiresAt)}. Send it by WhatsApp if the SMS did not go.</p>
    </div>
  )
}
