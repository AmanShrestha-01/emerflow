import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { factLabel, mins, unitLabel } from './format.js'
import { Sev } from './bits.jsx'
import { HOLD_NOTICE, HOLD_TITLE, HoldActions, holdSentence } from './ApprovalDrawer.jsx'

const STATE_LABEL = {
  incoming: 'On the way',
  waiting: 'Waiting',
  placed: 'Placed',
  held: 'Waiting on your decision',
  discharged: 'Discharged',
  transferred: 'Transferred',
}

export default function PatientDetail({ pid, st, lastMove, onClose, run }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const closeRef = useRef(null)
  const liveRow = st.patients.find((p) => p.pid === pid)
  const liveHold = st.holds.find((h) => h.pid === pid) || null
  const holdKey = liveHold?.hold_id || ''
  const rowKey = liveRow ? `${liveRow.state}|${liveRow.unit}` : ''

  useEffect(() => {
    let off = false
    setError(null)
    api
      .patient(pid)
      .then((d) => !off && setDetail(d))
      .catch((e) => !off && setError(e.message))
    return () => {
      off = true
    }
  }, [pid, holdKey, rowKey])

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener && opener.focus && document.contains(opener)) opener.focus()
    }
  }, [])

  const p = { ...(detail?.patient || {}), ...(liveRow || {}) }
  const hold = liveHold || (detail?.hold && holdKey ? detail.hold : null)
  const move = detail?.last_move || lastMove || null
  const sources = detail?.sources || []
  const conflictFacts = new Set((hold?.conflicts || []).map((c) => c.fact))

  // Facts to compare: the ones this move rests on first, then anything else the sources claim.
  const allFacts = []
  for (const f of [...(move?.because || []), ...(hold?.because || [])]) if (!allFacts.includes(f)) allFacts.push(f)
  for (const s of sources) for (const f of Object.keys(s.claims || {})) if (!allFacts.includes(f)) allFacts.push(f)
  const differs = (f) => {
    if (conflictFacts.has(f)) return true
    const vals = sources.map((s) => s.claims?.[f]).filter(Boolean)
    return vals.length > 1 && vals.some((v) => v.value !== vals[0].value || v.status !== vals[0].status)
  }
  const anyDisagree = allFacts.some(differs)
  const because = new Set(move?.because || hold?.because || [])

  return (
    <div className="pd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="pd" role="dialog" aria-modal="true" aria-label={`Patient ${pid}`}>
        <header className="pd-h">
          <Sev n={p.severity} big />
          <div className="pd-id">
            <div className="pd-pid">{pid}</div>
            <div className="pd-name">
              {p.name || 'Name not recorded'}
              {p.age != null ? `, ${p.age}` : ''}
            </div>
          </div>
          <button ref={closeRef} className="pd-close" onClick={onClose} aria-label="Close patient panel">
            Close
          </button>
        </header>

        <div className="pd-body">
          {error && !detail && <p className="pd-err">Could not load records for {pid}: {error}</p>}

          <dl className="pd-facts">
            <div>
              <dt>Reason for visit</dt>
              <dd>{p.complaint || '–'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className={`pd-state st-${p.state}`}>
                {STATE_LABEL[p.state] || p.state || '–'}
                {p.unit ? ` · ${unitLabel(p.unit)}` : ''}
              </dd>
            </div>
            <div>
              <dt>{p.state === 'incoming' ? 'ETA' : 'Waited'}</dt>
              <dd>{p.state === 'incoming' ? `${p.eta ?? '?'} min` : mins(p.waited || 0)}</dd>
            </div>
            <div>
              <dt>Tests and supplies</dt>
              <dd className="pd-needs">
                {p.needs_ct && 'CT scan'}
                {p.needs_ct && p.needs_blood && ', '}
                {p.needs_blood && 'blood'}
                {!p.needs_ct && !p.needs_blood && 'Nothing flagged'}
                {p.retriage && <span className="tag tag-retriage">recheck urgency?</span>}
              </dd>
            </div>
          </dl>

          {(p.need || p.note) && (
            <div className="pd-story">
              {p.need && (
                <p>
                  <span className="pd-story-k">Needs</span> {p.need}
                  {p.needs_surgery ? ' (surgery)' : ''}
                </p>
              )}
              {p.note && (
                <p>
                  <span className="pd-story-k">Why here</span> <q>{p.note}</q>
                  {p.note_by && <span className="pd-story-by"> decided by {p.note_by}</span>}
                </p>
              )}
            </div>
          )}

          {hold && (
            <div className="pd-hold" role="alert">
              <div className="pd-hold-t">{HOLD_TITLE}</div>
              <div className="pd-hold-n">{HOLD_NOTICE}</div>
              <div className="pd-hold-m">
                {holdSentence(hold).q} The move is paused and the bed is held back until you decide. A doctor can check both records in DeepChart.
              </div>
              <HoldActions h={hold} run={run} />
            </div>
          )}

          <section className="pd-sec">
            <h3>Last move</h3>
            {move ? (
              <>
                <p className="pd-move">
                  {hold ? 'Proposed move to ' : 'Moved to '}
                  {unitLabel(move.to_unit)}
                  {move.source && (
                    <span className="pd-src">
                      {move.source === 'fastlane' ? 'by the fast lane' : move.source === 'fallback' ? 'by the backup rules' : 'by the agents'}
                    </span>
                  )}
                </p>
                <div className="pd-because">
                  <span className="pd-because-k">This move relies on</span>
                  {(move.because || []).length === 0 && <span className="muted">no facts recorded</span>}
                  {(move.because || []).map((f) => (
                    <span key={f} className={`fact${differs(f) ? ' fact-differs' : ''}`}>
                      {factLabel(f)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">No bed yet. The agents have not placed this patient.</p>
            )}
          </section>

          <section className="pd-sec">
            <h3>Records check: what each source says</h3>
            {sources.length >= 1 ? (
              <>
                <p className={`pd-verdict${anyDisagree ? ' disagree' : ''}`}>
                  {anyDisagree
                    ? detail?.notice || HOLD_NOTICE
                    : `The ${sources.length} records agree on these facts.`}
                </p>
                <div className="rc" style={{ '--cols': sources.length }}>
                  <div className="rc-row rc-head">
                    <div className="rc-fact">Fact</div>
                    {sources.map((s, i) => (
                      <div key={i} className="rc-src">
                        <span className="rc-src-n">{s.source_name}</span>
                        <span className="rc-src-d">{s.recorded_date}</span>
                      </div>
                    ))}
                  </div>
                  {allFacts.map((f) => {
                    const d = differs(f)
                    return (
                      <div key={f} className={`rc-row${d ? ' rc-differs' : ''}`}>
                        <div className="rc-fact">
                          {factLabel(f)}
                          {because.has(f) && <span className="rc-used">the move relies on this</span>}
                          {d && <span className="rc-flag">records disagree</span>}
                        </div>
                        {sources.map((s, i) => {
                          const c = s.claims?.[f]
                          return (
                            <div key={i} className={`rc-cell${c ? "" : " rc-cell-gap"}`}>
                              {c ? (
                                <>
                                  <span className="rc-v">{c.value}</span>
                                  <span className="rc-s">{c.status}</span>
                                  <span className="rc-r">{c.resource_id}</span>
                                </>
                              ) : (
                                <span className="rc-gap">not mentioned</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : hold?.conflicts?.length ? (
              <ConflictsOnly conflicts={hold.conflicts} />
            ) : (
              <p className="muted">{detail ? 'No outside records were found for this patient.' : 'Loading records…'}</p>
            )}
            <p className="pd-foot">Both records are shown as found. The board never decides which one is right.</p>
          </section>
        </div>
      </aside>
    </div>
  )
}

// Fallback when only the hold's conflict versions are available.
function ConflictsOnly({ conflicts }) {
  return (
    <>
      <p className="pd-verdict disagree">{HOLD_NOTICE}</p>
      {conflicts.map((c) => (
        <div key={c.fact} className="rc" style={{ '--cols': c.versions?.length || 2 }}>
          <div className="rc-row rc-head">
            <div className="rc-fact">{factLabel(c.fact)}</div>
            {(c.versions || []).map((v, i) => (
              <div key={i} className="rc-src">
                <span className="rc-src-n">{v.source_name}</span>
                <span className="rc-src-d">{v.recorded_date}</span>
              </div>
            ))}
          </div>
          <div className="rc-row rc-differs">
            <div className="rc-fact">
              <span className="rc-flag">{c.reason || 'sources disagree'}</span>
            </div>
            {(c.versions || []).map((v, i) => (
              <div key={i} className="rc-cell">
                <span className="rc-v">{v.value}</span>
                <span className="rc-s">{v.status}</span>
                <span className="rc-r">{v.resource_id}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
