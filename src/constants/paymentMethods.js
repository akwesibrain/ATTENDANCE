import { PAYMENT_METHODS } from '../../supabase/functions/_shared/rules/registration.js'

export { PAYMENT_METHODS }

export function getPaymentMethodLabel(id) {
  return PAYMENT_METHODS.find((m) => m.id === id)?.label ?? ''
}
