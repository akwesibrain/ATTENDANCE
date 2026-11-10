import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { COMPANIES } from '../constants/companies'
import { listPayPeriods, payPeriodDates } from '../utils/payPeriod'
import { holidayForKey } from '../utils/attendanceRules'
import { accraTodayKey, formatAccraDate, formatAccraTime } from '../utils/accraTime'
import { getPaymentMethodLabel } from '../constants/paymentMethods'
import { authorisedCompanies, can } from '../constants/hrUser'
import { signOut } from '../services/permissionsService'
import { refresh as reloadTables, useCacheVersion } from '../services/backend/cache'
import { AccessDenied, HrGate } from '../components/access/AccessScreens'
import { overtimeForRecord, formatCedis } from '../services/overtimeService'
import { ATTENDANCE_STATUS } from '../constants/attendanceLabels'
import HrAssistant from '../components/assistant/HrAssistant'
import { companySettings, generalSettings } from '../services/settingsService'
import { listEmployees } from '../services/registrationService'
import {
  listAttendanceRecords,
  listAttendanceRoster,
  summariseAttendance,
} from '../services/attendanceRecordsService'
import { listNotifications, unreadCount } from '../services/notificationsService'
import EmployeeDirectory from '../components/hr/EmployeeDirectory'
import AssignShopModal from '../components/hr/AssignShopModal'
import { StatusBadge } from '../components/attendance/AttendanceBadges'
import { SectionSkeleton } from '../components/common/Skeletons'
import useScrollReveal from '../hooks/useScrollReveal'
// All HR styles load up front in a fixed order (theme last), so lazily loaded
// pages never flash unstyled or override the theme.
import '../styles/hr.css'
import '../styles/employee-directory.css'
import '../styles/attendance.css'
import '../styles/sales-monitoring.css'
import '../styles/shifts.css'
import '../styles/notifications.css'
import '../styles/hr-users.css'
import '../styles/charts.css'
import '../styles/overtime.css'
import '../styles/settings.css'
import '../styles/shops.css'
import '../styles/assistant.css'
import '../styles/hr-neumorphism.css'

// HR pages are downloaded when first opened (and prefetched when the browser
// is idle), keeping the first load of the portal small.
const loaders = {
  attendance: () => import('./AttendanceManagement'),
  sales: () => import('./SalesMonitoring'),
  overtime: () => import('./Overtime'),
  settings: () => import('./Settings'),
  audit: () => import('./AuditLogs'),
  notifications: () => import('./NotificationsCenter'),
}
const AttendanceManagement = lazy(loaders.attendance)
const SalesMonitoring = lazy(loaders.sales)
const Overtime = lazy(loaders.overtime)
const Settings = lazy(loaders.settings)
const AuditLogs = lazy(loaders.audit)
const NotificationsCenter = lazy(loaders.notifications)

function prefetchHrPages() {
  const run = () => Object.values(loaders).forEach((load) => load().catch(() => {}))
  if (typeof window === 'undefined') return undefined
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(run, 1500)
  return () => clearTimeout(id)
}

// `module` is the permission each page needs (services/permissionsService.js).
// Pages with a `group` are not in the sidebar: they open as tabs inside that
// group's sidebar item (e.g. Overtime is a tab of Reports, Audit Logs of Settings). Notifications is
// opened from the bell in the top bar. Permissions are still checked per page.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', module: 'dashboard' },
  { id: 'employees', label: 'Employees', icon: 'users', module: 'employees' },
  { id: 'attendance', label: 'Attendance', icon: 'clock', module: 'attendance' },
  { id: 'sales-monitoring', label: 'Sales Reps', icon: 'mappin', module: 'sales-monitoring' },
  { id: 'reports', label: 'Reports', icon: 'report', module: 'reports', group: 'reports' },
  { id: 'overtime', label: 'Overtime', icon: 'clock', module: 'reports', group: 'reports' },
  { id: 'settings', label: 'Settings', icon: 'gear', module: 'settings', group: 'settings' },
  { id: 'audit-logs', label: 'Audit Logs', icon: 'list', module: 'audit-logs', group: 'settings' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', module: 'notifications', hidden: true },
]
const GROUP_LABELS = { reports: { label: 'Reports', icon: 'report' }, settings: { label: 'Settings', icon: 'gear' } }

function navFromHash() {
  if (typeof window === 'undefined' || !window.location) return null
  const id = (window.location.hash ?? '').replace('#', '')
  return NAV.some((n) => n.id === id) ? id : null
}

