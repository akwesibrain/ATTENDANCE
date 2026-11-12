import { useState } from 'react'

/**
 * Screen 7 — Registration successful.
 * Displays the Staff ID issued by the server and confirmation actions.
 */
export default function RegistrationSuccess({ result, onNewRegistration }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.staffId)
    } catch {
      // Fallback for browsers without clipboard API access.
      const textarea = document.createElement('textarea')
      textarea.value = result.staffId
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handleDownload = () => {
    const lines = [
      'EMPLOYEE REGISTRATION CONFIRMATION',
      '==================================',
      '',
      `Employee:    ${result.fullName}`,
      `Company:     ${result.companyName}`,
      `Staff ID:    ${result.staffId}`,
      `Position:    ${result.position}`,
      `Status:      ${result.status}`,
      `Registered:  ${new Date(result.registeredAt).toLocaleString()}`,
      '',
      'Your employee registration has been completed successfully. Your account',
      'is now active. Keep your Staff ID safe because you will need it to access',
      'the attendance system.',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `registration-confirmation-${result.staffId}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="card success-card">
      <div className="success-icon" aria-hidden="true">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 12.5l5 5L20 6.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="step-title">Registration Successful</h2>
      <p className="step-description" style={{ marginBottom: 0 }}>
        Welcome aboard, {result.fullName.split(' ')[0]}.
      </p>

      <div className="success-details">
        <div className="success-row">
          <span className="review-label">Employee</span>
          <span className="review-value">{result.fullName}</span>
        </div>
        <div className="success-row">
          <span className="review-label">Company</span>
          <span className="review-value">{result.companyName}</span>
        </div>
        {result.additionalCompanyNames?.length > 0 && (
          <div className="success-row">
            <span className="review-label">Also works for</span>
            <span className="review-value">{result.additionalCompanyNames.join(', ')}</span>
          </div>
        )}
        <div className="success-row">
          <span className="review-label">Staff ID</span>
          <span className="review-value staff-id-value">{result.staffId}</span>
        </div>
        <div className="success-row">
          <span className="review-label">Position</span>
          <span className="review-value">{result.position}</span>
        </div>
        <div className="success-row">
          <span className="review-label">Status</span>
          <span className="status-badge">{result.status}</span>
        </div>
      </div>

      <p className="success-message">
        Your employee registration has been completed successfully. Your
        account is now active. Keep your Staff ID safe because you will need
        it to access the attendance system.
      </p>

      <div className="success-actions">
        <button type="button" className="btn btn-primary" onClick={handleCopy}>
          {copied ? (
            <span className="copied-feedback" style={{ color: '#fff' }}>
              Staff ID Copied ✓
            </span>
          ) : (
            'Copy Staff ID'
          )}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={handleDownload}
        >
          Download Registration Confirmation
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onNewRegistration}
        >
          Return to Welcome Page
        </button>
      </div>
    </section>
  )
}
