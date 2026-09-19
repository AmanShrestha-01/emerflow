import { useCallback, useEffect, useState } from 'react'
import { Sev } from '../hospital/bits.jsx'
import { FACT_LABEL, FACT_TECH, FACTS, REASONS, loadSession, portal, saveSession, unitWord } from './portalApi.js'
import Login from '../auth/Login.jsx'
import { HOME, landing, logout } from '../auth/session.js'
import './deepchart.css'

const NOTICE = 'sources disagree; a human must resolve'
// Deep link from the board: /doctor?pid=MC-03&hold=H12 (optionally &pin=demo for the demo).
const DEEP = (() => {
  const q = new URLSearchParams(window.location.search)
  return { pid: q.get('pid'), hold: q.get('hold'), pin: q.get('pin') }
})()
const STATE_WORD = {
  incoming: 'on the way',
  waiting: 'waiting for a bed',
  held: 'waiting: records being checked',
  placed: 'in a bed',
}
const STATUS_WORD = { active: 'ACTIVE', present: 'PRESENT', stopped: 'STOPPED', absent: 'NONE RECORDED' }

// ---------------------------------------------------------------- shell
// Uses the app's one staff login (src/auth). DeepChart itself is for doctors.
export default function DoctorPortal() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [who, setWho] = useState(null)
  useEffect(() => {
    const stored = loadSession()
    const done = (s) => {
      saveSession(s)
      setSession(s)
      setReady(true)
    }
    if (DEEP.pin) {
      // demo deep link: always start from a fresh login, never a token from before a restart
      portal
        .login(HOME, 'doctor', DEEP.pin)
        .then(done)
        .catch(() => done(null))
    } else if (stored) {
      portal
        .me(stored)
        .then(() => done(stored))
        .catch(() => done(null))
    } else {
      done(null)
    }
  }, [])
  useEffect(() => {
    if (!DEEP.pid) return
    fetch('/api/state')
      .then((r) => r.json())
      .then((st) => setWho((st.patients || []).find((p) => p.pid === DEEP.pid)?.name || null))
      .catch(() => {})
  }, [])
  const onError = useCallback((e) => {
    if (e?.status === 401) {
      saveSession(null)
      setSession(null)
    }
  }, [])

  if (!ready) return <p className="dc-empty">Loading…</p>
  if (!session || session.role !== 'doctor') {
    const ask = DEEP.pid
      ? `The board is asking you to check ${who || 'a patient'}'s records. Log in as a doctor to open their chart.`
      : session
        ? 'DeepChart is for doctors. Log in as a doctor to open patient records.'
        : null
    return (
      <Login
        presetRole="doctor"
        banner={ask}
        next={window.location.pathname + window.location.search}
        onIn={(s) => (s.role === 'doctor' ? setSession(s) : window.location.assign(landing(s)))}
      />
    )
  }
  return (
    <div className="dc">
      <header className="dc-top">
        <div>
          <h1 className="dc-title">DeepChart</h1>
          <p className="dc-sub">Doctor · {session.hospital}</p>
        </div>
        <nav className="dc-nav">
          {session.hospital === HOME && (
            <a className="linkbtn" href="/">
              Command board
            </a>
          )}
          <button className="linkbtn" onClick={logout}>
            Log out
          </button>
        </nav>
      </header>
      {session.hospital === HOME && <HomeDesk session={session} onError={onError} />}
      {session.hospital === 'Fells Point Heart Institute' && <SenderDesk session={session} onError={onError} />}
      {session.hospital === 'Hampden Family Health' && (
        <p className="dc-empty">Hampden Family Health only holds records in this demo. Log in to {HOME} or Fells Point Heart Institute.</p>
      )}
    </div>
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

// ---------------------------------------------------------------- Fells Point Heart Institute: send a transfer
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
      await portal.transfer(session, pid, HOME)
      setMsg(`Sent ${rows.find((r) => r.pid === pid)?.name || 'the patient'} to ${HOME}, with this hospital's record attached.`)
      setRows(await portal.patients(session))
    } catch (e) {
      setMsg(e.message)
      onError(e)
    }
  }
  if (session.role !== 'doctor') return <p className="dc-empty">The portal is for doctors. Commanders use the board.</p>
  return (
    <main className="dc-single">
      <h2 className="dc-h2">Your patients at Fells Point Heart Institute</h2>
      {msg && <p className="dc-toast">{msg}</p>}
      <ul className="dc-list">
        {rows.map((p) => (
          <li key={p.pid} className="dc-row">
            <Sev n={p.severity} />
            <span className="dc-row-main">
              <strong>{p.name}</strong>, {p.age} · {p.complaint} <Code id={p.pid} />
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

// ---------------------------------------------------------------- Johns Hopkins Hospital: the desk
function HomeDesk({ session, onError }) {
  const [rows, setRows] = useState([])
  const [inbox, setInbox] = useState([])
  const [filter, setFilter] = useState('')
  const [onlyFlags, setOnlyFlags] = useState(true)
  const [pid, setPid] = useState(DEEP.pid)

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
      (!onlyFlags || p.held || p.conflicts > 0 || p.pid === pid || inbox.some((t) => t.pid === p.pid)) &&
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
                    <span className="dc-row-main">
                      <strong>{t.name}</strong> from {t.from_hospital} <Code id={t.pid} />
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
            <input placeholder="Search by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
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
                  <span className="dc-row-main">
                    <strong>{p.name}</strong> · {p.complaint} <Code id={p.pid} />
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
          <Workspace
            key={pid}
            pid={pid}
            session={session}
            onError={onError}
            initialReason={pid === DEEP.pid ? 'er' : ''}
          />
        ) : (
          <p className="dc-empty">Pick a patient. Held patients and record conflicts are listed first.</p>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------- one patient
function Workspace({ pid, session, onError, initialReason = '' }) {
  const [reason, setReason] = useState(initialReason)
  const [resolved, setResolved] = useState(null)
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

  useEffect(() => {
    if (initialReason) loadChart(initialReason)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const r = await portal.resolveHold(session, pid, chart.hold.hold_id, outcome, reason)
      setResolved(r)
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
              {p.name}, {p.age}
              <span className="muted"> · {p.unit ? unitWord(p.unit) : STATE_WORD[p.state] || p.state}</span>{' '}
              <Code id={pid} />
            </>
          ) : (
            <span className="muted">Loading…</span>
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
          {resolved && (
            <section className={`dc-resolved is-${resolved.outcome}`}>
              <p>
                <strong>{resolved.outcome === 'proceed' ? 'Move released.' : 'Move stopped.'}</strong> {resolved.detail}
              </p>
              <a className="dc-btn dc-btn-primary" href="/">
                Back to the board
              </a>
            </section>
          )}
          {chart.hold && (
            <section className="dc-hold">
              <p className="dc-verify">VERIFICATION REQUIRED</p>
              <p>
                The board is holding a move to <strong>{unitWord(chart.hold.to_unit)}</strong>. It relies on:{' '}
                {chart.hold.because.map((f) => (FACT_LABEL[f] || f).toLowerCase()).join(', ')}.
              </p>
              {chart.hold.conflicts.map((c) => (
                <div key={c.fact} className="dc-hold-conflict">
                  <p>
                    <Fact f={c.fact} />: {c.reason}
                  </p>
                  <Versions versions={c.versions} />
                </div>
              ))}
              <p className="dc-notice">{NOTICE}</p>
              <div className="dc-actions">
                <button className="dc-btn dc-btn-primary" onClick={() => resolve('proceed')}>
                  Records checked — move to {unitWord(chart.hold.to_unit)}
                </button>
                <button className="dc-btn" onClick={() => resolve('cancel')}>
                  Don&apos;t move
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
            <Fact f={f.fact} />
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
              <input type="checkbox" checked={because.includes(f)} onChange={() => toggle(f)} />{' '}
              <span title={FACT_TECH[f]}>{FACT_LABEL[f]}</span>
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
                This order relies on <Fact f={w.fact} />. The records disagree:
              </p>
              <Versions versions={w.versions} />
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

function Versions({ versions }) {
  return (
    <table className="dc-versions">
      <tbody>
        {versions.map((v) => (
          <tr key={v.resource_id}>
            <td>{v.source_name}</td>
            <td className="time">{v.recorded_date}</td>
            <td>{v.value}</td>
            <td className="dc-status">{STATUS_WORD[v.status] || v.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Code({ id }) {
  return (
    <span className="dc-code" title="Record number">
      {id}
    </span>
  )
}

function Fact({ f }) {
  return (
    <strong title={FACT_TECH[f] ? `Clinical term: ${FACT_TECH[f]}` : undefined}>{FACT_LABEL[f] || f}</strong>
  )
}
