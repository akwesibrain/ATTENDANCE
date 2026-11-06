import { useState } from 'react'
import Home from './pages/Home'
import EmployeeRegistration from './pages/EmployeeRegistration'
import AttendanceCheckIn from './pages/AttendanceCheckIn'

const VIEW = {
  home: 'home',
  register: 'register',
  attendance: 'attendance',
}

function App() {
  const [view, setView] = useState(VIEW.home)

  if (view === VIEW.register) {
    return <EmployeeRegistration onBack={() => setView(VIEW.home)} />
  }
  if (view === VIEW.attendance) {
    return <AttendanceCheckIn onBack={() => setView(VIEW.home)} />
  }
  return (
    <Home
      onRegister={() => setView(VIEW.register)}
      onAttendance={() => setView(VIEW.attendance)}
    />
  )
}

export default App
