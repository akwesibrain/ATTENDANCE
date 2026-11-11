import { useState } from 'react'
import { can } from '../../services/permissionsService'
import { listHolidays, addHoliday, removeHoliday } from '../../services/holidayService'
import { accraTodayKey, formatAccraDate } from '../../utils/accraTime'
import { ConfirmChange, Field, SectionCard } from './SettingsKit'

/**
 * Holidays: Ghana public holidays (built in, every year) plus dates HR sets.
 * A holiday is not a working day, so nobody is absent; any time worked is
 * overtime (clock-in to clock-out). Applies to both companies.
 */
export default function HolidaysSection({ user }) {
  const today = accraTodayKey()
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [form, setForm] = useState({ date: '', name: '' })
  const [errors, setErrors] = useState({})
  const [flash, setFlash] = useState('')
  const [removing, setRemoving] = useState(null)
  const [, setVersion] = useState(0)
  const readOnly = !can(user, 'settings', 'edit')
  const holidays = listHolidays(year)

  const add = async (e) => {
    e.preventDefault()
    const r = await addHoliday(form)
    if (r.errors) { setErrors(r.errors); setFlash(''); return }
    setErrors({})
    setForm({ date: '', name: '' })
    setYear(Number(r.holiday.date.slice(0, 4)))
    setFlash(`${r.holiday.name} (${formatAccraDate(r.holiday.date)}) is now a holiday. Attendance and overtime have been recalculated.`)
    setVersion((v) => v + 1)
  }
  const remove = async () => {
    const r = await removeHoliday(removing.id)
    setRemoving(null)
    if (r.error) { setErrors({ form: r.error }); return }
    setFlash(`${r.removed.name} was removed. ${formatAccraDate(r.removed.date)} is a normal working day again.`)
    setVersion((v) => v + 1)
  }

  return (
    <SectionCard
      title="Holidays"
      description="Public holidays and days HR sets as holidays, for Box For Less and Double A. On a holiday nobody is marked absent, and anyone who works is paid overtime for the whole time from clock-in to clock-out."
      readOnly={readOnly}
      readOnlyReason={readOnly ? 'Setting holidays needs Settings → Edit.' : null}
      flash={flash}
      error={errors.form}
    >
      {!readOnly && (
        <form className="st-grid hol-form" onSubmit={add} noValidate>
          <Field id="hol-date" label="Date" error={errors.date}>
            <input id="hol-date" type="date" className="sh-form-input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field id="hol-name" label="Holiday name" hint="For example: Eid al-Adha, Company anniversary." error={errors.name}>
            <input id="hol-name" className="sh-form-input" maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="st-field hol-add">
            <button type="submit" className="btn btn-primary at-btn">Set as holiday</button>
          </div>
        </form>
      )}

      <div className="hol-head">
        <h4 className="sm-section-title hol-title">Holidays in {year}</h4>
        <div className="hol-years" role="group" aria-label="Year">
          <button type="button" className="sm-actions-btn" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹ {year - 1}</button>
          <button type="button" className="sm-actions-btn" onClick={() => setYear((y) => y + 1)} aria-label="Next year">{year + 1} ›</button>
        </div>
      </div>
      <ul className="hol-list">
        {holidays.map((h) => (
          <li key={h.id} className={`hol-item${h.date < today ? ' is-past' : ''}`}>
            <span className="hol-date">{formatAccraDate(h.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span className="hol-name">{h.name}</span>
            <span className={`at-badge at-tone-${h.kind === 'custom' ? 'ok' : 'muted'}`}>{h.kind === 'custom' ? 'Set by HR' : 'Public holiday'}</span>
            {h.kind === 'custom' && !readOnly
              ? <button type="button" className="sm-actions-btn" onClick={() => setRemoving(h)}>Remove</button>
              : <span className="hol-spacer" aria-hidden="true" />}
          </li>
        ))}
      </ul>

      {removing && (
        <ConfirmChange
          title={`Remove ${removing.name}?`}
          lines={[`${formatAccraDate(removing.date)} becomes a normal working day again.`, 'Employees who did not come to work that day will count as absent.', 'Time worked that day will only count as overtime after the overtime start time.']}
          confirmLabel="Remove holiday"
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  )
}
