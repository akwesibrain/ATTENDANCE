/**
 * Step progress indicator for the registration flow.
 */
export default function RegistrationProgress({ steps, currentStep }) {
  return (
    <nav className="progress" aria-label="Registration progress">
      <ol className="progress-list">
        {steps.map((label, index) => {
          const state =
            index < currentStep
              ? 'is-complete'
              : index === currentStep
                ? 'is-current'
                : ''
          return (
            <li
              key={label}
              className={`progress-step ${state}`}
              aria-current={index === currentStep ? 'step' : undefined}
            >
              <span className="progress-dot" aria-hidden="true">
                {index < currentStep ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="progress-label">{label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