function formatPeriodDate(date) {
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const TIER_LABELS = {
  perfect: 'Perfect',
  excellent: 'Excellent',
  good: 'Good',
  'needs-attention': 'Needs Attention',
}

/** Live clock that re-renders every second. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function LiveClock() {
  const now = useNow()
  return (
    <span className="hr-clock" role="timer" aria-live="off">
      <Icon name="clock" size={16} />
      <span className="hr-clock-time">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </span>
  )
}

function Icon({ name, size = 20 }) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2" />
      </>
    ),
    mappin: (
      <>
        <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    report: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
      </>
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5M12 15V3" />
      </>
    ),
    print: (
      <>
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    archive: (
      <>
        <rect x="2" y="3" width="20" height="5" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
      </>
    ),
    building: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="1" />
        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

/** HR portal entry: nothing below renders without a complete sign-in. */
export default function HrDashboard({ onBack }) {
  return (
    <HrGate onExit={onBack}>
      {(user) => <HrDashboardContent key={user.id} user={user} onBack={onBack} />}
    </HrGate>
  )
}

/** Notifications are raised on the server just after a change is saved. */
const NOTIFICATIONS_SETTLE_MS = 2500
const reloadNotificationsSoon = () => setTimeout(() => reloadTables('notifications', 'notification_history'), NOTIFICATIONS_SETTLE_MS)

function HrDashboardContent({ onBack, user }) {
  const contentRef = useRef(null)
  useScrollReveal(contentRef)
  // Fetch the other HR pages in the background once the dashboard is idle.
  useEffect(() => prefetchHrPages(), [])
  const [activeNav, setActiveNavState] = useState(() => {
    const landing = generalSettings().landingPage
    const landingItem = NAV.find((n) => n.id === landing)
    return navFromHash() ?? (landingItem && can(user, landingItem.module, 'view') ? landing : 'dashboard')
  })
  // Bumped when settings change so the brand and company names refresh.
  const [, setSettingsVersion] = useState(0)
  // Pages are addressable as /hr#<page>, so a restricted page can be opened by
  // link; the permission check below still blocks it.
  const setActiveNav = (nav) => {
    setActiveNavState(nav)
    try { window.history.replaceState(null, '', `#${nav}`) } catch { /* ignore */ }
  }
  useEffect(() => {
    const onHash = () => { const id = navFromHash(); if (id) setActiveNavState(id) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const myCompanies = authorisedCompanies(user)
  // Users with more than one company start on the combined overview.
  const [companyId, setCompanyId] = useState(myCompanies.length > 1 ? '__all' : myCompanies[0]?.id ?? COMPANIES[0].id)
  // The reporting month (pay period) selected in the Reports view.
  const [reportPeriodKey, setReportPeriodKey] = useState(() => listPayPeriods(1)[0].key)
  // Reports: per-employee summary, or one row per attendance day.
  const [reportView, setReportView] = useState('summary')
  // The employee being assigned a shop (HR action), or null.
  const [assigningEmployee, setAssigningEmployee] = useState(null)
  const [assignRefreshKey, setAssignRefreshKey] = useState(0)
  // Bumped when attendance is corrected so every view re-reads the records.
  const [attendanceVersion, setAttendanceVersion] = useState(0)
  // Opens Attendance on one employee's history: { employeeId, date, companyId, token }.
  const [attendanceFocus, setAttendanceFocus] = useState(null)
  const openAttendanceHistory = (focus) => {
    if (focus.companyId && focus.companyId !== companyId) setCompanyId(focus.companyId)
    setAttendanceFocus({ ...focus, token: Date.now() })
    setActiveNav('attendance')
  }
  const goTo = (nav) => {
    setAttendanceFocus(null)
    setActiveNav(nav)
  }
  // Unread notifications for the signed-in HR user (top-bar bell).
  const [unread, setUnread] = useState(0)
  const refreshUnread = () => setUnread(can(user, 'notifications', 'view') ? unreadCount(user) : 0)

  // Every view re-reads when new data arrives, from this browser or the server.
  const dataVersion = useCacheVersion()
  useEffect(() => {
    refreshUnread()
    setAttendanceVersion((v) => v + 1)
    setAssignRefreshKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // The company switcher can only choose among the user's own companies.
  const baseCompany = myCompanies.find((c) => c.id === companyId) ?? myCompanies[0] ?? COMPANIES[0]
  // Display name and logo come from Company Settings; IDs and records are unchanged.
  const companyProfile = companySettings(baseCompany.id)
  const profileName = companyProfile?.displayName
  const profileLogo = companyProfile?.logo
  const company = useMemo(
    () => ({ ...baseCompany, name: profileName || baseCompany.name, logo: profileLogo || baseCompany.logo }),
    [baseCompany, profileName, profileLogo],
  )
  const general = generalSettings()
  // Combined overview: only for users authorised for more than one company.
  const isCombined = companyId === '__all' && myCompanies.length > 1
  const allowedIds = myCompanies.map((c) => c.id)
  const nameOf = (id) => companySettings(id)?.displayName || COMPANIES.find((c) => c.id === id)?.name || id
  // What pages that support "all my companies" receive. An empty id means all
  // of the user's companies; their own filters still only narrow that scope.
  const scopeCompany = useMemo(
    () => (isCombined ? { id: '', name: 'All companies', logo: null } : company),
    [isCombined, company],
  )
  const allowedNav = NAV.filter((n) => can(user, n.module, 'view'))
  // Sidebar: ungrouped pages, plus one entry per group (opens its first allowed page).
  const visibleNav = []
  for (const n of allowedNav) {
    if (n.hidden) continue
    if (!n.group) visibleNav.push(n)
    else if (!visibleNav.some((v) => v.id === n.group)) visibleNav.push({ ...GROUP_LABELS[n.group], id: n.group, target: n.id })
  }
  const navItem = NAV.find((n) => n.id === activeNav)
  const groupTabs = navItem?.group ? allowedNav.filter((n) => n.group === navItem.group) : []
  const permitted = Boolean(navItem) && can(user, navItem.module, 'view') && myCompanies.length > 0
  const today = accraTodayKey()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => listEmployees(), [assignRefreshKey])

  const companyEmployees = useMemo(
    () => employees.filter((e) => e.companyName === company.name),
    [employees, company],
  )

  // Today's attendance records from the shared attendance service — the same
  // records the Attendance module shows (rules, leave and corrections applied).
  const todayRecords = useMemo(
    () => listAttendanceRecords({ companyId: isCombined ? null : company.id, dates: [today] })
      .filter((r) => allowedIds.includes(r.companyId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCombined, company.id, allowedIds.join(','), today, assignRefreshKey, attendanceVersion, activeNav],
  )

  // Per-company figures for the combined overview (each company kept separate).
  const companyBreakdown = useMemo(() => {
    if (!isCombined) return []
    const open = can(user, 'notifications', 'view')
      ? listNotifications(user).filter((n) => ['new', 'under-review'].includes(n.status))
      : []
    return myCompanies.map((c) => {
      const recs = todayRecords.filter((r) => r.companyId === c.id)
      const sum = summariseAttendance(recs)
      const due = sum.present + sum.absent
      return {
        id: c.id,
        name: nameOf(c.id),
        total: recs.length,
        present: sum.present,
        absent: sum.absent,
        late: sum.late,
        onLeave: sum.onLeave,
        rate: due ? (sum.present / due) * 100 : null,
        openExceptions: open.filter((n) => n.companyId === c.id).length,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCombined, todayRecords, unread])

  const stats = useMemo(() => {
    const summary = summariseAttendance(todayRecords)
    return {
      total: todayRecords.length,
      present: summary.present,
      absent: summary.absent,
      late: summary.late,
    }
  }, [todayRecords])

  // Today's register: attended first (on time, then late), then absent, then
  // everyone else — so who needs attention is easy to find.
  const todayRows = useMemo(() => {
    const rank = (r) => (r.hasAttendance ? (r.isLate ? 1 : 0) : r.status === 'absent' ? 2 : 3)
    return todayRecords
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName))
  }, [todayRecords])

  /* ---------- Monthly report (pay period: 26th to 25th) ---------- */

  const reportPeriods = useMemo(() => listPayPeriods(12), [])
  const reportPeriod = useMemo(
    () => reportPeriods.find((p) => p.key === reportPeriodKey) ?? reportPeriods[0],
    [reportPeriods, reportPeriodKey],
  )

  // One report row per employee for the period, from the shared attendance
  // records: working days elapsed, present, late, absent, leave, overtime
  // (hours worked on rest days / holidays), holidays, rate and a tier.
  // Future dates, rest days, holidays and approved leave are never absences.
  // One load of the period's records (manual and system-recorded together;
  // one record per employee per day, future dates excluded).
  const reportRecords = useMemo(
    () => (isCombined ? [] : listAttendanceRecords({ companyId: company.id, dates: payPeriodDates(reportPeriod) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCombined, company.id, reportPeriod, attendanceVersion, assignRefreshKey],
  )

  const reportRows = useMemo(() => {
    const dates = payPeriodDates(reportPeriod)
    const holidays = dates.filter((d) => holidayForKey(d)).length
    const records = reportRecords
    return listAttendanceRoster(company.id).map((emp) => {
      const own = records.filter((r) => r.employeeId === emp.employeeId)
      const scheduled = own.filter((r) => r.workday)
      const present = scheduled.filter((r) => r.hasAttendance).length
      const late = scheduled.filter((r) => r.isLate).length
      const absent = scheduled.filter((r) => r.status === 'absent').length
      const leave = scheduled.filter((r) => r.status === 'on-leave').length
      const unknown = scheduled.filter((r) => r.status === 'unknown').length
      const workingDays = present + absent + leave + unknown
      // Same calculation as the Overtime page: all time worked on Saturdays,
      // Sundays and holidays, plus time after the overtime start on weekdays,
      // added together into one overtime total.
      const ot = own.map(overtimeForRecord).filter((o) => o.status === 'counted')
      const overtimeMinutes = ot.reduce((sum, o) => sum + o.minutes, 0)
      const overtimePay = Math.round((ot.reduce((sum, o) => sum + o.minutes * o.rate, 0) / 60) * 100) / 100
      const workingHours = Math.round((own.reduce((sum, r) => sum + (r.workingMinutes ?? 0), 0) / 60) * 100) / 100
      const due = present + absent
      const rate = due ? (present / due) * 100 : 0
      let tier = 'needs-attention'
      if (!due) tier = 'good'
      else if (rate >= 99) tier = 'perfect'
      else if (rate >= 95) tier = 'excellent'
      else if (rate >= 90) tier = 'good'
      return {
        emp: {
          staffId: emp.employeeId,
          fullName: emp.fullName,
          position: emp.position,
          paymentMethod: emp.paymentMethod,
          faceImage: emp.photo,
        },
        workingDays,
        present,
        late,
        absent,
        leave,
        overtime: Math.round((overtimeMinutes / 60) * 100) / 100,
        overtimePay,
        workingHours,
        holidays,
        rate,
        due,
        tier,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id, reportPeriod, reportRecords])

  // Daily records view: every day with attendance, absence, leave or an
  // incomplete record. Manual and system-recorded days are treated the same.
  const reportDetail = useMemo(
    () => reportRecords
      .filter((r) => r.hasAttendance || ['absent', 'on-leave', 'incomplete'].includes(r.status))
      .map((r) => ({ r, ot: overtimeForRecord(r) }))
      .sort((a, b) => a.r.fullName.localeCompare(b.r.fullName) || a.r.date.localeCompare(b.r.date)),
    [reportRecords],
  )

  // Download the current report as a CSV file.
  const downloadReport = () => {
    if (reportView === 'detail') {
      const head = ['Date', 'Employee Name', 'Employee ID', 'Position', 'Clock-In', 'Clock-Out', 'Status', 'Working Hours', 'Overtime (min)', 'Overtime Pay (GH₵)']
      const body = reportDetail.map(({ r, ot }) => [
        r.date, r.fullName, r.employeeId, r.position,
        r.clockInUnknown ? 'Unknown' : r.clockIn ? formatAccraTime(r.clockIn) : '',
        r.clockOutUnknown ? 'Unknown' : r.clockOut ? formatAccraTime(r.clockOut) : '',
        ATTENDANCE_STATUS[r.status]?.label ?? r.status,
        r.workingMinutes ? (r.workingMinutes / 60).toFixed(2) : '',
        ot.status === 'counted' ? ot.minutes : '',
        ot.status === 'counted' ? ot.pay.toFixed(2) : '',
      ])
      const text = [head, ...body].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `attendance-daily-records-${company.id}-${reportPeriod.key}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return
    }
    const header = ['#', 'Employee Name', 'Employee ID', 'Position', 'Payment Method', 'Working Days', 'Present', 'Late', 'Absent', 'On Leave', 'Working Hours', 'Overtime (hrs)', 'Overtime Pay (GH₵)', 'Holidays', 'Attendance Rate', 'Status']
    const lines = reportRows.map((r, i) => [
      i + 1,
      r.emp.fullName,
      r.emp.staffId,
      r.emp.position,
      getPaymentMethodLabel(r.emp.paymentMethod),
      r.workingDays,
      r.present,
      r.late,
      r.absent,
      r.leave,
      r.workingHours,
      r.overtime,
      r.overtimePay.toFixed(2),
      r.holidays,
      r.due ? `${r.rate.toFixed(1)}%` : '—',
      TIER_LABELS[r.tier],
    ])
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-report-${company.id}-${reportPeriod.key}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="hr-layout">
      {/* Sidebar */}
      <aside className="hr-sidebar">
        <div className="hr-brand">
          {general.logo ? (
            <img className="hr-brand-logo" src={general.logo} alt="" />
          ) : (
            <span className="hr-brand-mark" aria-hidden="true">
              <Icon name="building" size={22} />
            </span>
          )}
          <span className="hr-brand-text">
            {general.systemName}
            <span>Manage · Track · Grow</span>
          </span>
        </div>

        <nav className="hr-nav" aria-label="HR sections">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`hr-nav-item ${activeNav === item.id || navItem?.group === item.id ? 'is-active' : ''}`}
              onClick={() => goTo(item.target ?? item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="hr-sidebar-footer">
          {isCombined ? (
            <span className="hr-brand-mark" aria-hidden="true">
              <Icon name="building" size={20} />
            </span>
          ) : company.logo ? (
            <img
              className={`hr-footer-logo hr-footer-logo-${company.id}`}
              src={company.logo}
              alt={`${company.name} logo`}
            />
          ) : (
            <span className="hr-brand-mark" aria-hidden="true">
              <Icon name="building" size={20} />
            </span>
          )}
          <span>
            {isCombined ? myCompanies.map((c) => nameOf(c.id)).join(' & ') : company.name}
            <span className="hr-footer-sub">Admin Portal</span>
          </span>
        </div>
      </aside>

      {/* Main */}
      <div className="hr-main">
        {/* Top bar */}
        <header className="hr-topbar">
          <div className="hr-company-switch">
            <label className="sr-only" htmlFor="company-select">Company</label>
            <select
              id="company-select"
              className="hr-company-select"
              value={isCombined ? '__all' : company.id}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={myCompanies.length < 2}
              title={myCompanies.length < 2 ? 'Your account is limited to this company' : 'Switch company, or view all your companies together'}
            >
              {myCompanies.length > 1 && <option value='__all'>All companies — combined overview</option>}
              {myCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {companySettings(c.id)?.displayName || c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="hr-topbar-right">
            {can(user, 'notifications', 'view') && <button
              type="button"
              className="hr-icon-btn"
              aria-label={`Notifications, ${unread} unread`}
              onClick={() => goTo('notifications')}
            >
              <Icon name="bell" />
              {unread > 0 && <span className="hr-badge">{unread > 99 ? '99+' : unread}</span>}
            </button>}
            <div className="hr-profile">
              <span className="hr-avatar-lg hr-avatar-fallback">{user.initials}</span>
              <span className="hr-profile-text">
                {user.name}
                <span>{user.role}</span>
              </span>
            </div>
            <div className="hr-session-actions">
              <button type="button" className="sm-actions-btn" onClick={() => signOut()}>
                Sign out
              </button>
            </div>
            <button type="button" className="btn btn-secondary hr-exit" onClick={onBack}>
              Exit
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="hr-content" ref={contentRef}>
          <div className="hr-welcome">
            <div>
              <h1>{isCombined ? 'All companies' : company.name}</h1>
              {isCombined && <p className="hr-scope-note">Combined overview of {myCompanies.map((c) => nameOf(c.id)).join(' and ')}. Each company&apos;s records stay separate.</p>}
              <p>
                {new Date(`${today}T00:00:00`).toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <div className="hr-welcome-right">
              <LiveClock />
              <span className="hr-today">
                Today
              </span>
            </div>
          </div>

          {groupTabs.length > 1 && (
            <div className="hr-subtabs" role="tablist" aria-label={`${GROUP_LABELS[navItem.group].label} sections`}>
              {groupTabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={t.id === activeNav} className={`hr-subtab${t.id === activeNav ? ' is-active' : ''}`} onClick={() => goTo(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <Suspense fallback={<SectionSkeleton label={`Loading ${navItem?.label ?? 'page'}`} />}>
          {!permitted && (
            <AccessDenied moduleLabel={navItem?.label ?? 'this page'} user={user} onHome={() => goTo('dashboard')} />
          )}

          {permitted && activeNav === 'settings' && (
            <Settings
              key={scopeCompany.id || 'all'}
              user={user}
              company={isCombined ? myCompanies[0] : company}
              onNavigate={goTo}
              onChanged={() => {
                setSettingsVersion((v) => v + 1)
                onSessionChange()
              }}
            />
          )}

          {permitted && activeNav === 'audit-logs' && <AuditLogs user={user} />}

          {permitted && activeNav === 'overtime' && (
            <Overtime
              key={scopeCompany.id || 'all'}
              company={scopeCompany}
              user={user}
              onChanged={() => {
                setAttendanceVersion((v) => v + 1)
                reloadNotificationsSoon()
              }}
            />
          )}


          {permitted && isCombined && ['employees', 'sales-monitoring', 'reports'].includes(activeNav) && (
            <section className="hr-panel hr-chooser" aria-label="Choose a company">
              <h2>{navItem.label} is kept per company</h2>
              <p>Choose which company to open. Employee, shop and report data are never mixed between companies.</p>
              <div className="hr-chooser-grid">
                {myCompanies.map((c) => (
                  <button key={c.id} type="button" className="hr-chooser-card" onClick={() => setCompanyId(c.id)}>
                    <strong>{nameOf(c.id)}</strong>
                    <span>{todayRecords.filter((r) => r.companyId === c.id).length} employees tracked today</span>
                    <span className="hr-link">Open {navItem.label} →</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {permitted && activeNav === 'dashboard' && isCombined && (
            <section className="hr-panel hr-combined" aria-label="Today by company">
              <div className="hr-panel-head">
                <h2>Today by company</h2>
                <span className="hr-muted">Each company counted separately</span>
              </div>
              <div className="hr-table-wrap">
                <table className="hr-table hr-combined-table">
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col" className="hr-num">Employees</th>
                      <th scope="col" className="hr-num">Present</th>
                      <th scope="col" className="hr-num">Absent</th>
                      <th scope="col" className="hr-num">Late</th>
                      <th scope="col" className="hr-num">On leave</th>
                      <th scope="col" className="hr-num">Attendance rate</th>
                      <th scope="col" className="hr-num">Open exceptions</th>
                      <th scope="col"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyBreakdown.map((c) => (
                      <tr key={c.id}>
                        <th scope="row" data-label="Company">{c.name}</th>
                        <td data-label="Employees" className="hr-num">{c.total}</td>
                        <td data-label="Present" className="hr-num">{c.present}</td>
                        <td data-label="Absent" className="hr-num">{c.absent}</td>
                        <td data-label="Late" className="hr-num">{c.late}</td>
                        <td data-label="On leave" className="hr-num">{c.onLeave}</td>
                        <td data-label="Attendance rate" className="hr-num">{c.rate == null ? 'No data yet' : `${c.rate.toFixed(1)}%`}</td>
                        <td data-label="Open exceptions" className="hr-num">{c.openExceptions}</td>
                        <td data-label="Open"><button type="button" className="hr-link" onClick={() => setCompanyId(c.id)}>View {c.name} →</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {permitted && activeNav === 'dashboard' && (
            <>
              {/* The four numbers HR needs, as a clean stat strip. The day's
                  register below stays the hero. */}
              <div className="hr-stats" role="status" aria-label="Today's attendance summary">
                <div className="hr-stat">
                  <span className="hr-stat-label">Total employees</span>
                  <span className="hr-stat-value">{stats.total}</span>
                </div>
                <div className="hr-stat">
                  <span className="hr-stat-label">Present today</span>
                  <span className="hr-stat-value hr-stat-ok">{stats.present}</span>
                </div>
                <div className="hr-stat">
                  <span className="hr-stat-label">Absent today</span>
                  <span className="hr-stat-value hr-stat-crit">{stats.absent}</span>
                </div>
                <div className="hr-stat">
                  <span className="hr-stat-label">Late coming</span>
                  <span className="hr-stat-value hr-stat-warn">{stats.late}</span>
                </div>
              </div>

              <section className="hr-panel hr-register">
                <div className="hr-panel-head">
                  <h2>Today&apos;s register</h2>
                  {can(user, 'attendance', 'view') && (
                    <button
                      type="button"
                      className="hr-link"
                      onClick={() => goTo('attendance')}
                    >
                      Full attendance →
                    </button>
                  )}
                </div>
                <div className="hr-table-wrap">
                  <table className="hr-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Staff ID</th>
                        {isCombined && <th>Company</th>}
                        <th>Check in</th>
                        <th>Check out</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayRows.map((r) => (
                        <tr key={r.employeeId}>
                          <td>
                            <div className="hr-employee">
                              {r.photo ? (
                                <img className="hr-avatar" src={r.photo} alt="" />
                              ) : (
                                <span className="hr-avatar hr-avatar-fallback">
                                  {r.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                                </span>
                              )}
                              {r.fullName}
                            </div>
                          </td>
                          <td className="hr-mono">{r.employeeId}</td>
                          {isCombined && <td>{nameOf(r.companyId)}</td>}
                          <td className="hr-time">
                            {r.clockIn ? formatAccraTime(r.clockIn) : '—'}
                          </td>
                          <td className="hr-time">
                            {r.clockOut ? formatAccraTime(r.clockOut) : '—'}
                          </td>
                          <td>
                            <StatusBadge status={r.status} />
                          </td>
                        </tr>
                      ))}
                      {todayRows.length === 0 && (
                        <tr>
                          <td colSpan={isCombined ? 6 : 5} className="hr-empty">
                            No employees registered for {isCombined ? 'your companies' : company.name} yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {permitted && !isCombined && activeNav === 'employees' && (
            <section className="hr-panel hr-panel-flush">
              <EmployeeDirectory
                employees={companyEmployees}
                onAssignShop={can(user, 'employees', 'edit') ? setAssigningEmployee : null}
                onViewAttendance={can(user, 'attendance', 'view') ? (emp) => openAttendanceHistory({ employeeId: emp.staffId, companyId: emp.companyId }) : null}
                onEmployeeChanged={can(user, 'employees', 'edit') ? () => { setAssignRefreshKey((k) => k + 1); setAttendanceVersion((v) => v + 1) } : null}
              />
            </section>
          )}

          {permitted && activeNav === 'attendance' && (
            <AttendanceManagement
              key={`${scopeCompany.id || 'all'}-${attendanceFocus?.token ?? 'all'}`}
              company={scopeCompany}
              user={user}
              focus={attendanceFocus}
              onChanged={() => {
                setAttendanceVersion((v) => v + 1)
                reloadNotificationsSoon()
              }}
            />
          )}

          {permitted && activeNav === 'notifications' && (
            <NotificationsCenter
              key={scopeCompany.id || 'all'}
              company={scopeCompany}
              user={user}
              onNavigate={goTo}
              onChanged={refreshUnread}
            />
          )}


          {permitted && !isCombined && activeNav === 'sales-monitoring' && (
            <SalesMonitoring key={company.id} company={company} user={user} />
          )}

          {permitted && !isCombined && activeNav === 'reports' && (
            <section className="hr-panel hr-report">
              <div className="hr-report-head">
                <div className="hr-report-title">
                  <span className="hr-report-icon" aria-hidden="true">
                    <Icon name="report" size={20} />
                  </span>
                  <div>
                    <h2>Employee Attendance Details</h2>
                    <p className="hr-report-sub">
                      {reportPeriod.label} · {formatPeriodDate(reportPeriod.start)} to{' '}
                      {formatPeriodDate(reportPeriod.end)}
                    </p>
                  </div>
                </div>
                <div className="hr-report-actions">
                  <label className="sr-only" htmlFor="report-period">Report month</label>
                  <select
                    id="report-period"
                    className="hr-company-select hr-report-period"
                    value={reportPeriod.key}
                    onChange={(e) => setReportPeriodKey(e.target.value)}
                  >
                    {reportPeriods.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <div className="sm-tabs hr-report-views" role="tablist" aria-label="Report view">
                    <button type="button" role="tab" aria-selected={reportView === 'summary'} className={`sm-tab${reportView === 'summary' ? ' is-active' : ''}`} onClick={() => setReportView('summary')}>Summary</button>
                    <button type="button" role="tab" aria-selected={reportView === 'detail'} className={`sm-tab${reportView === 'detail' ? ' is-active' : ''}`} onClick={() => setReportView('detail')}>Daily records</button>
                  </div>
                  {can(user, 'reports', 'export') && (
                    <button
                      type="button"
                      className="btn btn-secondary hr-report-btn"
                      onClick={downloadReport}
                    >
                      <Icon name="download" size={16} /> Download Report
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary hr-report-btn"
                    onClick={() => window.print()}
                  >
                    <Icon name="print" size={16} /> Print
                  </button>
                </div>
              </div>

              <p className="hr-report-note">
                Attendance for the {reportPeriod.label} period (26th–25th). One record per employee per day, whether clocked in
                through the system or entered manually. Overtime includes all hours worked on Saturdays, Sundays and holidays. Future
                dates are never counted as absences.
              </p>
              {reportView === 'summary' && <div className="hr-table-wrap">
                <table className="hr-table hr-report-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Employee Name</th>
                      <th>Employee ID</th>
                      <th>Position</th>
                      <th>Payment Method</th>
                      <th className="hr-num">Working Days</th>
                      <th className="hr-num">Present</th>
                      <th className="hr-num">Late</th>
                      <th className="hr-num">Absent</th>
                      <th className="hr-num">On Leave</th>
                      <th className="hr-num">Working hrs</th>
                      <th className="hr-num">Overtime (hrs)</th>
                      <th className="hr-num">Overtime pay</th>
                      <th className="hr-num">Holidays</th>
                      <th className="hr-num">Attendance Rate</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map(({ emp, workingDays, present, late, absent, leave, overtime, overtimePay, workingHours, holidays, rate, due, tier }, i) => (
                      <tr key={emp.staffId}>
                        <td className="hr-num hr-rownum">{i + 1}</td>
                        <td>
                          <div className="hr-employee">
                            {emp.faceImage ? (
                              <img className="hr-avatar" src={emp.faceImage} alt="" />
                            ) : (
                              <span className="hr-avatar hr-avatar-fallback">
                                {emp.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                              </span>
                            )}
                            {emp.fullName}
                          </div>
                        </td>
                        <td className="hr-mono">{emp.staffId}</td>
                        <td>{emp.position}</td>
                        <td>{getPaymentMethodLabel(emp.paymentMethod) || '—'}</td>
                        <td className="hr-num">{workingDays}</td>
                        <td className="hr-num">{present}</td>
                        <td className="hr-num">
                          {late > 0 ? <span className="hr-cell-warn">{late}</span> : late}
                        </td>
                        <td className="hr-num">
                          {absent > 0 ? <span className="hr-cell-crit">{absent}</span> : absent}
                        </td>
                        <td className="hr-num">{leave}</td>
                        <td className="hr-num">{workingHours.toFixed(2)}</td>
                        <td className="hr-num">
                          {overtime > 0 ? <span className="hr-cell-overtime">{overtime}</span> : overtime}
                        </td>
                        <td className="hr-num">{formatCedis(overtimePay)}</td>
                        <td className="hr-num">{holidays}</td>
                        <td className="hr-num hr-rate">{due ? `${rate.toFixed(1)}%` : '—'}</td>
                        <td>
                          <span className={`report-tier report-tier-${tier}`}>
                            {TIER_LABELS[tier]}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {reportRows.length === 0 && (
                      <tr>
                        <td colSpan="16" className="hr-empty">
                          No employees registered for {company.name} yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>}

              {reportView === 'detail' && (
                <div className="hr-table-wrap">
                  <table className="hr-table hr-report-table hr-detail-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Date</th>
                        <th>Clock-in</th>
                        <th>Clock-out</th>
                        <th>Status</th>
                        <th className="hr-num">Hours</th>
                        <th className="hr-num">Overtime</th>
                        <th className="hr-num">Overtime pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportDetail.map(({ r, ot }) => (
                        <tr key={r.key}>
                          <td data-label="Employee"><span className="at-stack"><span className="at-emp-name">{r.fullName}</span><span className="at-sub"><span className="sm-mono">{r.employeeId}</span></span></span></td>
                          <td data-label="Date" className="hr-time">{formatAccraDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                          <td data-label="Clock-in" className="hr-time">{r.clockInUnknown ? 'Unknown' : r.clockIn ? formatAccraTime(r.clockIn) : '—'}</td>
                          <td data-label="Clock-out" className="hr-time">{r.clockOutUnknown ? 'Unknown' : r.clockOut ? formatAccraTime(r.clockOut) : '—'}</td>
                          <td data-label="Status"><StatusBadge status={r.status} /></td>
                          <td data-label="Hours" className="hr-num">{r.workingMinutes ? (r.workingMinutes / 60).toFixed(2) : '—'}</td>
                          <td data-label="Overtime" className="hr-num">{ot.status === 'counted' ? `${ot.minutes} min` : '—'}</td>
                          <td data-label="Overtime pay" className="hr-num">{ot.status === 'counted' ? formatCedis(ot.pay) : '—'}</td>
                        </tr>
                      ))}
                      {reportDetail.length === 0 && (
                        <tr><td colSpan="8" className="hr-empty">No attendance records in this period yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          </Suspense>
        </div>
      </div>

      <HrAssistant
        key={user.id}
        user={user}
        companyId={isCombined ? '' : company.id}
        companyLabel={isCombined ? 'All companies' : company.name}
        onNavigate={(nav, focus) => (focus ? openAttendanceHistory(focus) : goTo(nav))}
      />

      {assigningEmployee && (
        <AssignShopModal
          employee={assigningEmployee}
          onClose={() => setAssigningEmployee(null)}
          onAssigned={() => setAssignRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
