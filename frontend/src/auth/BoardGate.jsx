import { useEffect, useState } from 'react'
import { loadSession, portal, saveSession } from '../deepchart/portalApi.js'
import Login from './Login.jsx'
import { HOME, logout } from './session.js'
import './auth.css'

// The board needs a staff login at the board hospital. Commanders land here; a doctor can come here too
// (for example after resolving a hold in DeepChart and clicking "Back to the board").
export default function BoardGate({ children }) {
  const [state, setState] = useState(() => ({ ready: !loadSession(), session: null }))

  useEffect(() => {
    const stored = loadSession()
    if (!stored) return
    portal
      .me(stored)
      .then(() => setState({ ready: true, session: stored }))
      .catch(() => {
        saveSession(null) // stale token, e.g. after a server restart
        setState({ ready: true, session: null })
      })
  }, [])

  if (!state.ready) return <p className="auth-wait">Loading…</p>
  const s = state.session
  if (!s) return <Login presetRole="commander" next="/" />
  if (s.hospital !== HOME)
    return (
      <Login
        presetRole="commander"
        next="/"
        banner={`You're logged in at ${s.hospital}. The command board belongs to ${HOME}.`}
      />
    )
  return (
    <>
      {children}
      <AccountChip session={s} />
    </>
  )
}

function AccountChip({ session }) {
  const toDeepChart = session.role === 'doctor' ? '/doctor' : '/login?role=doctor&next=/doctor'
  return (
    <div className="auth-chip" role="status">
      <span className="auth-chip-who">
        {session.role === 'doctor' ? 'Doctor' : 'Commander'} · {session.hospital}
      </span>
      <a className="auth-chip-link" href={toDeepChart}>
        DeepChart
      </a>
      <button className="auth-chip-link" onClick={logout}>
        Log out
      </button>
    </div>
  )
}
