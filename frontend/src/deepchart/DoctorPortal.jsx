import { useCallback, useEffect, useState } from 'react'
import { Sev } from '../hospital/bits.jsx'
import { FACT_LABEL, FACTS, REASONS, loadSession, portal, saveSession } from './portalApi.js'
import './deepchart.css'

const HOME = 'Emer Flow General'
const NOTICE = 'sources disagree; a human must resolve'
const STATUS_WORD = { active: 'ACTIVE', present: 'PRESENT', stopped: 'STOPPED', absent: 'NONE RECORDED' }

// ---------------------------------------------------------------- shell
export default function DoctorPortal() {
  const [session, setSession] = useState(loadSession)
  const logout = () => {
    saveSession(null)
    setSession(null)
  }
  const onError = useCallback((e) => {
    if (e?.status === 401) {
      saveSession(null)
      setSession(null)
    }
  }, [])

  if (!session) return <Login onIn={(s) => (saveSession(s), setSession(s))} />
  return (
    <div className="dc">
      <header className="dc-top">
        <div>
          <h1 className="dc-title">DeepChart</h1>
          <p className="dc-sub">
            {session.hospital} · {session.role}
          </p>
        </div>
        <nav className="dc-nav">
          <a className="linkbtn" href="/">
            Command board
          </a>
          <button className="linkbtn" onClick={logout}>
            Log out
          </button>
        </nav>
      </header>
      {session.hospital === HOME && <HomeDesk session={session} onError={onError} />}
      {session.hospital === 'Hospital B' && <SenderDesk session={session} onError={onError} />}
      {session.hospital === 'Hospital C' && (
        <p className="dc-empty">Hospital C only holds records in this demo. Log in to {HOME} or Hospital B.</p>
      )}
    </div>
  )
}

