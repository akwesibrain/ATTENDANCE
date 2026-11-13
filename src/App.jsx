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

function App() {
  const path = window.location.pathname
  const verifyToken = path.match(VERIFY_PATH)?.[1]
  if (verifyToken) {
    return <Suspense fallback={<PageSkeleton label="Loading verification" />}><VerifyCheck token={verifyToken} /></Suspense>
  }
  const display = path.match(DISPLAY_PATH)
  if (display) {
    return <Suspense fallback={<PageSkeleton label="Loading the display" />}><WorkplaceDisplay setupToken={display[1] ?? null} /></Suspense>
  }
  return <Portal />
}

function Portal() {
  // Opened from the home-screen icon: the app is the attendance kiosk only.
  // It always starts at "Enter your Staff ID" and there is no way back to
  // the home page (no Back button, and the phone's back gesture is held).
  const [installed] = useState(isInstalled)
  const [view, setView] = useState(() => (installed ? VIEW.attendance : viewFromLocation()))
  // Bumped after each check-in/out so the next person starts on a fresh Staff ID screen.
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!installed) return undefined
    const here = `/attendance${window.location.search}`
    window.history.replaceState(null, '', here)
    window.history.pushState(null, '', here)
    const hold = () => window.history.pushState(null, '', here)
    window.addEventListener('popstate', hold)
    return () => window.removeEventListener('popstate', hold)
  }, [installed])

  // Keep the URL in sync so each page has a shareable link.
  useEffect(() => {
    const path = VIEW_TO_PATH[view]
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
  }, [view])

  // Support browser back/forward buttons (not in the installed app).
  useEffect(() => {
    if (installed) return undefined
    const onPopState = () => setView(viewFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [installed])

  if (installed) {
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
