import { getCompanyById } from '../../constants/companies'
import { getPaymentMethodLabel } from '../../constants/paymentMethods'
import { mockGetShop } from '../../services/shopsService'

function ReviewSection({ title, onEdit, children }) {
  return (
    <div className="review-section">
      <div className="review-section-header">
        <h3>{title}</h3>
        <button type="button" className="edit-btn" onClick={onEdit}>
          Edit
        </button>
      </div>
      {children}
    </div>
  )
}

function ReviewRow({ label, value }) {
  if (!value) return null
  return (
    <div className="review-row">
      <span className="review-label">{label}</span>
      <span className="review-value">{value}</span>
    </div>
  )
}

/**
 * Screen 6 — Review registration before submission.
 */
export default function RegistrationReview({
  data,
  editSteps,
  onEdit,
  onToggleConfirm,
  submitError,
}) {
  const company = getCompanyById(data.companyId)
  const fullName = [data.firstName, data.middleName, data.lastName]
    .filter((part) => part && part.trim())
    .map((part) => part.trim())
    .join(' ')
  const position = data.position.trim()
  const assignedShop = data.assignedShopId
    ? mockGetShop(data.assignedShopId)
    : null

  const hasEmergencyContact =
    data.emergencyContactName.trim() || data.emergencyContactPhone.trim()

  return (
    <section className="card">
      <p className="step-eyebrow">Step 4 of 4</p>
      <h2 className="step-title">Review your registration</h2>
      <p className="step-description">
        Check that everything is correct before submitting. You can edit any
        section.
      </p>

      <ReviewSection title="Company" onEdit={() => onEdit(editSteps.company)}>
        <div className="review-rows">
          <ReviewRow label="Company" value={company?.name} />
        </div>
      </ReviewSection>

      <ReviewSection
        title="Personal information"
        onEdit={() => onEdit(editSteps.personal)}
      >
        <div className="review-rows">
          <ReviewRow label="Full name" value={fullName} />
          <ReviewRow label="Phone number" value={data.phone.trim()} />
          <ReviewRow label="Email address" value={data.email.trim()} />
          <ReviewRow label="Residential address" value={data.address.trim()} />
          <ReviewRow
            label="Payment method"
            value={getPaymentMethodLabel(data.paymentMethod)}
          />
          {hasEmergencyContact && (
            <ReviewRow
              label="Emergency contact"
              value={[data.emergencyContactName.trim(), data.emergencyContactPhone.trim()]
                .filter(Boolean)
                .join(' — ')}
            />
          )}
        </div>
      </ReviewSection>

      <ReviewSection title="Face photo" onEdit={() => onEdit(editSteps.face)}>
        <div className="review-photo-wrap">
          {data.faceImage ? (
            <img className="review-photo" src={data.faceImage} alt="Enrolled face" />
          ) : (
            <span className="field-error" role="alert">
              No face photo captured yet.
            </span>
          )}
        </div>
      </ReviewSection>

      <ReviewSection
        title="Job position"
        onEdit={() => onEdit(editSteps.position)}
      >
        <div className="review-rows">
          <ReviewRow label="Position" value={position} />
          {assignedShop && data.shopMode !== 'new' && (
            <ReviewRow label="Allocated shop" value={assignedShop.shopName} />
          )}
          {data.shopMode === 'new' && data.newShop?.shopName && (
            <ReviewRow label="Allocated shop (new)" value={[data.newShop.shopName, data.newShop.area, data.newShop.town].map((v) => (v ?? '').trim()).filter(Boolean).join(', ')} />
          )}
        </div>
      </ReviewSection>

      <label className="confirm-check">
        <input
          type="checkbox"
          checked={data.confirmed}
          onChange={(e) => onToggleConfirm(e.target.checked)}
        />
        <span>
          I have reviewed my information and confirm it is correct. I accept
          the biometric privacy notice and consent to my face photo being used
          for attendance identity verification.
        </span>
      </label>

      {submitError && (
        <div className="submit-error" role="alert">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>{submitError}</span>
        </div>
      )}
    </section>
  )
}
