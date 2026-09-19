import { useEffect, useState } from 'react'
import { portal } from './portalApi.js'
import './deepchart.css'

// What a patient sees from their private link. No clinical values, no conflicts, no one else.
export default function PatientLink({ token }) {
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      portal
        .patientView(token)
        .then((v) => alive && (setView(v), setError(null)))
        .catch((e) => alive && setError(e.message))
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [token])

  return (
    <main className="pl">
      <div className="pl-card">
        <p className="pl-brand">Emer Flow General</p>
        {error && <p className="pl-status">{error === 'this link is not valid' ? 'This link is not valid.' : error}</p>}
        {!error && !view && <p className="muted">Loading…</p>}
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
