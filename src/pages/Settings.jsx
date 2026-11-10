import { useState } from 'react'
import { can } from '../services/permissionsService'
import {
  AttendanceSection,
  CompanySection,
  DataSection,
  GeneralSection,
  MonitoringSection,
  NotificationSection,
  SecuritySection,
  WorkingHoursSection,
} from '../components/settings/SettingsSections'
import HolidaysSection from '../components/settings/HolidaysSection'
import AuditLogs from './AuditLogs'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/attendance.css'
import '../styles/notifications.css'
import '../styles/hr-users.css'
import '../styles/settings.css'

const SECTIONS = [
  { id: 'general', label: 'General Settings', hint: 'Name, logo, formats' },
  { id: 'company', label: 'Company Settings', hint: 'Profile per company' },
  { id: 'attendance', label: 'Attendance Settings', hint: 'Cycle and rules' },
  { id: 'hours', label: 'Working Hours & Timezone', hint: 'Default hours' },
  { id: 'holidays', label: 'Holidays', hint: 'Public and HR-set holidays' },
  { id: 'monitoring', label: 'Sales Rep Monitoring', hint: 'Verification rules' },
  { id: 'notifications', label: 'Notification Settings', hint: 'Alerts and roles' },
  { id: 'security', label: 'Security Settings', hint: 'Access policy' },
  { id: 'data', label: 'Data Management', hint: 'Counts and exports' },
  { id: 'audit', label: 'Audit Logs', hint: 'Read-only history', module: 'audit-logs' },
]

/**
 * Settings & Audit Logs. Every section reads from and saves to the shared
 * settings service; edit rights are checked again inside that service.
 */
export default function Settings({ user, company, initialSection = 'general', onNavigate, onChanged }) {
  const visible = SECTIONS.filter((s) => (s.module ? can(user, s.module, 'view') : true))
  const [section, setSection] = useState(visible.some((s) => s.id === initialSection) ? initialSection : visible[0].id)
  const props = { user, onChanged, onNavigate, defaultCompanyId: company?.id }

  return (
    <div className="sm-page st-page">
      <div className="sm-head">
        <div>
          <h2>Settings</h2>
          <p>Configuration for the HR portal.</p>
        </div>
      </div>
      <div className="st-layout">
        <nav className="st-nav" aria-label="Settings sections">
          <label className="sr-only" htmlFor="st-nav-select">Settings section</label>
          <select id="st-nav-select" className="sh-form-select st-nav-select" value={section} onChange={(e) => setSection(e.target.value)}>
            {visible.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.label}</option>)}
          </select>
          <ol className="st-nav-list">
            {visible.map((s, i) => (
              <li key={s.id}>
                <button type="button" className={`st-nav-item${section === s.id ? ' is-active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
                  <span className="st-nav-num">{i + 1}</span>
                  <span className="st-nav-text">{s.label}<span>{s.hint}</span></span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="st-content">
          {section === 'general' && <GeneralSection {...props} />}
          {section === 'company' && <CompanySection {...props} />}
          {section === 'attendance' && <AttendanceSection {...props} />}
          {section === 'hours' && <WorkingHoursSection {...props} />}
          {section === 'holidays' && <HolidaysSection {...props} />}
          {section === 'monitoring' && <MonitoringSection {...props} />}
          {section === 'notifications' && <NotificationSection {...props} />}
          {section === 'security' && <SecuritySection {...props} />}
          {section === 'data' && <DataSection {...props} />}
          {section === 'audit' && <AuditLogs user={user} />}
        </div>
      </div>
    </div>
  )
}
