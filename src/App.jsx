import { Suspense, lazy, useEffect, useState } from 'react'
import Home from './pages/Home'
import { PageSkeleton } from './components/common/Skeletons'

// Each part of the app is downloaded only when it is opened, so the home
// screen and the check-in flow load fast and employees never download the HR
// portal.
const EmployeeRegistration = lazy(() => import('./pages/EmployeeRegistration'))
const AttendanceCheckIn = lazy(() => import('./pages/AttendanceCheckIn'))
const HrDashboard = lazy(() => import('./pages/HrDashboard'))
const VerifyCheck = lazy(() => import('./pages/VerifyCheck'))
const WorkplaceDisplay = lazy(() => import('./pages/WorkplaceDisplay'))

const VIEW = {
  home: 'home',
  register: 'register',
  attendance: 'attendance',
  hr: 'hr',
}

const PATH_TO_VIEW = {
  '/': VIEW.home,
  '/register': VIEW.register,
  '/attendance': VIEW.attendance,
  '/hr': VIEW.hr,
}

const VIEW_TO_PATH = {
  [VIEW.home]: '/',
  [VIEW.register]: '/register',
  [VIEW.attendance]: '/attendance',
  [VIEW.hr]: '/hr',
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

  if (view === VIEW.register) {
    return <Suspense fallback={<PageSkeleton label="Loading registration" />}><EmployeeRegistration onBack={() => setView(VIEW.home)} /></Suspense>
  }
  if (view === VIEW.attendance) {
    return <Suspense fallback={<PageSkeleton label="Loading attendance" />}><AttendanceCheckIn onBack={() => setView(VIEW.home)} /></Suspense>
  }
  if (view === VIEW.hr) {
    return <Suspense fallback={<PageSkeleton variant="hr" label="Loading the HR portal" />}><HrDashboard onBack={() => setView(VIEW.home)} /></Suspense>
  }
  return (
    <Home
      onRegister={() => setView(VIEW.register)}
      onAttendance={() => setView(VIEW.attendance)}
      onHr={() => setView(VIEW.hr)}
    />
  )
}

export default App
