import { Suspense, lazy, useEffect, useState } from 'react'
import Home from './pages/Home'
import { PageSkeleton } from './components/common/Skeletons'

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

function viewFromLocation() {
  return PATH_TO_VIEW[window.location.pathname] ?? VIEW.home
}

const VERIFY_PATH = /^\/verify\/([^/]+)$/
const DISPLAY_PATH = /^\/display(?:\/setup\/([^/]+))?\/?$/
const ENROL_PATH = /^\/enroll\/([^/]+)$/
const HR_SETUP_PATH = /^\/hr\/setup\/([^/]+)$/
const PASSWORD_RESET_PATH = /^\/hr\/reset\/([^/]+)$/
const VISIT_PATH = /^\/visit\/?$/

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
  const display = path.match(DISPLAY_PATH)
  if (display) {
    return <Suspense fallback={<PageSkeleton label="Loading the display" />}><WorkplaceDisplay setupToken={display[1] ?? null} /></Suspense>
  }
  return <Portal />
}

function Portal() {
  const [view, setView] = useState(viewFromLocation)

  // Keep the URL in sync so each page has a shareable link.
  useEffect(() => {
    const path = VIEW_TO_PATH[view]
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
  }, [view])

  // Support browser back/forward buttons.
  useEffect(() => {
    const onPopState = () => setView(viewFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (view === VIEW.hr) {
    return <Suspense fallback={<PageSkeleton variant="hr" label="Loading the HR portal" />}><HrDashboard onBack={() => setView(VIEW.home)} /></Suspense>
  }
  let page
  if (view === VIEW.register) {
    page = <Suspense fallback={<PageSkeleton label="Loading registration" />}><EmployeeRegistration onBack={() => setView(VIEW.home)} /></Suspense>
  } else if (LEGAL_VIEWS.has(view)) {
    page = (
      <Suspense fallback={<PageSkeleton label="Loading policy" />}>
        <LegalPage
          docId={view}
          onNavigate={(path) => setView(PATH_TO_VIEW[path] ?? VIEW.home)}
          // Opened from a link in a new tab there is nothing to go back to.
          onBack={() => (window.history.length > 1 ? window.history.back() : setView(VIEW.home))}
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
