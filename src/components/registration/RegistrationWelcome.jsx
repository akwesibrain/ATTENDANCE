import { COMPANIES } from '../../constants/companies'

function ShieldCheckIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CircleCheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="m8.5 12.2 2.4 2.4 4.6-4.8"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const HERO_POINTS = [
  'Quick and easy registration',
  'Get your Staff ID automatically',
  'Start using the system immediately',
]

const FEATURES = [
  {
    title: 'Secure Platform',
    text: 'Your data is protected with enterprise-grade security.',
    icon: 'shield',
  },
  {
    title: 'Fast & Reliable',
    text: 'Register in minutes and start tracking attendance right away.',
    icon: 'bolt',
  },
  {
    title: 'Professional Support',
    text: 'Our team is here to help you every step of the way.',
    icon: 'headset',
  },
]

function FeatureIcon({ name }) {
  if (name === 'shield') return <ShieldCheckIcon size={22} />
  if (name === 'bolt') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 18v-6a9 9 0 0 1 18 0v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Registration landing page — hero plus company selection card.
 * Choosing a company and continuing starts the registration wizard.
 */
export default function RegistrationWelcome({
  selectedCompanyId,
  onSelectCompany,
  onContinue,
  onBack,
}) {
  return (
    <div className="landing-page">
      <div className="landing-inner">
        <header className="landing-header">
          <span className="landing-brand">
            <span className="registration-brand-mark" aria-hidden="true">
              WA
            </span>
            Workforce Attendance
          </span>
          <span className="landing-secure-badge">
            <ShieldCheckIcon size={15} />
            Secure &amp; Trusted
          </span>
        </header>

        <div className="landing-main">
          <div className="landing-hero">
            <span className="landing-pill">Employee Registration Portal</span>
            <h1 className="landing-title">Employee Registration</h1>
            <p className="landing-description">
              Register your employee profile to access your company&apos;s
              workforce attendance system. It only takes a few minutes.
            </p>

            <ul className="landing-points">
              {HERO_POINTS.map((point) => (
                <li key={point}>
                  <span className="landing-point-icon" aria-hidden="true">
                    <CircleCheckIcon />
                  </span>
                  {point}
                </li>
              ))}
            </ul>

            <div className="landing-note">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 16v-4M12 8h.01"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span>
                Your Staff ID will be generated automatically after successful
                registration.
              </span>
            </div>
          </div>

          <section
            className="landing-card"
            aria-label="Start your registration"
          >
            <h2 className="landing-card-title">Start Your Registration</h2>
            <p className="landing-card-subtitle">
              Select your company to begin
            </p>

            <div className="landing-options" role="radiogroup" aria-label="Company">
              {COMPANIES.map((company) => {
                const selected = company.id === selectedCompanyId
                return (
                  <button
                    key={company.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`landing-option${selected ? ' is-selected' : ''}`}
                    onClick={() => onSelectCompany(company.id)}
                  >
                    <span
                      className={`company-logo company-logo-img company-logo-${company.id}`}
                    >
                      <img src={company.logo} alt={`${company.name} logo`} />
                    </span>
                    <span className="landing-option-text">
                      <span className="landing-option-name">{company.name}</span>
                      <span className="landing-option-tagline">
                        {company.tagline}
                      </span>
                    </span>
                    <span className="landing-option-radio" aria-hidden="true">
                      {selected && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <path
                            d="m5 13 4 4L19 7"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              className="btn btn-primary landing-continue"
              onClick={onContinue}
              disabled={!selectedCompanyId}
            >
              Continue
            </button>

            <p className="landing-card-note">
              <ShieldCheckIcon size={14} />
              Secure registration process
            </p>

            {onBack && (
              <button
                type="button"
                className="landing-back-link"
                onClick={onBack}
              >
                Back to Home
              </button>
            )}
          </section>
        </div>

        <div className="landing-features">
          {FEATURES.map((feature) => (
            <div className="landing-feature" key={feature.title}>
              <span className="landing-feature-icon" aria-hidden="true">
                <FeatureIcon name={feature.icon} />
              </span>
              <div>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </div>
            </div>
          ))}
        </div>

        <footer className="landing-footer">
          <span>Workforce Attendance © 2025</span>
          <span>Built for a more productive workplace 💙</span>
        </footer>
      </div>
    </div>
  )
}
