/**
 * Salary payment methods. These are the only three ways the company pays
 * salaries, so the registration form offers exactly these options.
 */
export const PAYMENT_METHODS = [
  { id: 'table-top', label: 'Table Top' },
  { id: 'mobile-money', label: 'Mobile Money' },
  { id: 'bank', label: 'Bank' },
]

export function getPaymentMethodLabel(id) {
  return PAYMENT_METHODS.find((m) => m.id === id)?.label ?? ''
}
