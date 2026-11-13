import { Suspense, lazy, useEffect, useState } from 'react'
import Home from './pages/Home'
import { PageSkeleton } from './components/common/Skeletons'
import { isInstalled } from './utils/installPrompt'

// Each part of the app is downloaded only when it is opened, so the home
// screen and the check-in flow load fast and employees never download the HR
// portal.
const EmployeeRegistration = lazy(() => import('./pages/EmployeeRegistration'))
const AttendanceCheckIn = lazy(() => import('./pages/AttendanceCheckIn'))
const HrDashboard = lazy(() => import('./pages/HrDashboard'))
// Field staff's phones share location between clock-in and clock-out.
const LocationSharingBar = lazy(() => import('./components/tracking/LocationSharingBar'))
// Privacy, Tracking, Terms and Cookie policies.
const LegalPage = lazy(() => import('./pages/LegalPage'))
const VerifyCheck = lazy(() => import('./pages/VerifyCheck'))
const WorkplaceDisplay = lazy(() => import('./pages/WorkplaceDisplay'))
const EnrolFace = lazy(() => import('./pages/EnrolFace'))
const HrSetup = lazy(() => import('./pages/HrSetup'))
const PasswordReset = lazy(() => import('./pages/PasswordReset'))
const RecordVisit = lazy(() => import('./pages/RecordVisit'))
const SetShopLocation = lazy(() => import('./pages/SetShopLocation'))

const VIEW = {
  home: 'home',
  register: 'register',
  attendance: 'attendance',
  hr: 'hr',
  privacy: 'privacy',
  tracking: 'tracking',
  terms: 'terms',
  cookies: 'cookies',
}

/** Views that show one of the policies (view name = policy id). */
const LEGAL_VIEWS = new Set([VIEW.privacy, VIEW.tracking, VIEW.terms, VIEW.cookies])

const PATH_TO_VIEW = {
  '/': VIEW.home,
  '/register': VIEW.register,
  '/attendance': VIEW.attendance,
  '/hr': VIEW.hr,
  '/privacy': VIEW.privacy,
  '/tracking-policy': VIEW.tracking,
  '/terms': VIEW.terms,
  '/cookies': VIEW.cookies,
}

const VIEW_TO_PATH = {
  [VIEW.home]: '/',
  [VIEW.register]: '/register',
  [VIEW.attendance]: '/attendance',
  [VIEW.hr]: '/hr',
  [VIEW.privacy]: '/privacy',
  [VIEW.tracking]: '/tracking-policy',
  [VIEW.terms]: '/terms',
  [VIEW.cookies]: '/cookies',
}

