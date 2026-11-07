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

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4.5 12.5 5 5 10-11"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const HERO_POINTS = [
  'Type your details and take one face photo',
  'Your Staff ID is issued the moment you finish',
  'Check in and out with that ID and your face',
]

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
            Secure &amp; trusted
          </span>
        </header>

        <div className="landing-main">
          <div className="landing-hero">
            <h1 className="landing-title">Employee registration</h1>
            <p className="landing-description">
              Create your employee profile for Box For Less or Double A. After
              that, attendance is your Staff ID and your face, in seconds.
            </p>

            <ul className="landing-points">
              {HERO_POINTS.map((point) => (
                <li key={point}>
                  <span className="landing-point-icon" aria-hidden="true">
                    <CheckIcon />
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
                Your Staff ID is generated automatically when your registration
                is complete. Keep it safe; you need it every time you check in.
              </span>
            </div>
          </div>

          <section
            className="landing-card"
            aria-label="Start your registration"
          >
            <h2 className="landing-card-title">Start your registration</h2>
            <p className="landing-card-subtitle">
              Choose your company to begin
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
              Your photo is used only to verify your attendance
            </p>

            {onBack && (
              <button
                type="button"
                className="landing-back-link"
                onClick={onBack}
              >
                Back to home
              </button>
            )}
          </section>
        </div>

        <footer className="landing-footer">
          <span>Workforce Attendance · Box For Less &amp; Double A</span>
          <span>© 2025</span>
        </footer>
      </div>
    </div>
  )
}
