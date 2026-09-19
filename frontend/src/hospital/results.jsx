import { useEffect, useRef, useState } from 'react'
import { api, isMock } from '../api.js'

// Which brain is running the agents, in plain words.
const MODE_LABEL = {
  live: 'Live on Gemini',
  replay: 'Replay of a live Gemini run',
  stub: 'Offline rules',
  fallback: 'Gemini unavailable, rules running',
}
export function ModeBadge({ mode }) {
  const label = MODE_LABEL[mode]
  if (!label) return null
  return <span className={`mode mode-${mode}`}>{label}</span>
}

export function ResultsButton({ className = 's-full' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        Results
      </button>
      {open && <ResultsDrawer onClose={() => setOpen(false)} />}
    </>
  )
}

const n = (v) => (v == null || Number.isNaN(v) ? '–' : v)
const answers = (k) => `${k} answer${k === 1 ? '' : 's'}`

// The numbers from this run, refreshed every 10 s while shown. Used as a drawer and as a page.
export function ResultsContent() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let off = false
    const load = () =>
      api
        .results()
        .then((d) => {
          if (off) return
          if (!d || typeof d !== 'object' || !d.records) throw new Error('unexpected reply')
          setData(d)
          setError(null)
        })
        .catch(() => !off && setError('Results are not available from this server yet.'))
    load()
    const t = setInterval(load, 10000)
    return () => {
      off = true
      clearInterval(t)
    }
  }, [])
  const r = data?.records || {}
  const t = data?.time_to_bed || {}
  const a = data?.agents || {}
  const ans = a.answers || {}
  const rules = (ans.fallback || 0) + (ans.stub || 0)
  const mock = isMock()
  return (
    <>
          {!data && !error && <p className="muted">Loading…</p>}
      {error && !data && <p className="muted">{error}</p>}
      {data && (
        <>
          {data.records?.records_check !== false && data.records_check !== false && (
          <section className="rblock rblock-records">
            <p className="rbig">
              {n(r.caught_before_moving)} <span>of {n(r.on_arrived_patients)}</span>
            </p>
            <h3>Record mistakes caught before a patient moved</h3>
            <p className="rcap">We planted these mistakes ourselves, so we know the right answer.</p>
            <p className="rsmall">
              {n(r.waiting_for_a_human)} waiting for a human, {n(r.resolved_by_a_human)} resolved by a human
            </p>
          </section>
          )}

          <section className="rblock">
            <p className="rbig">
              {n(t['1']?.max_min)} <span>min</span>
            </p>
            <h3>Time to a bed</h3>
            <p className="rcap">The longest any of the most critical patients waited.</p>
            <table className="rtable">
              <tbody>
                <tr>
                  <th scope="row">Most urgent (1)</th>
                  <td>longest {n(t['1']?.max_min)} min</td>
                </tr>
                <tr>
                  <th scope="row">Urgency 2</th>
                  <td>average {n(t['2']?.avg_min)} min</td>
                </tr>
                <tr>
                  <th scope="row">Urgency 3</th>
                  <td>average {n(t['3']?.avg_min)} min</td>
                </tr>
                <tr>
                  <th scope="row">Urgency 4 and 5</th>
                  <td>average {n(t['4-5']?.avg_min)} min</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rblock">
            <p className="rbig">
              {n(a.agents)} <span>AI agents</span>
            </p>
            <h3>The agents</h3>
            <p className="rcap">
              {n(a.cycles)} round{a.cycles === 1 ? '' : 's'}, about {n(a.avg_cycle_seconds)} s per round
            </p>
            <ul className="rlist">
              {ans.live > 0 && <li>{answers(ans.live)} from Gemini live</li>}
              {ans.replay > 0 && <li>{answers(ans.replay)} replayed from a recorded Gemini run</li>}
              {rules > 0 && <li>{answers(rules)} from the rules when Gemini was slow or offline</li>}
              {!ans.live && !ans.replay && !rules && <li>No answers yet</li>}
            </ul>
          </section>

          {data.note && <p className="rnote">{data.note}</p>}
        </>
      )}
      <section className="raudit">
        {mock ? (
          <span className="linkbtn is-disabled" title="The audit log downloads from the live server, not in practice mode" aria-disabled="true">
            Download audit log (CSV)
          </span>
        ) : (
          <a className="linkbtn" href="/api/audit.csv" download="emerflow-audit.csv">
            Download audit log (CSV)
          </a>
        )}
        <p className="rcap">Every decision: who proposed it, what code checked, what a human approved.</p>
      </section>
    </>
  )
}

export function ResultsDrawer({ onClose }) {
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const prev = document.activeElement
    closeRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return (
    <div className="pd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="pd s-drawer results" role="dialog" aria-modal="true" aria-label="Results">
        <header className="pd-h">
          <h2 className="s-drawer-t">Results from this run</h2>
          <button ref={closeRef} className="pd-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="s-drawer-body res-body">
          <ResultsContent />
        </div>
      </aside>
    </div>
  )
}