function normalizePathname(pathname = window.location.pathname) {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function viewFromLocation(installed = false) {
  const matched = PATH_TO_VIEW[normalizePathname()]
  if (installed) {
    if (matched && matched !== VIEW.home && matched !== VIEW.attendance) {
      return matched
    }
    return VIEW.attendance
  }
  return matched ?? VIEW.home
}

const VERIFY_PATH = /^\/verify\/([^/]+)$/
const DISPLAY_PATH = /^\/display(?:\/setup\/([^/]+))?\/?$/
const ENROL_PATH = /^\/enroll\/([^/]+)$/
const HR_SETUP_PATH = /^\/hr\/setup\/([^/]+)$/
const PASSWORD_RESET_PATH = /^\/hr\/reset\/([^/]+)$/
const VISIT_PATH = /^\/visit\/?$/
const SHOP_LOCATION_PATH = /^\/shop-location\/?$/

function App() {
  const path = window.location.pathname
  const verifyToken = path.match(VERIFY_PATH)?.[1]
  if (verifyToken) {
    return <Suspense fallback={<PageSkeleton label="Loading verification" />}><VerifyCheck token={verifyToken} /></Suspense>
  }
  const enrolToken = path.match(ENROL_PATH)?.[1]
  if (enrolToken) {
    return <Suspense fallback={<PageSkeleton label="Loading face setup" />}><EnrolFace token={enrolToken} /></Suspense>
  }
  const hrSetupToken = path.match(HR_SETUP_PATH)?.[1]
  if (hrSetupToken) {
    return <Suspense fallback={<PageSkeleton label="Loading your invite" />}><HrSetup token={hrSetupToken} /></Suspense>
  }
  const resetToken = path.match(PASSWORD_RESET_PATH)?.[1]
  if (resetToken) {
    return <Suspense fallback={<PageSkeleton label="Loading your reset link" />}><PasswordReset token={resetToken} /></Suspense>
  }
  if (VISIT_PATH.test(path)) {
    return (
      <>
        <Suspense fallback={<PageSkeleton label="Loading your shops" />}><RecordVisit /></Suspense>
        <Suspense fallback={null}><LocationSharingBar /></Suspense>
      </>
    )
  }
  if (SHOP_LOCATION_PATH.test(path)) {
    return (
      <>
        <Suspense fallback={<PageSkeleton label="Loading your shops" />}><SetShopLocation /></Suspense>
        <Suspense fallback={null}><LocationSharingBar /></Suspense>
      </>
    )
  }
  const display = path.match(DISPLAY_PATH)
  if (display) {
    return <Suspense fallback={<PageSkeleton label="Loading the display" />}><WorkplaceDisplay setupToken={display[1] ?? null} /></Suspense>
  }
  return <Portal />
}

function Portal() {
  // Opened from the home-screen icon at `/` or `/attendance`: the app runs as
  // the attendance kiosk (starts at "Enter your Staff ID", holds back gesture).
  // Explicit routes (/privacy, /tracking-policy, /terms, /cookies, /register,
  // /hr) still render their proper views even when installed.
  const [installed] = useState(isInstalled)
  const [view, setView] = useState(() => viewFromLocation(installed))
  // Bumped after each check-in/out so the next person starts on a fresh Staff ID screen.
  const [round, setRound] = useState(0)
  const isKiosk = installed && view === VIEW.attendance
  const defaultBackView = installed ? VIEW.attendance : VIEW.home

  useEffect(() => {
    if (!isKiosk) return undefined
    const initialSearch = window.location.search
    window.history.replaceState(null, '', '/attendance')
    window.history.pushState(null, '', `/attendance${initialSearch}`)
    const hold = () => window.history.pushState(null, '', '/attendance')
    window.addEventListener('popstate', hold)
    return () => window.removeEventListener('popstate', hold)
  }, [isKiosk])

  // Keep the URL in sync so each page has a shareable link.
  useEffect(() => {
    if (isKiosk) return
    const path = VIEW_TO_PATH[view]
    if (normalizePathname() !== path) {
      window.history.pushState(null, '', path)
    }
  }, [view, isKiosk])

  // Support browser back/forward buttons on non-kiosk views.
  useEffect(() => {
    if (isKiosk) return undefined
    const onPopState = () => setView(viewFromLocation(installed))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isKiosk, installed])

  if (isKiosk) {
    return (
      <>
        <Suspense fallback={<PageSkeleton label="Loading attendance" />}>
          <AttendanceCheckIn key={round} kiosk onBack={() => setRound((r) => r + 1)} />
        </Suspense>
        <Suspense fallback={null}><LocationSharingBar /></Suspense>
      </>
    )
  }
  if (view === VIEW.hr) {
    return <Suspense fallback={<PageSkeleton variant="hr" label="Loading the HR portal" />}><HrDashboard onBack={() => setView(defaultBackView)} /></Suspense>
  }
  let page
  if (view === VIEW.register) {
    page = <Suspense fallback={<PageSkeleton label="Loading registration" />}><EmployeeRegistration onBack={() => setView(defaultBackView)} /></Suspense>
  } else if (LEGAL_VIEWS.has(view)) {
    page = (
      <Suspense fallback={<PageSkeleton label="Loading policy" />}>
        <LegalPage
          docId={view}
          onNavigate={(path) => setView(PATH_TO_VIEW[path] ?? defaultBackView)}
          // Opened from a link in a new tab there is nothing to go back to.
          onBack={() => (window.history.length > 1 ? window.history.back() : setView(defaultBackView))}
        />
      </Suspense>
    )
  } else if (view === VIEW.attendance) {
    page = <Suspense fallback={<PageSkeleton label="Loading attendance" />}><AttendanceCheckIn onBack={() => setView(VIEW.home)} /></Suspense>
  } else {
    page = (
      <Home
        onRegister={() => setView(VIEW.register)}
        onAttendance={() => setView(VIEW.attendance)}
        onHr={() => setView(VIEW.hr)}
        onPolicy={(path) => setView(PATH_TO_VIEW[path] ?? VIEW.home)}
      />
    )
  }
  return (
    <>
      {page}
      <Suspense fallback={null}><LocationSharingBar /></Suspense>
    </>
  )
}

export default App
