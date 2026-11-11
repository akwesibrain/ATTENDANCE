import { mockHasRegistered } from '../services/registrationService'
import InstallAppCard from '../components/common/InstallAppCard'
// The landing page brings its own styles (it used to rely on the registration
// screen loading them, which stopped once pages were loaded separately).
import '../styles/registration.css'
import '../styles/landing.css'

/**
 * Entry screen — choose between employee registration and attendance.
 *
 * STRICT RULE: once this device has completed a registration, the
 * "New Employee Registration" option is hidden — returning employees only
 * see Attendance (and HR). Registration is for first-time setup only.
 */
const POLICY_LINKS = [
  ['/privacy', 'Privacy Policy'],
  ['/tracking-policy', 'Tracking Policy'],
  ['/terms', 'Terms and Conditions'],
  ['/cookies', 'Cookie Policy'],
]

export default function Home({ onRegister, onAttendance, onHr, onPolicy }) {
  const hasRegistered = mockHasRegistered()
  return (
    <main className="registration-page landing-page">
      <div className="registration-shell">
        <header className="registration-brand">
          <span className="registration-brand-mark" aria-hidden="true">
            WA
          </span>
          Workforce Attendance
        </header>

        <section className="card">
          <div className="welcome-hero">
            <div className="welcome-icon" aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 7v5l3 2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="step-title">Workforce Attendance</h1>
            <p className="step-description" style={{ marginBottom: 0 }}>
              {hasRegistered
                ? 'Welcome back. Use attendance to check in or out.'
                : 'Box For Less & Double A employee portal.'}
            </p>
          </div>

          <InstallAppCard />

          <div className="home-actions">
            <button
              type="button"
              className="home-option"
              onClick={onAttendance}
            >
              <span className="home-option-icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9 11l3 3L22 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="home-option-text">
                <span className="home-option-title">Attendance Check-In</span>
                <span className="home-option-desc">
                  Already registered? Use your Staff ID and face verification
                  to check in or out.
                </span>
              </span>
              <span className="home-option-arrow" aria-hidden="true">→</span>
            </button>

            {!hasRegistered && (
              <button
                type="button"
                className="home-option"
                onClick={onRegister}
              >
                <span className="home-option-icon" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
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
                </span>
                <span className="home-option-text">
                  <span className="home-option-title">New Employee Registration</span>
                  <span className="home-option-desc">
                    First time here? Register your profile to get your Staff ID.
                  </span>
                </span>
                <span className="home-option-arrow" aria-hidden="true">→</span>
              </button>
            )}

            <button
              type="button"
              className="home-option"
              onClick={onHr}
            >
              <span className="home-option-icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="3"
                    y="3"
                    width="7"
                    height="9"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <rect
                    x="14"
                    y="3"
                    width="7"
                    height="5"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <rect
                    x="14"
                    y="12"
                    width="7"
                    height="9"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <rect
                    x="3"
                    y="16"
                    width="7"
                    height="5"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </span>
              <span className="home-option-text">
                <span className="home-option-title">HR Dashboard</span>
                <span className="home-option-desc">
                  View employees, attendance records and today&apos;s overview.
                </span>
              </span>
              <span className="home-option-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        <nav className="legal-links" aria-label="Policies">
          {POLICY_LINKS.map(([path, label]) => (
            <a
              key={path}
              href={path}
              onClick={(e) => {
                if (!onPolicy || e.metaKey || e.ctrlKey || e.shiftKey) return
                e.preventDefault()
                onPolicy(path)
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </main>
  )
}
