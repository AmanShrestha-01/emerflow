import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Board from './hospital/Board.jsx'
import DoctorPortal from './deepchart/DoctorPortal.jsx'
import PatientLink from './deepchart/PatientLink.jsx'
import Login from './auth/Login.jsx'
import BoardGate from './auth/BoardGate.jsx'

// One app, one staff login (src/auth):
//   /login          the login; commander lands on the board, doctor on DeepChart
//   /doctor         DeepChart, the doctor portal (asks for a doctor login)
//   /p/<token>      a patient's private link (no login)
//   anything else   the command board (asks for a staff login; ?mock=1 skips it for the offline demo)
function route() {
  const path = window.location.pathname
  const q = new URLSearchParams(window.location.search)
  if (path.startsWith('/login')) return <Login presetRole={q.get('role') || 'commander'} next={q.get('next')} />
  if (path.startsWith('/doctor')) return <DoctorPortal />
  const m = path.match(/^\/p\/([^/]+)/)
  if (m) return <PatientLink token={decodeURIComponent(m[1])} />
  if (q.has('mock')) return <Board />
  return (
    <BoardGate>
      <Board />
    </BoardGate>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode>{route()}</StrictMode>)
