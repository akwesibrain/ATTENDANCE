import { useState } from 'react'
import { changeMyPassword } from '../../services/onboardingService'
import { MIN_PASSWORD_LENGTH } from '../../../supabase/functions/_shared/rules/onboarding.js'
import { Field, SectionCard } from './SettingsKit'

const BLANK = { current: '', password: '', confirm: '' }

/** Any HR user changes their own sign-in password. */
export default function MyPasswordSection() {
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value })

  const save = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErrors({})
    setFlash('')
    try {
      const result = await changeMyPassword(form)
      if (result.errors) { setErrors(result.errors); return }
      setForm(BLANK)
      setFlash('Your password was changed. You are still signed in here and were signed out on your other devices.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="My password"
      description="Change the password you sign in to the HR portal with. Your authenticator app stays the same."
      flash={flash}
      error={errors.form}
    >
      <form className="st-grid" onSubmit={save} noValidate>
        <Field id="mp-current" label="Current password" error={errors.current} full>
          <input id="mp-current" type="password" className="sh-form-input" autoComplete="current-password" value={form.current} onChange={set('current')} />
        </Field>
        <Field id="mp-new" label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={errors.password}>
          <input id="mp-new" type="password" className="sh-form-input" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Field id="mp-confirm" label="Type the new password again">
          <input id="mp-confirm" type="password" className="sh-form-input" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </Field>
        <div className="st-field">
          <button type="submit" className="btn btn-primary at-btn" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
        </div>
      </form>
    </SectionCard>
  )
}
