import { COMPANIES } from '../../constants/companies'

/**
 * Screen 2 — Company selection.
 * The employee must select exactly one company before proceeding.
 */
export default function CompanySelection({ selectedCompanyId, onSelect }) {
  return (
    <section className="card">
      <p className="step-eyebrow">Step 1 of 5</p>
      <h2 className="step-title">Select your company</h2>
      <p className="step-description">
        Choose the company you work for. Your Staff ID and attendance records
        will be linked to this company.
      </p>

      <div className="company-grid" role="radiogroup" aria-label="Company">
        {COMPANIES.map((company) => {
          const isSelected = company.id === selectedCompanyId
          return (
            <button
              key={company.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`company-card ${isSelected ? 'is-selected' : ''}`}
              onClick={() => onSelect(company.id)}
            >
              <span className="company-check" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span
                className="company-logo"
                style={{ background: company.brandColor }}
                aria-hidden="true"
              >
                {company.initials}
              </span>
              <span>
                <span className="company-name">{company.name}</span>
                <span className="company-desc">{company.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
