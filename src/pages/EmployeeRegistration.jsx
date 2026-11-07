import { useState } from 'react'
import RegistrationProgress from '../components/registration/RegistrationProgress'
import RegistrationWelcome from '../components/registration/RegistrationWelcome'
import PersonalInformation from '../components/registration/PersonalInformation'
import FaceEnrollment from '../components/registration/FaceEnrollment'
import JobPosition from '../components/registration/JobPosition'
import {
  isJobPositionValid,
  isPersonalInformationValid,
} from '../utils/registrationValidation'
import RegistrationReview from '../components/registration/RegistrationReview'
import RegistrationSuccess from '../components/registration/RegistrationSuccess'
import { submitRegistration } from '../services/registrationService'
import { getCompanyById } from '../constants/companies'
import '../styles/registration.css'

const STEP = {
  welcome: 0,
  personal: 1,
  face: 2,
  position: 3,
  review: 4,
  success: 5,
}

const PROGRESS_LABELS = ['Personal', 'Face', 'Position', 'Review']

const INITIAL_FORM_DATA = {
  companyId: null,
  firstName: '',
  middleName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  faceImage: null,
  position: '',
  confirmed: false,
}

/**
 * Employee self-registration wizard.
 * Owns the shared form state and step navigation; each screen is a
 * presentational component under components/registration.
 */
export default function EmployeeRegistration({ onBack }) {
  const [step, setStep] = useState(STEP.welcome)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)

  const updateField = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const isStepValid = (stepToCheck = step) => {
    switch (stepToCheck) {
      case STEP.personal:
        return isPersonalInformationValid(formData)
      case STEP.face:
        return Boolean(formData.faceImage)
      case STEP.position:
        return isJobPositionValid(formData)
      case STEP.review:
        return (
          formData.confirmed &&
          Boolean(formData.companyId) &&
          isPersonalInformationValid(formData) &&
          Boolean(formData.faceImage) &&
          isJobPositionValid(formData)
        )
      default:
        return true
    }
  }

  const goToStep = (target) => {
    setShowErrors(false)
    setSubmitError(null)
    setStep(target)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleContinue = () => {
    if (!isStepValid()) {
      setShowErrors(true)
      return
    }
    goToStep(step + 1)
  }

  const handleBack = () => goToStep(step - 1)

  const handleSubmit = async () => {
    if (submitting || !isStepValid(STEP.review)) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const response = await submitRegistration(formData)
      setResult(response)
      goToStep(STEP.success)
    } catch (error) {
      setSubmitError(
        error?.message ??
          'Registration failed. Please check your connection and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleNewRegistration = () => {
    setFormData(INITIAL_FORM_DATA)
    setResult(null)
    setSubmitError(null)
    goToStep(STEP.welcome)
  }

  const showProgress = step >= STEP.personal && step <= STEP.review
  const showBack = step > STEP.personal && step <= STEP.review
  const company = getCompanyById(formData.companyId)

  if (step === STEP.welcome) {
    return (
      <RegistrationWelcome
        selectedCompanyId={formData.companyId}
        onSelectCompany={(companyId) => updateField('companyId', companyId)}
        onContinue={() => {
          if (formData.companyId) goToStep(STEP.personal)
        }}
        onBack={onBack}
      />
    )
  }

  return (
    <main className="registration-page">
      <div className="registration-shell">
        <header className="registration-brand registration-brand-with-company">
          <span className="registration-brand-name">
            <span className="registration-brand-mark" aria-hidden="true">
              WA
            </span>
            Workforce Attendance
          </span>
          {company && (
            <span className="registration-company-badge">
              <span
                className={`company-logo company-logo-img company-logo-${company.id}`}
              >
                <img src={company.logo} alt={`${company.name} logo`} />
              </span>
              <span className="registration-company-name">{company.name}</span>
            </span>
          )}
        </header>

        {showProgress && (
          <RegistrationProgress
            steps={PROGRESS_LABELS}
            currentStep={step - STEP.personal}
          />
        )}

        {step === STEP.personal && (
          <PersonalInformation
            data={formData}
            onChange={updateField}
            showErrors={showErrors}
          />
        )}

        {step === STEP.face && (
          <FaceEnrollment
            faceImage={formData.faceImage}
            onCapture={(image) => updateField('faceImage', image)}
          />
        )}

        {step === STEP.position && (
          <JobPosition
            data={formData}
            onChange={updateField}
            showErrors={showErrors}
          />
        )}

        {step === STEP.review && (
          <RegistrationReview
            data={formData}
            editSteps={{ ...STEP, company: STEP.welcome }}
            onEdit={goToStep}
            onToggleConfirm={(checked) => updateField('confirmed', checked)}
            submitError={submitError}
          />
        )}

        {step === STEP.success && result && (
          <RegistrationSuccess
            result={result}
            onNewRegistration={handleNewRegistration}
          />
        )}

        {step >= STEP.personal && step <= STEP.review && (
          <div className="step-actions" style={{ marginTop: 0 }}>
            {showBack && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBack}
                disabled={submitting}
              >
                Back
              </button>
            )}
            {step < STEP.review ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleContinue}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!isStepValid(STEP.review) || submitting}
              >
                {submitting ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  'Submit Registration'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
