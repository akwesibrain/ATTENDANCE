import { useMemo, useState } from 'react'
import { COMPANIES } from '../../constants/companies'
import { authorisedCompanies, can } from '../../services/permissionsService'
import {
  CHECKS_PER_SHIFT,
  CYCLE_END_DAY,
  CYCLE_START_DAY,
  LANDING_PAGES,
  NOTIFICATION_GROUPS,
  TIMEZONE,
  attendanceRuleVersions,
  canEditCompanySettings,
  canEditSystemSettings,
  companySettings,
  exportConfiguration,
  generalSettings,
  getSettings,
  monitoringSettings,
  saveAttendanceRules,
  saveCompany,
  saveGeneral,
  saveMonitoring,
  saveNotificationPrefs,
  saveSecurity,
  saveWorkingHours,
  securitySettings,
  attendanceRulesFor,
  defaultHoursFor,
  workingHoursVersions,
  overtimeRateFor,
  overtimeRateVersions,
  saveOvertimeRate,
  saveVatRate,
  vatRateFor,
} from '../../services/settingsService'
import { formatCedis, formatOvertime, overtimePay } from '../../services/overtimeService'
import { recordAuditEvent } from '../../services/auditStore'
import { attendanceRecordsToCsv, listAttendanceRecords, listAttendanceRoster, recordOrigin } from '../../services/attendanceRecordsService'
import { mockListAllShops } from '../../services/shopsService'
import { mockGetAllEvents } from '../../services/attendanceService'
import { elapsedPeriodDateKeys, periodForDateKey } from '../../utils/attendanceRules'
import { accraTodayKey, formatAccraDate, formatAccraDateTime } from '../../utils/accraTime'
import { ConfirmChange, Field, Locked, SectionCard, StatusRow, Toggle } from './SettingsKit'
import { compressImageDataUrl } from '../../utils/imageCompression'

