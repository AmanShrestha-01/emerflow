import { useEffect, useState } from 'react'
import { portal, saveSession } from '../deepchart/portalApi.js'
import { HOME, landing } from './session.js'
import './auth.css'

// One login for the whole app: hospital, then role, then PIN.
// Commander → the board (/). Doctor → DeepChart (/doctor). Patients never log in; they use their private link.
export default function Login({ presetRole = 'commander', next = null, banner = null, onIn = null }) {
  const [hospitals, setHospitals] = useState([HOME, 'Fells Point Heart Institute', 'Hampden Family Health'])
  const [hospital, setHospital] = useState(HOME)
  const [role, setRole] = useState(presetRole)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    portal
      .hospitals()
      .then((hs) => setHospitals(hs.map((h) => h.name)))
      .catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const s = await portal.login(hospital, role, pin)
      saveSession(s)
      if (onIn) onIn(s)
      else window.location.assign(landing(s, next))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="auth-cross" aria-hidden="true" />
          <div>
            <h1 className="auth-title">Emer Flow</h1>
            <p className="auth-sub">Staff login</p>
          </div>
        </div>
        {banner && <p className="auth-banner">{banner}</p>}
        <label className="auth-field">
          Hospital
          <select value={hospital} onChange={(e) => setHospital(e.target.value)}>
            {hospitals.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <fieldset className="auth-field">
          <legend>Role</legend>
          <div className="auth-roles">
            {[
              ['commander', 'Commander', 'The command board'],
              ['doctor', 'Doctor', 'DeepChart records'],
            ].map(([r, label, where]) => (
              <label key={r} className={`auth-role${role === r ? ' is-on' : ''}`}>
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
                <span>
                  <strong>{label}</strong>
                  <span className="auth-where">{where}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {role === 'commander' && hospital !== HOME && (
          <p className="auth-hint">The command board belongs to {HOME}.</p>
        )}
        <label className="auth-field">
          PIN
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="auth-btn" type="submit" disabled={busy || !pin}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="auth-fine">
          Demo only (PIN <code>demo</code>). A real deployment uses the hospital&apos;s own single sign-on. Patients don&apos;t
          log in; they get a private link.
        </p>
      </form>
    </main>
  )
}
