import { useState } from 'react'
import { api } from '../api.js'
import { actionLabel, factPhrase, simTime, unitLabel } from './format.js'
import { Sev } from './bits.jsx'

// Safety copy from CONTRACT.md: must appear verbatim on held items.
export const HOLD_TITLE = 'VERIFICATION REQUIRED'
export const HOLD_NOTICE = 'sources disagree; a human must resolve'

const SHOW = 3

function approvalSentence(a) {
  const cases = a.params?.case_ids?.length ? ` (${a.params.case_ids.join(', ')})` : ''
  switch (a.action) {
    case 'cancel_elective':
      return `Cancel tonight's planned surgeries${cases} so recovery beds can take ICU patients?`
    case 'call_in_staff':
      return `Call in ${a.params?.count || 2} off-duty nurses? They arrive 45 minutes after you approve.`
    case 'divert':
    case 'divert_ambulances':
      return 'Send new ambulances to other hospitals for now?'
    case 'transfer':
    case 'transfer_stable':
      return 'Transfer stable patients to a partner hospital?'
    default:
      return `${actionLabel(a.action)}?`
  }
}

export function holdSentence(h) {
  const facts = [...new Set((h.conflicts || []).map((c) => c.fact))]
  const about = facts.length ? facts.map(factPhrase).join(' and ') : 'a fact this move relies on'
  return { q: `Move ${h.pid} to ${unitLabel(h.to_unit)}?`, why: `Two records disagree about ${about}.` }
}

export default function ApprovalDrawer({ approvals = [], holds = [], patientsById, onSelect, run }) {
  const [all, setAll] = useState(false)
  const items = [...holds.map((h) => ({ type: 'hold', id: h.hold_id, h })), ...approvals.map((a) => ({ type: 'approval', id: a.approval_id, a }))]
  const n = items.length
  const shown = all ? items : items.slice(0, SHOW)
  return (
    <section className={`drawer${n ? ' drawer-open' : ''}`} aria-labelledby="drawer-h">
      <h2 className="drawer-h" id="drawer-h">
        Needs your decision
        {n > 0 && <span className="drawer-n">{n}</span>}
      </h2>
      {n === 0 ? (
        <p className="drawer-empty">Nothing right now. Risky moves and big actions, like cancelling surgery, will wait here for you.</p>
      ) : (
        <div className="drawer-cards">
          {shown.map((it) =>
            it.type === 'hold' ? (
              <HoldCard key={it.id} h={it.h} p={patientsById[it.h.pid]} onSelect={onSelect} run={run} />
            ) : (
              <ApprovalCard key={it.id} a={it.a} run={run} />
            ),
          )}
          {n > SHOW && (
            <button className="drawer-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? 'Show fewer' : `and ${n - SHOW} more`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export function ApprovalCard({ a, run }) {
  const [busy, setBusy] = useState(null)
  const act = async (approve) => {
    setBusy(approve ? 'approve' : 'reject')
    try {
      await run(() => api.resolveApproval(a.approval_id, approve), `${actionLabel(a.action)}: ${approve ? 'approved' : 'rejected'}`)
    } catch {
      setBusy(null)
    }
  }
  return (
    <article className="card card-approval">
      <p className="card-q">{approvalSentence(a)}</p>
      <p className="card-why">
        {a.reason}
        {a.detail ? `. ${a.detail.charAt(0).toUpperCase()}${a.detail.slice(1)}.` : ''}
      </p>
      <div className="card-actions">
        <button className="btn btn-primary" onClick={() => act(true)} disabled={!!busy}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button className="btn btn-quiet" onClick={() => act(false)} disabled={!!busy}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        {a.created_at != null && <span className="card-t time">{simTime(a.created_at)}</span>}
      </div>
    </article>
  )
}

// The records comparison for a held patient lives in DeepChart; the board links there.
export const deepchartHref = (h) => `/doctor?pid=${encodeURIComponent(h.pid)}&hold=${encodeURIComponent(h.hold_id)}`

export function HoldActions({ h, run, showLink = true }) {
  const [busy, setBusy] = useState(null)
  const act = async (outcome) => {
    setBusy(outcome)
    try {
      await run(() => api.resolveHold(h.hold_id, outcome), (r) => r?.detail || (outcome === 'proceed' ? `${h.pid} moved` : `${h.pid} stays put`))
    } catch {
      setBusy(null)
    }
  }
  return (
    <div className="card-actions">
      <button className="btn btn-hold" onClick={() => act('proceed')} disabled={!!busy}>
        {busy === 'proceed' ? 'Moving…' : 'Approve move'}
      </button>
      <button className="btn btn-quiet" onClick={() => act('cancel')} disabled={!!busy}>
        {busy === 'cancel' ? 'Cancelling…' : "Don't move"}
      </button>
      {showLink && (
        <a className="linkbtn card-compare" href={deepchartHref(h)}>
          Check records in DeepChart
        </a>
      )}
    </div>
  )
}

export function HoldCard({ h, p, onSelect, run }) {
  const s = holdSentence(h)
  return (
    <article className="card card-hold">
      <p className="card-safety">
        <strong>{HOLD_TITLE}</strong>: {HOLD_NOTICE}
      </p>
      <p className="card-q">
        {p && <Sev n={p.severity} />}
        <span>
          Move{' '}
          <button className="pidlink" onClick={() => onSelect(h.pid)} title="Open this patient on the board">
            {h.pid}
          </button>{' '}
          to {unitLabel(h.to_unit)}?
        </span>
      </p>
      <p className="card-why">{s.why}</p>
      <HoldActions h={h} run={run} />
    </article>
  )
}