const DAYS = [
  { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' },
]
const SYSTEM_RO = 'Your account cannot change system-wide settings.'

function useSection(initial) {
  const [base, setBase] = useState(initial)
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [flash, setFlash] = useState('')
  const [confirming, setConfirming] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(base)
  return {
    form,
    errors,
    flash,
    dirty,
    confirming,
    setConfirming,
    set: (k, v) => { setForm((f) => ({ ...f, [k]: v })); setFlash(''); setErrors({}) },
    reset: () => { setForm(base); setErrors({}); setFlash('') },
    fail: (errs) => { setErrors(errs); setConfirming(false) },
    done: (message, next) => { setBase(next); setForm(next); setFlash(message); setErrors({}); setConfirming(false) },
  }
}

function changedLines(before, after, labels) {
  return Object.keys(after)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${labels[k] ?? k}: ${fmt(before[k])} → ${fmt(after[k])}`)
}
const fmt = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'On' : 'Off') : v == null || v === '' ? '—' : String(v))

function readImage(file, maxBytes, onDone, onError) {
  if (!file) return
  if (!file.type.startsWith('image/')) { onError('Choose an image (PNG, JPG, SVG or WEBP).'); return }
  if (file.size > maxBytes) { onError(`Choose an image under ${Math.round(maxBytes / 1024)} KB.`); return }
  const reader = new FileReader()
  // Logos are shown small: resize to 256 px and re-encode (SVGs kept as they are).
  reader.onload = () => compressImageDataUrl(reader.result).then(onDone)
  reader.onerror = () => onError('The image could not be read.')
  reader.readAsDataURL(file)
}

function download(name, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ 1 */
export function GeneralSection({ user, onChanged }) {
  const s = useSection(generalSettings())
  const [logoError, setLogoError] = useState('')
  const readOnly = !canEditSystemSettings(user)
  const f = s.form
  const save = () => {
    const r = saveGeneral(f, user)
    if (r.errors) return s.fail(r.errors)
    s.done('General settings saved.', r.settings.general)
    onChanged?.()
  }
  return (
    <SectionCard title="General Settings" description="How the HR portal identifies itself and shows dates and times." readOnly={readOnly} readOnlyReason={readOnly ? SYSTEM_RO : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={save} onCancel={s.reset}>
      <div className="st-grid">
        <Field id="g-name" label="System name" error={s.errors.systemName}>
          <input id="g-name" className="sh-form-input" value={f.systemName} disabled={readOnly} onChange={(e) => s.set('systemName', e.target.value)} />
        </Field>
        <Field id="g-landing" label="Default landing page" hint="The page shown after signing in." error={s.errors.landingPage}>
          <select id="g-landing" className="sh-form-select" value={f.landingPage} disabled={readOnly} onChange={(e) => s.set('landingPage', e.target.value)}>
            {Object.entries(LANDING_PAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field id="g-desc" label="System description" full error={s.errors.description}>
          <textarea id="g-desc" className="sh-form-input" rows={2} value={f.description} disabled={readOnly} onChange={(e) => s.set('description', e.target.value)} />
        </Field>
        <Field id="g-lang" label="Default language" hint="Only English is available in this prototype." error={s.errors.language}>
          <select id="g-lang" className="sh-form-select" value={f.language} disabled={readOnly} onChange={(e) => s.set('language', e.target.value)}>
            <option value="en-GB">English (United Kingdom)</option>
          </select>
        </Field>
        <Field id="g-date" label="Date format" applied={false} hint="Saved for the backend and exports; screens use the browser's standard date style." error={s.errors.dateFormat}>
          <select id="g-date" className="sh-form-select" value={f.dateFormat} disabled={readOnly} onChange={(e) => s.set('dateFormat', e.target.value)}>
            <option value="d MMM yyyy">9 Nov 2026</option>
            <option value="dd/MM/yyyy">09/11/2026</option>
            <option value="yyyy-MM-dd">2026-11-09</option>
          </select>
        </Field>
        <Field id="g-time" label="Time format" hint="Applied to every time shown in the portal." error={s.errors.timeFormat}>
          <select id="g-time" className="sh-form-select" value={f.timeFormat} disabled={readOnly} onChange={(e) => s.set('timeFormat', e.target.value)}>
            <option value="12h">12-hour (9:05 AM)</option>
            <option value="24h">24-hour (09:05)</option>
          </select>
        </Field>
        <Locked label="Default time zone" value={TIMEZONE} hint="All attendance calculations use Africa/Accra (UTC+0, no daylight saving)." />
        <Field id="g-logo" label="System logo" hint="Kept in this browser only (mock upload)." error={logoError}>
          <div className="st-logo-row">
            {f.logo ? <img src={f.logo} alt="System logo preview" className="st-logo" /> : <span className="st-logo st-logo-empty">No logo</span>}
            {!readOnly && <input id="g-logo" type="file" accept="image/*" onChange={(e) => readImage(e.target.files?.[0], 300 * 1024, (url) => { setLogoError(''); s.set('logo', url) }, setLogoError)} />}
            {!readOnly && f.logo && <button type="button" className="hr-link" onClick={() => s.set('logo', null)}>Remove</button>}
          </div>
        </Field>
      </div>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ 2 */
function CompanyForm({ companyId, user, onChanged }) {
  const s = useSection(companySettings(companyId))
  const [logoError, setLogoError] = useState('')
  const readOnly = !canEditCompanySettings(user, companyId)
  const canStatus = canEditSystemSettings(user)
  const f = s.form
  const base = companySettings(companyId)
  const labels = { displayName: 'Display name', code: 'Company code', phone: 'Contact number', email: 'Email', address: 'Address', status: 'Status', logo: 'Logo' }
  const sensitive = f.status !== base.status || f.displayName !== base.displayName || f.code !== base.code
  const save = () => {
    const r = saveCompany(companyId, f, user)
    if (r.errors) return s.fail(r.errors)
    s.done('Company settings saved. Employee IDs and attendance records are unchanged.', r.settings.companies[companyId])
    onChanged?.()
  }
  return (
    <SectionCard
      title={`Company Settings — ${base.displayName}`}
      description="Each company's profile is kept separately."
      readOnly={readOnly}
      readOnlyReason={readOnly ? 'Editing company settings needs Settings → Edit for this company.' : null}
      dirty={s.dirty}
      flash={s.flash}
      error={s.errors.form}
      onSave={() => (sensitive ? s.setConfirming(true) : save())}
      onCancel={s.reset}
    >
      <div className="st-grid">
        <Field id="c-name" label="Display name" hint="Changing it does not change employee IDs or stored attendance records." error={s.errors.displayName}>
          <input id="c-name" className="sh-form-input" value={f.displayName} disabled={readOnly} onChange={(e) => s.set('displayName', e.target.value)} />
        </Field>
        <Field id="c-code" label="Company code" hint="Display only. Existing Staff ID prefixes are never changed." error={s.errors.code}>
          <input id="c-code" className="sh-form-input" value={f.code} disabled={readOnly} onChange={(e) => s.set('code', e.target.value.toUpperCase())} />
        </Field>
        <Field id="c-phone" label="Contact number" error={s.errors.phone}>
          <input id="c-phone" className="sh-form-input" value={f.phone} disabled={readOnly} inputMode="tel" onChange={(e) => s.set('phone', e.target.value)} />
        </Field>
        <Field id="c-email" label="Company email" error={s.errors.email}>
          <input id="c-email" type="email" className="sh-form-input" value={f.email} disabled={readOnly} onChange={(e) => s.set('email', e.target.value)} />
        </Field>
        <Field id="c-address" label="Company address" full>
          <input id="c-address" className="sh-form-input" value={f.address} disabled={readOnly} onChange={(e) => s.set('address', e.target.value)} />
        </Field>
        <Field id="c-status" label="Company status" applied={false} hint={canStatus ? 'Recorded only: an inactive company still appears in this demo.' : 'Your account cannot change a company’s status.'} error={s.errors.status}>
          <select id="c-status" className="sh-form-select" value={f.status} disabled={readOnly || !canStatus} onChange={(e) => s.set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field id="c-logo" label="Company logo" hint="Mock upload, kept in this browser." error={logoError}>
          <div className="st-logo-row">
            {f.logo ? <img src={f.logo} alt="Company logo preview" className="st-logo" /> : (
              <img src={COMPANIES.find((c) => c.id === companyId)?.logo} alt="Current company logo" className="st-logo" />
            )}
            {!readOnly && <input id="c-logo" type="file" accept="image/*" onChange={(e) => readImage(e.target.files?.[0], 300 * 1024, (url) => { setLogoError(''); s.set('logo', url) }, setLogoError)} />}
            {!readOnly && f.logo && <button type="button" className="hr-link" onClick={() => s.set('logo', null)}>Use default logo</button>}
          </div>
        </Field>
      </div>
      {s.confirming && (
        <ConfirmChange title={`Change ${base.displayName}'s settings?`} lines={[...changedLines(base, f, labels), 'Employee IDs and attendance records are not changed.']} onConfirm={save} onCancel={() => s.setConfirming(false)} />
      )}
    </SectionCard>
  )
}

