import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { authorisedCompanies, can } from '../../services/permissionsService'
import {
  addDisplay,
  listDisplays,
  newSetupLink,
  setupUrl,
  setWorkplaceCodeRequired,
  switchOffDisplay,
  workplaceCodeRequired,
} from '../../services/workplaceDisplayService'
import { formatAccraDateTime } from '../../utils/accraTime'
import { ConfirmChange, Field, SectionCard, Toggle } from './SettingsKit'

/**
 * Workplace QR displays: a tablet at each workplace shows a code that changes
 * every 30 seconds. Office staff scan it with their phone to check in or out,
 * which proves they are at work. Field staff keep their SMS and GPS checks.
 */
export default function WorkplaceDisplaysSection({ user, defaultCompanyId }) {
  const companies = authorisedCompanies(user)
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id)
  const [name, setName] = useState('')
  const [errors, setErrors] = useState({})
  const [flash, setFlash] = useState('')
  const [link, setLink] = useState(null)
  const [switchingOff, setSwitchingOff] = useState(null)
  const [busy, setBusy] = useState(false)
  const [, setVersion] = useState(0)
  const readOnly = !can(user, 'settings', 'edit')
  const displays = listDisplays(companyId)
  const required = workplaceCodeRequired(companyId)
  const companyName = companies.find((c) => c.id === companyId)?.name ?? ''

  const run = async (action, onDone) => {
    setBusy(true)
    setErrors({})
    setFlash('')
    try {
      const result = await action()
      if (result.errors) { setErrors(result.errors); return }
      onDone(result)
      setVersion((v) => v + 1)
    } finally {
      setBusy(false)
    }
  }

  const add = (e) => {
    e.preventDefault()
    run(() => addDisplay(companyId, name), (r) => {
      setLink({ name: name.trim(), token: r.setupToken, expiresAt: r.expiresAt })
      setName('')
    })
  }

  const relink = (display) => run(() => newSetupLink(display.id), (r) => setLink({ name: display.name, token: r.setupToken, expiresAt: r.expiresAt }))

  const switchOff = () => {
    const display = switchingOff
    setSwitchingOff(null)
    run(() => switchOffDisplay(display.id), () => {
      if (link?.name === display.name) setLink(null)
      setFlash(`"${display.name}" is switched off. Its QR codes no longer work.`)
    })
  }

  const toggleRequired = (next) => run(() => setWorkplaceCodeRequired(companyId, next), () => {
    setFlash(next
      ? `Office staff at ${companyName} now have to scan a workplace QR code to check in or out.`
      : `Office staff at ${companyName} can check in without scanning a workplace QR code.`)
  })

  return (
    <SectionCard
      title="Workplace displays"
      description="A tablet at each workplace shows a QR code that changes every 30 seconds. Staff scan it with their phone before checking in, which proves they are at work. Sales reps and merchandisers are not affected; their SMS and GPS checks continue."
      readOnly={readOnly}
      readOnlyReason={readOnly ? 'Managing displays needs Settings → Edit.' : null}
      flash={flash}
      error={errors.form}
    >
      <div className="st-grid">
        {companies.length > 1 && (
          <Field id="wd-company" label="Company">
            <select id="wd-company" className="sh-form-select" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setLink(null); setErrors({}) }}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field id="wd-required" label="Require the workplace QR code" hint="Turn this on once a display is set up, or nobody in the office can check in." full>
          <Toggle id="wd-required" checked={required} disabled={readOnly || busy} onChange={toggleRequired} label={required ? 'Office staff must scan the code' : 'Not required'} />
        </Field>
      </div>

      {!readOnly && (
        <form className="st-grid hol-form" onSubmit={add} noValidate>
          <Field id="wd-name" label="New display" hint='Name it after where it stands, for example "Tema warehouse entrance".' error={errors.name}>
            <input id="wd-name" className="sh-form-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="st-field hol-add">
            <button type="submit" className="btn btn-primary at-btn" disabled={busy}>Add display</button>
          </div>
        </form>
      )}

      {link && <SetupLink link={link} onClose={() => setLink(null)} />}

      <h4 className="sm-section-title hol-title">Displays for {companyName}</h4>
      {displays.length === 0 ? (
        <p className="sm-empty">No displays yet.</p>
      ) : (
        <ul className="hol-list">
          {displays.map((d) => (
            <li key={d.id} className={`hol-item${d.status === 'active' ? '' : ' is-past'}`}>
              <span className="hol-name">{d.name}</span>
              <span className="hol-date">
                {d.status !== 'active' ? 'Switched off' : d.pairedAt ? `Set up ${formatAccraDateTime(d.pairedAt)}` : 'Waiting for a device'}
              </span>
              <span className={`at-badge at-tone-${d.status !== 'active' ? 'muted' : d.pairedAt ? 'ok' : 'warn'}`}>
                {d.status !== 'active' ? 'Off' : d.pairedAt ? 'Working' : 'Not set up'}
              </span>
              {d.status === 'active' && !readOnly ? (
                <span className="wd-actions">
                  <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => relink(d)}>{d.pairedAt ? 'Move to another device' : 'New setup link'}</button>
                  <button type="button" className="sm-actions-btn" disabled={busy} onClick={() => setSwitchingOff(d)}>Switch off</button>
                </span>
              ) : <span className="hol-spacer" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}

      {switchingOff && (
        <ConfirmChange
          title={`Switch off "${switchingOff.name}"?`}
          lines={['Its QR codes stop working straight away.', required ? 'If it is the only display, office staff cannot check in until another one is set up.' : 'Past check-ins keep the display name.']}
          confirmLabel="Switch off"
          onConfirm={switchOff}
          onCancel={() => setSwitchingOff(null)}
        />
      )}
    </SectionCard>
  )
}

/** The one-time link, as a QR code the tablet can scan and as text to copy. */
function SetupLink({ link, onClose }) {
  const url = setupUrl(link.token)
  const [image, setImage] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setImage).catch(() => setImage(''))
  }, [url])
  const copy = () => navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {})

  return (
    <div className="st-status-list wd-setup" role="status">
      <div>
        <h4 className="sm-section-title">Set up &ldquo;{link.name}&rdquo; on its tablet</h4>
        <p className="sm-muted">
          On the tablet, scan this code with the camera or open the link in the browser. It works once and runs out at{' '}
          {formatAccraDateTime(link.expiresAt)}. Leave the tablet on that page.
        </p>
        <p className="wd-setup-url"><code>{url}</code></p>
        <div className="sm-alert-actions">
          <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
      {image && <img className="wd-setup-qr" src={image} alt={`Setup QR code for ${link.name}`} width={220} height={220} />}
    </div>
  )
}
