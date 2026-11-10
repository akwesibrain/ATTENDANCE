import { useEffect, useState } from 'react'
import Home from './pages/Home'
import EmployeeRegistration from './pages/EmployeeRegistration'
import AttendanceCheckIn from './pages/AttendanceCheckIn'
import HrDashboard from './pages/HrDashboard'
import VerifyCheck from './pages/VerifyCheck'

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

function App() {
  const verifyToken = window.location.pathname.match(VERIFY_PATH)?.[1]
  return verifyToken ? <VerifyCheck token={verifyToken} /> : <Portal />
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
    return <EmployeeRegistration onBack={() => setView(VIEW.home)} />
  }
  if (view === VIEW.attendance) {
    return <AttendanceCheckIn onBack={() => setView(VIEW.home)} />
  }
  if (view === VIEW.hr) {
    return <HrDashboard onBack={() => setView(VIEW.home)} />
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