export function CompanySection({ user, defaultCompanyId, onChanged }) {
  const companies = authorisedCompanies(user)
  const [companyId, setCompanyId] = useState(companies.some((c) => c.id === defaultCompanyId) ? defaultCompanyId : companies[0]?.id)
  if (!companyId) return <p className="sm-empty">No company access.</p>
  return (
    <>
      {companies.length > 1 && (
        <div className="st-company-tabs sm-tabs" role="tablist" aria-label="Company">
          {companies.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={companyId === c.id} className={`sm-tab${companyId === c.id ? ' is-active' : ''}`} onClick={() => setCompanyId(c.id)}>{companySettings(c.id)?.displayName ?? c.name}</button>
          ))}
        </div>
      )}
      <CompanyForm key={companyId} companyId={companyId} user={user} onChanged={onChanged} />
    </>
  )
}

/* ------------------------------------------------------------------ 3 */
export function AttendanceSection({ user }) {
  const today = accraTodayKey()
  const s = useSection({ ...attendanceRulesFor(today), effectiveFrom: today })
  const readOnly = !canEditSystemSettings(user)
  const f = s.form
  const period = periodForDateKey(today)
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }
  const versions = attendanceRuleVersions()
  const labels = { graceMinutes: 'Late grace', clockOutWindowMinutes: 'Clock-out window', missingClockIn: 'Missing clock-in', incompleteHandling: 'Incomplete records', minCorrectionRemarks: 'Minimum remarks', correctionApproval: 'Correction approval', effectiveFrom: 'Effective from' }
  const save = () => {
    const { effectiveFrom, ...values } = f
    const r = saveAttendanceRules(values, effectiveFrom, user)
    if (r.errors) return s.fail(r.errors)
    s.done(`Attendance rules saved, effective ${formatAccraDate(effectiveFrom)}. Earlier days keep the rules in force at the time.`, { ...attendanceRulesFor(today), effectiveFrom: today })
  }
  return (
    <SectionCard title="Attendance Settings" description="Rules used to calculate attendance. Changes apply from an effective date and never rewrite earlier days." readOnly={readOnly} readOnlyReason={readOnly ? SYSTEM_RO : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={() => s.setConfirming(true)} onCancel={s.reset}>
      <div className="st-grid">
        <Locked label="Attendance cycle start day" value={`${CYCLE_START_DAY}th of the month`} />
        <Locked label="Attendance cycle end day" value={`${CYCLE_END_DAY}th of the next month`} hint={`Current period: ${period.label} runs ${period.start.toLocaleDateString([], opts)} – ${period.end.toLocaleDateString([], opts)}. Calendar months are never used.`} />
        <Locked label="Time zone" value={TIMEZONE} />
        <Locked label="Approved leave" value="Never counted as absence" />
        <Locked label="Future dates" value="Never counted as absences" />
        <Locked label="Manual entry" value="Only dates HR enters — others are never marked absent by it" />
        <Locked label="Late arrival" value="Set per company" hint="Use the late-coming time in Working Hours & Timezone." />
        <Field id="a-window" label="Missing clock-out: window after the end of the working day (minutes)" hint="After this, a clock-in without clock-out becomes Incomplete." error={s.errors.clockOutWindowMinutes}>
          <input id="a-window" type="number" min={15} max={360} className="sh-form-input" value={f.clockOutWindowMinutes} disabled={readOnly} onChange={(e) => s.set('clockOutWindowMinutes', e.target.value)} />
        </Field>
        <Field id="a-missing" label="Missing clock-in handling" applied={f.missingClockIn === 'absent-after-shift-end'} hint="Nobody is ever absent before the working day has ended. A review-first workflow is not built in this prototype." error={s.errors.missingClockIn}>
          <select id="a-missing" className="sh-form-select" value={f.missingClockIn} disabled={readOnly} onChange={(e) => s.set('missingClockIn', e.target.value)}>
            <option value="absent-after-shift-end">Absent once the working day has ended (raise an exception)</option>
            <option value="review-before-absent">Hold for HR review before marking absent</option>
          </select>
        </Field>
        <Field id="a-incomplete" label="Incomplete attendance handling" hint="Whether incomplete records also raise a notification." error={s.errors.incompleteHandling}>
          <select id="a-incomplete" className="sh-form-select" value={f.incompleteHandling} disabled={readOnly} onChange={(e) => s.set('incompleteHandling', e.target.value)}>
            <option value="flag-and-notify">Mark Incomplete and notify HR</option>
            <option value="flag-only">Mark Incomplete only</option>
          </select>
        </Field>
        <Field id="a-remarks" label="Manual correction: minimum remarks length" hint="A reason and remarks are always required; previous values are always kept." error={s.errors.minCorrectionRemarks}>
          <input id="a-remarks" type="number" min={10} max={200} className="sh-form-input" value={f.minCorrectionRemarks} disabled={readOnly} onChange={(e) => s.set('minCorrectionRemarks', e.target.value)} />
        </Field>
        <Field id="a-approval" label="Attendance correction approval" applied={f.correctionApproval === 'not-required'} hint="A second-person approval workflow for corrections is not built in this prototype." error={s.errors.correctionApproval}>
          <select id="a-approval" className="sh-form-select" value={f.correctionApproval} disabled={readOnly} onChange={(e) => s.set('correctionApproval', e.target.value)}>
            <option value="not-required">Not required (audit trail only)</option>
            <option value="manager-approval">HR Manager approval required</option>
          </select>
        </Field>
        <Field id="a-eff" label="Effective from" hint="Today or a later date; changes cannot be backdated." error={s.errors.effectiveFrom}>
          <input id="a-eff" type="date" className="sh-form-input" min={today} value={f.effectiveFrom} disabled={readOnly} onChange={(e) => s.set('effectiveFrom', e.target.value)} />
        </Field>
      </div>
      <VersionTable versions={versions} render={(v) => `Clock-out window ${v.clockOutWindowMinutes} min · remarks ≥ ${v.minCorrectionRemarks} · ${v.incompleteHandling === 'flag-and-notify' ? 'notify on incomplete' : 'no incomplete notifications'}`} />
      {s.confirming && (
        <ConfirmChange title="Change attendance rules?" lines={[...changedLines({ ...attendanceRulesFor(today), effectiveFrom: today }, f, labels), `Applies from ${formatAccraDate(f.effectiveFrom)}; earlier days are not recalculated.`]} onConfirm={save} onCancel={() => s.setConfirming(false)} />
      )}
    </SectionCard>
  )
}

