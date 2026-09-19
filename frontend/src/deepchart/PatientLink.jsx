import { useEffect, useState } from 'react'
import { portal } from './portalApi.js'
import './deepchart.css'

// What a patient sees from their private link. No clinical values, no conflicts, no one else.
export default function PatientLink({ token }) {
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [dob, setDob] = useState('') // memory only: never in the URL or browser storage
  const [checked, setChecked] = useState(null)

  const check = (e) => {
    e.preventDefault()
    portal
      .patientView(token, dob)
      .then((v) => (setView(v), setChecked(dob), setError(null)))
      .catch((err) => setError(err.message))
  }
  useEffect(() => {
    if (!checked) return
    let alive = true
    const t = setInterval(
      () =>
        portal
          .patientView(token, checked)
          .then((v) => alive && setView(v))
          .catch((e) => alive && (setView(null), setChecked(null), setError(e.message))),
      5000,
    )
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [token, checked])

  return (
    <main className="pl">
      <div className="pl-card">
        <p className="pl-brand">Johns Hopkins Hospital</p>
        {!view && (
          <form onSubmit={check}>
            <p className="pl-status">To keep this page private, confirm your date of birth.</p>
            <input type="date" required value={dob} onChange={(e) => setDob(e.target.value)} aria-label="Date of birth" />{' '}
            <button className="dc-btn dc-btn-primary" disabled={!dob}>
              Open my page
            </button>
          </form>
        )}
        {error && <p className="pl-status">{error === 'this link is not valid' ? 'This link is not valid.' : error}</p>}
        {view && (
          <>
            <h1 className="pl-hi">Hi {view.first_name}.</h1>
            <p className="pl-status">{view.status_line}</p>
            <h2 className="pl-h2">Who looked at your record</h2>
            {view.access_log.length === 0 ? (
              <p className="muted">No one yet.</p>
            ) : (
              <ul className="pl-log">
                {view.access_log.map((e, i) => (
                  <li key={i}>
                    <span className="pl-when">{e.at}</span>
                    <span>
                      {e.hospital} · {e.role}
                      <br />
                      <span className="muted">
                        {e.action}
                        {e.reason ? ` · reason: ${e.reason}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="pl-foot muted">Synthetic demo data. This page updates on its own.</p>
          </>
        )}
      </div>
    </main>
  )
}