function Login({ onIn }) {
  const [hospitals, setHospitals] = useState([HOME, 'Hospital B', 'Hospital C'])
  const [hospital, setHospital] = useState(HOME)
  const [role, setRole] = useState('doctor')
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    portal
      .hospitals()
      .then((hs) => setHospitals(hs.map((h) => h.name)))
      .catch(() => {})
  }, [])
  const submit = async (e) => {
    e.preventDefault()
    try {
      onIn(await portal.login(hospital, role, pin))
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <main className="dc-login">
      <form className="dc-card" onSubmit={submit}>
        <h1 className="dc-title">DeepChart</h1>
        <p className="muted">Doctor portal · Emer Flow</p>
        <label className="dc-field">
          Hospital
          <select value={hospital} onChange={(e) => setHospital(e.target.value)}>
            {hospitals.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <fieldset className="dc-field">
          <legend>Role</legend>
          {['doctor', 'commander'].map((r) => (
            <label key={r} className="dc-radio">
              <input type="radio" checked={role === r} onChange={() => setRole(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <label className="dc-field">
          PIN
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </label>
        {error && <p className="dc-error">{error}</p>}
        <button className="dc-btn dc-btn-primary" type="submit">
          Enter
        </button>
        <p className="dc-fine muted">Demo only. A real deployment uses the hospital&apos;s own single sign-on.</p>
      </form>
    </main>
  )
}

function usePoll(fn, ms, deps) {
  useEffect(() => {
    let alive = true
    const run = () => fn(() => alive)
    run()
    const t = setInterval(run, ms)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// ---------------------------------------------------------------- Hospital B: send a transfer
function SenderDesk({ session, onError }) {
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState(null)
  usePoll(
    (alive) =>
      portal
        .patients(session)
        .then((r) => alive() && setRows(r))
        .catch(onError),
    4000,
    [session.token],
  )
  const send = async (pid) => {
    try {
      const t = await portal.transfer(session, pid, HOME)
      setMsg(`Sent. Arrives at ${HOME} as ${t.pid}, with this hospital's record attached.`)
      setRows(await portal.patients(session))
    } catch (e) {
      setMsg(e.message)
      onError(e)
    }
  }
  if (session.role !== 'doctor') return <p className="dc-empty">The portal is for doctors. Commanders use the board.</p>
  return (
    <main className="dc-single">
      <h2 className="dc-h2">Your patients at Hospital B</h2>
      {msg && <p className="dc-toast">{msg}</p>}
      <ul className="dc-list">
        {rows.map((p) => (
          <li key={p.pid} className="dc-row">
            <Sev n={p.severity} />
            <span className="pid">{p.pid}</span>
            <span className="dc-row-main">
              <strong>{p.name}</strong>, {p.age} · {p.complaint}
            </span>
            {p.state === 'transferred' ? (
              <span className="muted">sent</span>
            ) : (
              <button className="dc-btn" onClick={() => send(p.pid)}>
                Transfer to {HOME}
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}

// ---------------------------------------------------------------- Emer Flow General: the desk
function HomeDesk({ session, onError }) {
  const [rows, setRows] = useState([])
  const [inbox, setInbox] = useState([])
  const [filter, setFilter] = useState('')
  const [onlyFlags, setOnlyFlags] = useState(true)
  const [pid, setPid] = useState(null)

  usePoll(
    (alive) => {
      portal
        .patients(session)
        .then((r) => alive() && setRows(r))
        .catch(onError)
      portal
        .inbox(session)
        .then((r) => alive() && setInbox(r))
        .catch(onError)
    },
    3000,
    [session.token],
  )

  if (session.role !== 'doctor') return <p className="dc-empty">The portal is for doctors. Commanders use the board.</p>
  const q = filter.trim().toLowerCase()
  const shown = rows.filter(
    (p) =>
      (!onlyFlags || p.held || p.conflicts > 0 || inbox.some((t) => t.pid === p.pid)) &&
      (!q || p.name.toLowerCase().includes(q) || p.pid.toLowerCase().includes(q)),
  )

  return (
    <div className="dc-desk">
      <aside className="dc-side">
        {inbox.length > 0 && (
          <section>
            <h2 className="dc-h2">Incoming transfers</h2>
            <ul className="dc-list">
              {inbox.map((t) => (
                <li key={t.transfer_id}>
                  <button className={`dc-row dc-pick${pid === t.pid ? ' is-on' : ''}`} onClick={() => setPid(t.pid)}>
                    <span className="pid">{t.pid}</span>
                    <span className="dc-row-main">
                      <strong>{t.name}</strong> from {t.from_hospital}
                    </span>
                    {t.conflicts > 0 ? <span className="dc-chip-held">{t.conflicts} conflict</span> : <span>clear</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="dc-h2">Patients</h2>
          <div className="dc-filter">
            <input placeholder="Search name or ID" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="dc-radio">
              <input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} /> Only
              held or conflicting
            </label>
          </div>
          <ul className="dc-list">
            {shown.map((p) => (
              <li key={p.pid}>
                <button className={`dc-row dc-pick${pid === p.pid ? ' is-on' : ''}`} onClick={() => setPid(p.pid)}>
                  <Sev n={p.severity} />
                  <span className="pid">{p.pid}</span>
                  <span className="dc-row-main">
                    <strong>{p.name}</strong> · {p.complaint}
                  </span>
                  {p.held ? (
                    <span className="dc-chip-held">HELD</span>
                  ) : p.conflicts > 0 ? (
                    <span className="dc-chip-soft">{p.conflicts} conflict</span>
                  ) : null}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="empty">No patients match. Press MASS CASUALTY on the board.</li>}
          </ul>
        </section>
      </aside>
      <main className="dc-main">
        {pid ? (
          <Workspace key={pid} pid={pid} session={session} onError={onError} />
        ) : (
          <p className="dc-empty">Pick a patient. Held patients and record conflicts are listed first.</p>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------- one patient
function Workspace({ pid, session, onError }) {
  const [reason, setReason] = useState('')
  const [chart, setChart] = useState(null)
  const [matches, setMatches] = useState(null)
  const [log, setLog] = useState([])
  const [link, setLink] = useState(null)
  const [error, setError] = useState(null)

  const fail = (e) => {
    setError(e.message)
    onError(e)
  }
  const loadChart = useCallback(
    async (r = reason) => {
      if (!r) return
      try {
        setChart(await portal.chart(session, pid, r))
        setLog(await portal.accessLog(session, pid))
        setError(null)
      } catch (e) {
        fail(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, reason, session],
  )

  const pickReason = (r) => {
    setReason(r)
    if (r) loadChart(r)
  }
  const lookup = async () => {
    try {
      setMatches((await portal.lookup(session, pid, reason)).candidates)
      setLog(await portal.accessLog(session, pid))
    } catch (e) {
      fail(e)
    }
  }
  const decide = async (ref, same) => {
    try {
      await portal.confirm(session, pid, ref, same, reason)
      await lookup()
      await loadChart()
    } catch (e) {
      fail(e)
    }
  }
  const resolve = async (outcome) => {
    try {
      await portal.resolveHold(chart.hold.hold_id, outcome)
      await loadChart()
    } catch (e) {
      fail(e)
    }
  }
  const makeLink = async () => {
    try {
      setLink(await portal.patientLink(session, pid))
    } catch (e) {
      fail(e)
    }
  }

  const p = chart?.patient
  return (
    <div className="dc-ws">
      <div className="dc-ws-head">
        <h2 className="dc-ws-title">
          {p ? (
            <>
              {p.name} · {p.age} · <span className="pid">{pid}</span>
              <span className="muted"> · {p.unit ? `in ${p.unit}` : p.state}</span>
            </>
          ) : (
            <span className="pid">{pid}</span>
          )}
        </h2>
        <label className="dc-reason">
          Reason for access
          <select value={reason} onChange={(e) => pickReason(e.target.value)}>
            <option value="">choose one first</option>
            {REASONS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="dc-error">{error}</p>}
      {!reason && (
        <p className="dc-empty">
          Outside records open only after you pick a reason. Every lookup is logged and the patient can see the log.
        </p>
      )}

      {reason && chart && (
        <>
          {chart.hold && (
            <section className="dc-hold">
              <p className="dc-verify">VERIFICATION REQUIRED</p>
              <p>
                The board is holding a move to <strong>{chart.hold.to_unit}</strong>. It relies on:{' '}
                {chart.hold.because.map((f) => FACT_LABEL[f] || f).join(', ')}.
              </p>
              <p className="dc-notice">{NOTICE}</p>
              <div className="dc-actions">
                <button className="dc-btn dc-btn-primary" onClick={() => resolve('proceed')}>
                  I checked the records: proceed
                </button>
                <button className="dc-btn" onClick={() => resolve('cancel')}>
                  Cancel the move
                </button>
              </div>
            </section>
          )}

          <section className="dc-block">
            <div className="dc-block-head">
              <h3 className="dc-h3">Records from other hospitals</h3>
              <button className="dc-btn" onClick={lookup}>
                Look up other hospitals
              </button>
            </div>
            {matches && <Matches matches={matches} onDecide={decide} />}
          </section>

          <section className="dc-block">
            <div className="dc-block-head">
              <h3 className="dc-h3">Merged chart</h3>
              <span className="muted">
                {chart.sources.map((s) => `${s.source_name} (${s.recorded_date})`).join(' · ')}
              </span>
            </div>
            <Chart facts={chart.facts} />
          </section>

          <OrderBox session={session} pid={pid} onDone={() => loadChart()} onError={fail} />

          <section className="dc-block dc-two">
            <div>
              <h3 className="dc-h3">Access log</h3>
              <ul className="dc-log">
                {log.map((e, i) => (
                  <li key={i}>
                    <span className="time">{e.at}</span> {e.hospital} {e.role}: {e.action}
                    {e.reason && <span className="muted"> ({e.reason})</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="dc-h3">Patient link</h3>
              {link ? (
                <p>
                  <a className="linkbtn" href={link.path} target="_blank" rel="noreferrer">
                    {window.location.origin}
                    {link.path}
                  </a>
                </p>
              ) : (
                <button className="dc-btn" onClick={makeLink}>
                  Make a private link for the patient
                </button>
              )}
              <p className="muted dc-fine">Shows their status and who viewed their record. Never clinical details.</p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Matches({ matches, onDecide }) {
  if (matches.length === 0) return <p className="empty">No other hospital has a matching record.</p>
  return (
    <ul className="dc-matches">
      {matches.map((m) => (
        <li key={m.record_ref} className={`dc-match is-${m.match}`}>
          <div className="dc-match-top">
            <strong>{m.hospital}</strong>
            <span className="muted">
              {m.name} · {m.dob} · {m.sex} · {m.source_name} ({m.recorded_date})
            </span>
            <span className={m.match === 'strong' ? 'dc-chip-ok' : 'dc-chip-held'}>{m.match.toUpperCase()}</span>
          </div>
          {m.match === 'possible' && (
            <p className="dc-identity">
              Same name, birth date and sex. Different {m.differs.map((d) => DIFF_LABEL[d] || d).join(', ')}.{' '}
              <strong>Is this the same person? A human must decide.</strong>
            </p>
          )}
          <div className="dc-actions">
            {m.linked ? (
              <span className="muted">{m.confirmed ? 'Linked and confirmed by you' : 'Already linked to this chart'}</span>
            ) : null}
            {!(m.linked && m.confirmed) && (
              <button className="dc-btn" onClick={() => onDecide(m.record_ref, true)}>
                Same person
              </button>
            )}
            <button className="dc-btn" onClick={() => onDecide(m.record_ref, false)}>
              Not this patient
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
const DIFF_LABEL = { phone4: 'phone', insurance_id: 'insurance ID', address: 'address' }

function Chart({ facts }) {
  const [open, setOpen] = useState({})
  return (
    <ul className="dc-facts">
      {facts.map((f) => (
        <li key={f.fact} className={`dc-fact is-${f.kind}`}>
          <div className="dc-fact-head">
            <strong>{FACT_LABEL[f.fact] || f.fact}</strong>
            <span className={`dc-kind is-${f.kind}`}>
              {f.kind === 'conflict' ? 'CONFLICT' : f.kind === 'gap' ? 'gap' : f.verified_by_human ? 'checked by a human' : 'agree'}
            </span>
          </div>
          <table className="dc-versions">
            <tbody>
              {f.versions.map((v) => {
                const k = `${f.fact}:${v.resource_id}`
                return (
                  <tr key={k}>
                    <td>{v.source_name}</td>
                    <td className="time">{v.recorded_date}</td>
                    <td>
                      <button className="dc-val" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>
                        {v.value}
                      </button>
                      {open[k] && <span className="dc-rid">{v.resource_id}</span>}
                    </td>
                    <td className="dc-status">{STATUS_WORD[v.status] || v.status}</td>
                  </tr>
                )
              })}
              {f.missing_from.map((s) => (
                <tr key={s} className="muted">
                  <td>{s}</td>
                  <td />
                  <td>not mentioned</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {f.kind === 'conflict' && <p className="dc-notice">{NOTICE}</p>}
        </li>
      ))}
    </ul>
  )
}

function OrderBox({ session, pid, onDone, onError }) {
  const [text, setText] = useState('')
  const [because, setBecause] = useState([])
  const [result, setResult] = useState(null)
  const [why, setWhy] = useState('')
  const toggle = (f) => setBecause((b) => (b.includes(f) ? b.filter((x) => x !== f) : [...b, f]))

  const check = async (e) => {
    e.preventDefault()
    try {
      const r = await portal.order(session, pid, text, because)
      setResult(r)
      if (r.status === 'saved') onDone()
    } catch (err) {
      onError(err)
    }
  }
  const ack = async () => {
    try {
      const r = await portal.ack(session, result.order_id, why)
      setResult({ ...result, status: r.status })
      setWhy('')
      onDone()
    } catch (err) {
      onError(err)
    }
  }

  return (
    <section className="dc-block">
      <h3 className="dc-h3">New order</h3>
      <form className="dc-order" onSubmit={check}>
        <input placeholder="e.g. start heparin drip" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="dc-because">
          <span className="muted">This order relies on:</span>
          {FACTS.map((f) => (
            <label key={f} className="dc-radio">
              <input type="checkbox" checked={because.includes(f)} onChange={() => toggle(f)} /> {FACT_LABEL[f]}
            </label>
          ))}
        </div>
        <button className="dc-btn dc-btn-primary" type="submit" disabled={!text.trim()}>
          Check order
        </button>
      </form>
      {result?.status === 'saved' && <p className="dc-ok">Order {result.order_id} saved.</p>}
      {result?.status === 'needs_ack' && (
        <div className="dc-hold">
          <p className="dc-verify">VERIFICATION REQUIRED</p>
          {result.warnings.map((w) => (
            <div key={w.fact}>
              <p>
                This order relies on <strong>{FACT_LABEL[w.fact] || w.fact}</strong>. The records disagree:
              </p>
              <table className="dc-versions">
                <tbody>
                  {w.versions.map((v) => (
                    <tr key={v.resource_id}>
                      <td>{v.source_name}</td>
                      <td className="time">{v.recorded_date}</td>
                      <td>{v.value}</td>
                      <td className="dc-status">{STATUS_WORD[v.status] || v.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="dc-notice">{NOTICE}</p>
          <div className="dc-actions">
            <input placeholder="What did you check?" value={why} onChange={(e) => setWhy(e.target.value)} />
            <button className="dc-btn dc-btn-primary" disabled={!why.trim()} onClick={ack}>
              I have reviewed
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