function VersionTable({ versions, render }) {
  return (
    <div className="st-versions">
      <span className="sm-detail-label">Rule history (effective-dated)</span>
      <ul>
        {versions.map((v) => (
          <li key={v.effectiveFrom}>
            <strong>{v.effectiveFrom === '2000-01-01' ? 'Original defaults' : `From ${formatAccraDate(v.effectiveFrom)}`}</strong>
            <span>{render(v.values)}</span>
            <span className="st-hint">{v.changedBy}{v.changedAt ? ` · ${formatAccraDateTime(v.changedAt)}` : ''}{v.effectiveFrom > accraTodayKey() ? ' · scheduled' : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ 4 */
function HoursForm({ companyId, user }) {
  const today = accraTodayKey()
  const current = defaultHoursFor(companyId, today)
  const initial = { workingDays: current.workingDays, startTime: current.startTime, lateAfter: current.lateAfter, endTime: current.endTime, overtimeStart: current.overtimeStart, breakStart: current.breakStart, breakMinutes: current.breakMinutes, effectiveFrom: today }
  const s = useSection(initial)
  const readOnly = !canEditCompanySettings(user, companyId)
  const f = s.form
  const labels = { workingDays: 'Working days', startTime: 'Official clock-in', lateAfter: 'Late after', endTime: 'Official clock-out', overtimeStart: 'Overtime starts', breakStart: 'Break starts', breakMinutes: 'Break (min)', effectiveFrom: 'Effective from' }
  const save = () => {
    const { effectiveFrom, ...values } = f
    const r = saveWorkingHours(companyId, values, effectiveFrom, user)
    if (r.errors) return s.fail(r.errors)
    s.done(`Default hours saved, effective ${formatAccraDate(effectiveFrom)}.`, initial)
  }
  const toggleDay = (d) => s.set('workingDays', f.workingDays.includes(d) ? f.workingDays.filter((x) => x !== d) : [...f.workingDays, d])
  return (
    <SectionCard title={`Working Hours & Timezone — ${companySettings(companyId)?.displayName}`} description="The working hours every employee follows (no shifts). Default: Monday to Friday, 08:00 to 17:00." readOnly={readOnly} readOnlyReason={readOnly ? 'Editing needs Settings → Edit for this company.' : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={() => s.setConfirming(true)} onCancel={s.reset}>
      <div className="st-grid">
        <Locked label="System time zone" value={`${TIMEZONE} (UTC+0)`} hint="Changing the time zone is not supported by this prototype's calculations." />
        <Field id="w-days" label="Company working days" full error={s.errors.workingDays}>
          <div className="sh-days">
            {DAYS.map((d) => (
              <button key={d.v} type="button" className={`sh-day${f.workingDays.includes(d.v) ? ' is-selected' : ''}`} aria-pressed={f.workingDays.includes(d.v)} disabled={readOnly} onClick={() => toggleDay(d.v)}>{d.l}</button>
            ))}
          </div>
        </Field>
        <Field id="w-start" label="Official clock-in time" error={s.errors.startTime}>
          <input id="w-start" type="time" className="sh-form-input" value={f.startTime} disabled={readOnly} onChange={(e) => s.set('startTime', e.target.value)} />
        </Field>
        <Field id="w-late" label="Late-coming time" hint="Employees clocking in after this time are marked late." error={s.errors.lateAfter}>
          <input id="w-late" type="time" className="sh-form-input" value={f.lateAfter} disabled={readOnly} onChange={(e) => s.set('lateAfter', e.target.value)} />
        </Field>
        <Field id="w-end" label="Official clock-out time" error={s.errors.endTime}>
          <input id="w-end" type="time" className="sh-form-input" value={f.endTime} disabled={readOnly} onChange={(e) => s.set('endTime', e.target.value)} />
        </Field>
        <Field id="w-ot" label="Overtime start time" hint="On weekdays only time after this counts as overtime (e.g. 17:01 for a 17:00 clock-out). Saturday and Sunday are overtime all day." error={s.errors.overtimeStart}>
          <input id="w-ot" type="time" className="sh-form-input" value={f.overtimeStart} disabled={readOnly} onChange={(e) => s.set('overtimeStart', e.target.value)} />
        </Field>
        <Field id="w-bstart" label="Break starts" error={s.errors.breakStart}>
          <input id="w-bstart" type="time" className="sh-form-input" value={f.breakStart} disabled={readOnly} onChange={(e) => s.set('breakStart', e.target.value)} />
        </Field>
        <Field id="w-bmin" label="Default break (minutes)" hint="Deducted from working hours when the work spans the break." error={s.errors.breakMinutes}>
          <input id="w-bmin" type="number" min={0} max={120} className="sh-form-input" value={f.breakMinutes} disabled={readOnly} onChange={(e) => s.set('breakMinutes', e.target.value)} />
        </Field>
        <Field id="w-eff" label="Effective from" hint="Today or later; earlier days keep the hours in force at the time." error={s.errors.effectiveFrom}>
          <input id="w-eff" type="date" className="sh-form-input" min={today} value={f.effectiveFrom} disabled={readOnly} onChange={(e) => s.set('effectiveFrom', e.target.value)} />
        </Field>
      </div>
      <VersionTable versions={workingHoursVersions(companyId)} render={(v) => `${v.startTime}–${v.endTime} · late after ${v.lateAfter ?? '09:00'} · overtime from ${v.overtimeStart ?? '17:01'} · ${v.workingDays.map((d) => DAYS.find((x) => x.v === d)?.l).join(', ')} · break ${v.breakMinutes} min`} />
      {s.confirming && (
        <ConfirmChange title="Change default working hours?" lines={[...changedLines(initial, f, labels), 'Applies to all employees of this company.']} onConfirm={save} onCancel={() => s.setConfirming(false)} />
      )}
    </SectionCard>
  )
}

function PayForm({ companyId, user }) {
  const today = accraTodayKey()
  const initial = { overtimeRate: overtimeRateFor(companyId, today), effectiveFrom: today, vatRate: vatRateFor(companyId) }
  const s = useSection(initial)
  const readOnly = !canEditCompanySettings(user, companyId)
  const f = s.form
  const name = companySettings(companyId)?.displayName
  const rate = Number(f.overtimeRate) || 0
  const examples = [30, 90, 120]
  const save = () => {
    const errors = {}
    let message = []
    if (Number(f.overtimeRate) !== initial.overtimeRate || f.effectiveFrom !== initial.effectiveFrom) {
      const r = saveOvertimeRate(companyId, f.overtimeRate, f.effectiveFrom, user)
      if (r.errors) Object.assign(errors, r.errors.form && /Nothing/.test(r.errors.form) ? {} : r.errors)
      else message.push(`Overtime rate ${formatCedis(Number(f.overtimeRate))}/h from ${formatAccraDate(f.effectiveFrom)}`)
    }
    if (Number(f.vatRate) !== initial.vatRate) {
      const r = saveVatRate(companyId, f.vatRate, user)
      if (r.errors) Object.assign(errors, r.errors)
      else message.push(`VAT ${Number(f.vatRate)}%`)
    }
    if (Object.keys(errors).length) return s.fail(errors)
    s.done(message.length ? `Saved: ${message.join(' · ')}.` : 'Nothing has changed.', { overtimeRate: overtimeRateFor(companyId, today), effectiveFrom: today, vatRate: vatRateFor(companyId) })
  }
  return (
    <SectionCard title={`Overtime Pay & VAT — ${name}`} description="Hourly overtime rate in Ghana cedis and the company VAT percentage. Mock calculation for HR review; not production payroll." readOnly={readOnly} readOnlyReason={readOnly ? 'Editing needs Settings → Edit for this company.' : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={() => s.setConfirming(true)} onCancel={s.reset}>
      <div className="st-grid">
        <Field id="p-rate" label="Overtime rate (GH₵ per hour)" hint="Overtime pay = (overtime minutes ÷ 60) × this rate." error={s.errors.overtimeRate}>
          <input id="p-rate" type="number" min={0} step="0.01" className="sh-form-input" value={f.overtimeRate} disabled={readOnly} onChange={(e) => s.set('overtimeRate', e.target.value)} />
        </Field>
        <Field id="p-eff" label="Rate effective from" hint="Today or later. Earlier days keep the rate in force at the time." error={s.errors.effectiveFrom}>
          <input id="p-eff" type="date" className="sh-form-input" min={today} value={f.effectiveFrom} disabled={readOnly} onChange={(e) => s.set('effectiveFrom', e.target.value)} />
        </Field>
        <div className="st-field is-full">
          <span className="sh-form-label">Worked examples at {formatCedis(rate)} per hour</span>
          <ul className="st-examples">
            {examples.map((m) => <li key={m}>{formatOvertime(m)} overtime → <strong>{formatCedis(overtimePay(m, rate))}</strong></li>)}
          </ul>
        </div>
        <Field id="p-vat" label="VAT rate (%)" hint="A separate tax setting shown where relevant. It is not deducted from overtime pay." error={s.errors.vatRate}>
          <input id="p-vat" type="number" min={0} max={100} step="0.01" className="sh-form-input" value={f.vatRate} disabled={readOnly} onChange={(e) => s.set('vatRate', e.target.value)} />
        </Field>
        <Locked label="VAT on overtime" value="Not applied" hint="Until an approved payroll requirement defines how VAT applies." />
      </div>
      <VersionTable versions={overtimeRateVersions(companyId)} render={(v) => `${formatCedis(v.overtimeRate)} per hour`} />
      {s.confirming && (
        <ConfirmChange
          title={`Change ${name}'s overtime pay settings?`}
          lines={[
            ...(Number(f.overtimeRate) !== initial.overtimeRate ? [`Overtime rate: ${formatCedis(initial.overtimeRate)} → ${formatCedis(Number(f.overtimeRate))} per hour, from ${formatAccraDate(f.effectiveFrom)}`] : []),
            ...(Number(f.vatRate) !== initial.vatRate ? [`VAT: ${initial.vatRate}% → ${Number(f.vatRate)}% (not deducted from overtime)`] : []),
            'Recorded in the audit log.',
          ]}
          onConfirm={save}
          onCancel={() => s.setConfirming(false)}
        />
      )}
    </SectionCard>
  )
}

export function WorkingHoursSection({ user, defaultCompanyId }) {
  const companies = authorisedCompanies(user)
  const [companyId, setCompanyId] = useState(companies.some((c) => c.id === defaultCompanyId) ? defaultCompanyId : companies[0]?.id)
  if (!companyId) return <p className="sm-empty">No company access.</p>
  return (
    <>
      {companies.length > 1 && (
        <div className="st-company-tabs sm-tabs" role="tablist" aria-label="Company">
          {companies.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={companyId === c.id} className={`sm-tab${companyId === c.id ? ' is-active' : ''}`} onClick={() => setCompanyId(c.id)}>{companySettings(c.id)?.displayName ?? c.name}</button>
          ))}
        </div>
      )}
      <HoursForm key={companyId} companyId={companyId} user={user} />
      <PayForm key={`pay-${companyId}`} companyId={companyId} user={user} />
    </>
  )
}

/* ------------------------------------------------------------------ 5 */
export function MonitoringSection({ user }) {
  const s = useSection(monitoringSettings())
  const readOnly = !canEditSystemSettings(user)
  const f = s.form
  const shops = mockListAllShops().filter((x) => authorisedCompanies(user).some((c) => c.id === x.companyId))
  const labels = { locationProvider: 'Location services', defaultGeofenceRadius: 'Default geofence (m)', responseWindowMinutes: 'Response window (min)', faceRequired: 'Face verification', gpsRequired: 'GPS verification', smsEnabled: 'SMS verification', repeatedExceptionThreshold: 'Repeated-exception threshold' }
  const save = () => {
    const r = saveMonitoring(f, user)
    if (r.errors) return s.fail(r.errors)
    s.done('Monitoring settings saved. No SMS provider or scheduler was changed.', r.settings.monitoring)
  }
  return (
    <SectionCard title="Sales Representative Monitoring" description="Rules for the three random SMS verification checks per working day." readOnly={readOnly} readOnlyReason={readOnly ? SYSTEM_RO : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={() => s.setConfirming(true)} onCancel={s.reset}>
      <p className="hu-warning">
        Future SMS check times are generated only by a secure backend scheduler and are never shown here. Saving these
        settings does not change any real SMS provider or scheduler. A missed verification is never treated as absence
        or misconduct automatically.
      </p>
      <div className="st-grid">
        <Locked label="Random verification checks per working day" value={`${CHECKS_PER_SHIFT} checks`} hint="Current system rule." />
        <Field id="m-radius" label="Default shop geofence radius (metres)" hint="Applied to newly added shops (e.g. added during registration). Existing shops keep their own radius." error={s.errors.defaultGeofenceRadius}>
          <input id="m-radius" type="number" min={50} max={1000} className="sh-form-input" value={f.defaultGeofenceRadius} disabled={readOnly} onChange={(e) => s.set('defaultGeofenceRadius', e.target.value)} />
        </Field>
        <Field id="m-window" label="Verification response window (minutes)" applied={false} hint="Used by the backend scheduler in production." error={s.errors.responseWindowMinutes}>
          <input id="m-window" type="number" min={5} max={60} className="sh-form-input" value={f.responseWindowMinutes} disabled={readOnly} onChange={(e) => s.set('responseWindowMinutes', e.target.value)} />
        </Field>
        <Field id="m-repeat" label="Repeated-exception review threshold" hint="Exceptions in one day that flag an employee for HR review (alerts and notifications)." error={s.errors.repeatedExceptionThreshold}>
          <select id="m-repeat" className="sh-form-select" value={f.repeatedExceptionThreshold} disabled={readOnly} onChange={(e) => s.set('repeatedExceptionThreshold', Number(e.target.value))}>
            <option value={2}>2 of 3 checks</option>
            <option value={3}>3 of 3 checks</option>
          </select>
        </Field>
        <Field id="m-face" label="Face verification" applied={false}>
          <Toggle id="m-face" checked={f.faceRequired} disabled={readOnly} onChange={(v) => s.set('faceRequired', v)} label="Required on every check" />
        </Field>
        <Field id="m-gps" label="GPS verification" applied={false}>
          <Toggle id="m-gps" checked={f.gpsRequired} disabled={readOnly} onChange={(v) => s.set('gpsRequired', v)} label="Required on every check" />
        </Field>
        <Field id="m-sms" label="SMS verification" applied={false} hint="Recorded preference; the simulated history in this demo is unaffected.">
          <Toggle id="m-sms" checked={f.smsEnabled} disabled={readOnly} onChange={(v) => s.set('smsEnabled', v)} label="Enabled" />
        </Field>
        <Locked label="Missed verification" value="Exception for HR review — never automatic absence or discipline" />
        <Field id="m-geo" label="Location services (shop lookup and map)" hint={f.locationProvider === 'nominatim' ? 'Shop names and location text are sent to OpenStreetMap’s public service when HR searches; map tiles load from openstreetmap.org. Light, user-triggered use only. In production route this through the backend.' : 'Off: shop locations are not looked up automatically. HR can still enter coordinates.'} error={s.errors.locationProvider}>
          <select id="m-geo" className="sh-form-select" value={f.locationProvider ?? 'none'} disabled={readOnly} onChange={(e) => s.set('locationProvider', e.target.value)}>
            <option value="none">Off — not configured</option>
            <option value="nominatim">OpenStreetMap (Nominatim) — no API key</option>
          </select>
        </Field>
      </div>
      <div className="st-versions">
        <span className="sm-detail-label">Shop-specific geofences (Shop Directory)</span>
        <ul>{shops.map((x) => <li key={x.shopId}><strong>{x.shopName}</strong><span>{x.geofenceRadius} m</span></li>)}</ul>
      </div>
      {s.confirming && <ConfirmChange title="Change monitoring settings?" lines={[...changedLines(monitoringSettings(), f, labels), 'No real SMS provider or scheduler is changed.']} onConfirm={save} onCancel={() => s.setConfirming(false)} />}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ 6 */
export function NotificationSection({ user }) {
  const s = useSection(getSettings().notifications)
  const readOnly = !canEditSystemSettings(user)
  const f = s.form
  const update = (key, patch) => s.set(key, { ...f[key], ...patch })
  const save = () => {
    const r = saveNotificationPrefs(f, user)
    if (r.errors) return s.fail({ form: Object.values(r.errors)[0] })
    s.done('Notification preferences saved. They apply to notifications raised from now on.', r.settings.notifications)
  }
  return (
    <SectionCard title="Notification Settings" description="Which in-app notifications are raised, how severe they are and which roles see them. Demonstration only: no email, SMS or push messages are sent." readOnly={readOnly} readOnlyReason={readOnly ? SYSTEM_RO : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={save} onCancel={s.reset}>
      <div className="sm-table-wrap">
        <table className="sm-table st-notif-table">
          <thead><tr><th scope="col">Notification</th><th scope="col">Enabled</th><th scope="col">Severity</th></tr></thead>
          <tbody>
            {Object.entries(NOTIFICATION_GROUPS).map(([key, g]) => (
              <tr key={key}>
                <th scope="row" data-label="Notification">{g.label}</th>
                <td data-label="Enabled"><Toggle id={`n-${key}`} checked={f[key].enabled} disabled={readOnly} onChange={(v) => update(key, { enabled: v })} label={f[key].enabled ? 'On' : 'Off'} /></td>
                <td data-label="Severity">
                  <select className="sh-form-select st-small-select" value={f[key].severity} disabled={readOnly || !f[key].enabled} onChange={(e) => update(key, { severity: e.target.value })} aria-label={`${g.label} severity`}>
                    <option value="default">Default</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="at-sub" style={{ margin: 0 }}>Turning a type off stops new ones being raised; existing notifications and their history are kept.</p>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ 7 */
export function SecuritySection({ user }) {
  const s = useSection(securitySettings())
  const readOnly = !canEditSystemSettings(user)
  const f = s.form
  const labels = { sessionTimeoutMinutes: 'Session timeout (min)', loginAttemptLimit: 'Login attempt limit', passwordMinLength: 'Password minimum length', passwordRequireMixed: 'Mixed characters required' }
  const save = () => {
    const r = saveSecurity(f, user)
    if (r.errors) return s.fail(r.errors)
    s.done('Security preferences saved (demonstration).', r.settings.security)
  }
  return (
    <SectionCard title="Security Settings" description="Access and account policy for the private HR portal." readOnly={readOnly} readOnlyReason={readOnly ? SYSTEM_RO : null} dirty={s.dirty} flash={s.flash} error={s.errors.form} onSave={() => s.setConfirming(true)} onCancel={s.reset}>
      <p className="hu-warning" role="note">
        This prototype has no real authentication, MFA, session management or API authorisation, and is not secure.
        In production all of these must be implemented and enforced by the backend.
      </p>
      <div className="st-status-list">
        <StatusRow label="HR portal access" value="Private portal · demo sign-in" tone="info" detail="Separate from the employee portal." />
        <StatusRow label="Public HR registration" value="Disabled" tone="ok" detail="Locked. There is one HR account (HR Manager); no others can be created." />
        <StatusRow label="MFA policy" value="Not implemented" tone="warn" detail="Required in production." />
        <StatusRow label="Permission enforcement" value="Frontend checks (demo)" tone="warn" detail="Backend enforcement on every API is required in production." />
        <StatusRow label="Company data separation" value="Applied in every module (frontend)" tone="info" detail="Must also be enforced by the backend." />
      </div>
      <div className="st-grid">
        <Field id="s-timeout" label="Session timeout (minutes)" hint="Applied to the demo session: it expires this long after sign-in." error={s.errors.sessionTimeoutMinutes}>
          <input id="s-timeout" type="number" min={5} max={480} className="sh-form-input" value={f.sessionTimeoutMinutes} disabled={readOnly} onChange={(e) => s.set('sessionTimeoutMinutes', e.target.value)} />
        </Field>
        <Field id="s-attempts" label="Login attempt limit" applied={false} hint="There are no passwords in this demo." error={s.errors.loginAttemptLimit}>
          <input id="s-attempts" type="number" min={3} max={10} className="sh-form-input" value={f.loginAttemptLimit} disabled={readOnly} onChange={(e) => s.set('loginAttemptLimit', e.target.value)} />
        </Field>
        <Field id="s-pw" label="Password policy: minimum length" applied={false} hint="Demonstration of the policy production should enforce." error={s.errors.passwordMinLength}>
          <input id="s-pw" type="number" min={12} max={64} className="sh-form-input" value={f.passwordMinLength} disabled={readOnly} onChange={(e) => s.set('passwordMinLength', e.target.value)} />
        </Field>
        <Field id="s-mixed" label="Password policy: character mix" applied={false}>
          <Toggle id="s-mixed" checked={f.passwordRequireMixed} disabled={readOnly} onChange={(v) => s.set('passwordRequireMixed', v)} label="Require upper/lower case, a number and a symbol" />
        </Field>
      </div>
      {s.confirming && <ConfirmChange title="Change security preferences?" lines={[...changedLines(securitySettings(), f, labels), 'Demonstration only; production security must be enforced by the backend.']} onConfirm={save} onCancel={() => s.setConfirming(false)} />}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ 8 */
export function DataSection({ user, onNavigate }) {
  const [version, setVersion] = useState(0)
  const [flash, setFlash] = useState('')
  const companies = authorisedCompanies(user).map((c) => c.id)
  const today = accraTodayKey()
  const stats = useMemo(() => {
    const roster = listAttendanceRoster(null).filter((e) => companies.includes(e.companyId))
    const ids = new Set(roster.map((e) => e.employeeId))
    const periodRecords = listAttendanceRecords({ companyId: companies.length === 1 ? companies[0] : null, dates: elapsedPeriodDateKeys(periodForDateKey(today), today) }).filter((r) => companies.includes(r.companyId))
    const manual = periodRecords.filter((r) => recordOrigin(r)?.kind === 'manual')
    return {
      roster,
      employees: roster.length,
      digitalEvents: mockGetAllEvents().filter((e) => ids.has(e.staffId)).length,
      periodRecords,
      attended: periodRecords.filter((r) => r.hasAttendance).length,
      manual,
      shops: mockListAllShops().filter((s) => companies.includes(s.companyId)).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, companies.join(',')])
  const lastExport = getSettings().data.lastConfigExportAt
  const scope = companies.length > 1 ? 'all-companies' : companies[0]

  const logExport = (what, count) => {
    recordAuditEvent({ action: `${what} exported`, category: 'System Settings', source: 'Data Management', actor: { name: user.name, role: user.role }, companyIds: companies.length > 1 ? [] : companies, affected: what, description: `${count} rows exported to CSV (mock data).` })
    setFlash(`${what} exported (${count} rows).`)
    setVersion((v) => v + 1)
  }
  const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')

  const exportEmployees = () => {
    download(`employees-${scope}-${today}.csv`, csv([['Employee ID', 'Name', 'Company', 'Position', 'Shop', 'Phone'], ...stats.roster.map((e) => [e.employeeId, e.fullName, e.companyName, e.position, e.shopId ?? '', e.phone ?? ''])]))
    logExport('Employee data', stats.roster.length)
  }
  const exportAttendance = () => {
    download(`attendance-${scope}-period-${periodForDateKey(today).key}.csv`, attendanceRecordsToCsv(stats.periodRecords))
    logExport('Attendance data', stats.periodRecords.length)
  }
  const exportManual = () => {
    download(`manual-attendance-${scope}-period-${periodForDateKey(today).key}.csv`, attendanceRecordsToCsv(stats.manual))
    logExport('Manual attendance entries', stats.manual.length)
  }
  const exportConfig = () => {
    const r = exportConfiguration(user)
    if (r.error) { setFlash(r.error); return }
    download(`workforce-pro-configuration-${today}.json`, r.json, 'application/json')
    setFlash('Configuration exported (demo file, not a backup).')
    setVersion((v) => v + 1)
  }

  return (
    <SectionCard title="Data Management" description="What mock data this browser holds, with demonstration exports. Nothing here deletes data." flash={flash}>
      <p className="hu-warning" role="note">Data source: mock data stored in this browser. No server database is connected and no real backups exist.</p>
      <div className="st-stat-grid">
        {[
          ['Employees', stats.employees],
          ['Attendance records (current period)', stats.periodRecords.length],
          ['  of which attended', stats.attended],
          ['Digital check-in events', stats.digitalEvents],
          ['Manual entries (current period)', stats.manual.length],
          ['Shops', stats.shops],
        ].map(([l, v]) => <div className="sm-stat" key={l}><span className="sm-stat-label">{l.trim()}</span><span className="sm-stat-value">{v}</span></div>)}
      </div>
      <div className="st-status-list">
        <StatusRow label="Last configuration export (demo)" value={lastExport ? formatAccraDateTime(lastExport) : 'Never'} tone="muted" detail="A downloaded JSON file, not a database backup." />
        <StatusRow label="Data source" value="Browser storage (mock)" tone="warn" detail="Clearing site data in the browser removes it." />
      </div>
      <div className="st-actions">
        <button type="button" className="btn btn-secondary at-btn" onClick={exportEmployees} disabled={!can(user, 'employees', 'export')} title={can(user, 'employees', 'export') ? undefined : 'Needs Employees → Export'}>Export employees (CSV)</button>
        <button type="button" className="btn btn-secondary at-btn" onClick={exportAttendance} disabled={!can(user, 'attendance', 'export')} title={can(user, 'attendance', 'export') ? undefined : 'Needs Attendance → Export'}>Export attendance (CSV)</button>
        <button type="button" className="btn btn-secondary at-btn" onClick={exportManual} disabled={!can(user, 'attendance', 'export')}>Export manual entries (CSV)</button>
        <button type="button" className="btn btn-secondary at-btn" onClick={exportConfig}>Export configuration (JSON)</button>
      </div>
      <div className="st-versions">
        <span className="sm-detail-label">Manual attendance</span>
        <p className="at-sub" style={{ margin: 0 }}>
          Attendance from paper notebooks is entered in Attendance → Manual Entry and appears in reports as Manual Entry,
          alongside System Recorded attendance.
        </p>
        {can(user, 'attendance', 'view') && <button type="button" className="hr-link" style={{ alignSelf: 'flex-start' }} onClick={() => onNavigate?.('attendance')}>Open Attendance →</button>}
      </div>
    </SectionCard>
  )
}

