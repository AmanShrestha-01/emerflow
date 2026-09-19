import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Board from './hospital/Board.jsx'
import DoctorPortal from './deepchart/DoctorPortal.jsx'
import PatientLink from './deepchart/PatientLink.jsx'

// Three screens, one app: /doctor (DeepChart portal), /p/<token> (patient link), anything else (board).
function route() {
  const path = window.location.pathname
  if (path.startsWith('/doctor')) return <DoctorPortal />
  const m = path.match(/^\/p\/([^/]+)/)
  if (m) return <PatientLink token={decodeURIComponent(m[1])} />
  return <Board />
}

createRoot(document.getElementById('root')).render(<StrictMode>{route()}</StrictMode>)
