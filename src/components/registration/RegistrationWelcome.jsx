/**
 * Screen 1 — Registration welcome page.
 */
export default function RegistrationWelcome({ onStart }) {
  return (
    <section className="card">
      <div className="welcome-hero">
        <div className="welcome-icon" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path
              d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="9"
              cy="7"
              r="4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19 8v6M22 11h-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="step-title">Employee Registration</h1>
        <p className="step-description" style={{ marginBottom: 0 }}>
          Register your employee profile to access your company&apos;s
          workforce attendance system.
        </p>
      </div>

      <ul className="welcome-points">
        <li>
          <span className="point-icon" aria-hidden="true">
            1
          </span>
          <span>
            Registration is simple and takes only a few minutes — your details,
            a quick face photo, and your job position.
          </span>
        </li>
        <li>
          <span className="point-icon" aria-hidden="true">
            2
          </span>
          <span>
            A unique Staff ID is generated automatically after successful
            registration. No paperwork needed.
          </span>
        </li>
        <li>
          <span className="point-icon" aria-hidden="true">
            3
          </span>
          <span>
            Your account is activated immediately, so you can start using the
            attendance system right away.
          </span>
        </li>
      </ul>

      <div className="step-actions">
        <button type="button" className="btn btn-primary" onClick={onStart}>
          Start Registration
        </button>
      </div>
    </section>
  )
}
