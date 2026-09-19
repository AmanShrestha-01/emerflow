import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import SwarmChat, { NamesContext } from './SwarmChat.jsx'
import { BusCrashButton, BusyNightButton, useScenario } from './scenario.jsx'
import { deepchartHref } from './ApprovalDrawer.jsx'
import { ModeBadge, ResultsDrawer } from './results.jsx'
import { factPhrase } from './format.js'

// The default screen for anyone watching: a list of patients, free beds, and what needs a person.
// No patient codes are shown anywhere on this view; names only.

const URGENCY = { 1: 'Critical', 2: 'Very urgent', 3: 'Urgent', 4: 'Standard', 5: 'Minor' }
const WHERE = {
  RESUS: 'Resuscitation room',
  ER: 'Emergency bed',
  HALLWAY: 'Hallway bed',
  ICU: 'Intensive care (ICU)',
  STEPDOWN: 'Step-down bed',
  WARD: 'Ward bed',
  OR: 'In surgery',
  PACU: 'Recovery room',
  LOUNGE: 'Discharge lounge',
  HOME: 'Gone home',
  PARTNER: 'Another hospital',
}
const TO_WORDS = {
  RESUS: 'the resuscitation room',
  ER: 'an emergency bed',
  HALLWAY: 'a hallway bed',
  ICU: 'an intensive care (ICU) bed',
  STEPDOWN: 'a step-down bed',
  WARD: 'a ward bed',
  OR: 'surgery',
  PACU: 'the recovery room',
  LOUNGE: 'the discharge lounge',
  HOME: 'home',
  PARTNER: 'another hospital',
}
const FREE_UNITS = [
  ['ER', 'Emergency'],
  ['ICU', 'Intensive care'],
  ['STEPDOWN', 'Step-down'],
  ['WARD', 'Ward'],
  ['OR', 'Surgery'],
]
// older backends use technical labels; say them in everyday words
const BY_WORDS = {
  'Fast lane (code)': 'Hospital rules',
  'Fallback (code)': 'Hospital rules',
  'Rules (code)': 'Hospital rules',
  'Agent plan': 'AI agents',
  'Records check (code)': 'Records check',
  'A human': 'A person',
  'A human (records checked)': 'A person (after checking the records)',
}
const SHOW_FIRST = 8
const RECENT = 10 // sim-minutes a move counts as recent
const sentence = (s = '') => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
const nameOf = (p) => p?.name || 'A patient'
const firstName = (p) => (p?.name ? p.name.split(' ')[0] : 'this patient')

export default function PlainView({ st, ev, run, onFull }) {
  const sc = useScenario(run)
  const [openPid, setOpenPid] = useState(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [everyone, setEveryone] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const clock = st.clock ?? 0

  const byPid = useMemo(() => Object.fromEntries((st.patients || []).map((p) => [p.pid, p])), [st.patients])
  const names = useMemo(() => Object.fromEntries((st.patients || []).filter((p) => p.name).map((p) => [p.pid, p.name])), [st.patients])
  const holdsByPid = useMemo(() => Object.fromEntries((st.holds || []).map((h) => [h.pid, h])), [st.holds])

  // recent moves and arrivals from the event log (newest first)
  const { moved, arrived, busCrash } = useMemo(() => {
    const moved = {}
    const arrived = new Set()
    let busCrash = false
    for (let i = ev.feed.length - 1; i >= 0; i--) {
      const e = ev.feed[i]
      const age = clock - (e.clock ?? 0)
      if (e.type === 'notice' && age <= 90 && /bus crash|mass casualty/i.test(e.data?.text || '')) busCrash = true
      if (st.bus_crash_at != null && clock - st.bus_crash_at <= 90) busCrash = true
      if (age > RECENT) continue
      if (e.type === 'move.applied' && !moved[e.data?.pid]) moved[e.data.pid] = { ...e.data, clock: e.clock }
      if (e.type === 'patient.arrived' && age <= 3) arrived.add(e.data?.pid)
    }
    return { moved, arrived, busCrash }
  }, [ev.feed, clock])

  const rows = useMemo(() => {
    const here = (st.patients || []).filter((p) => {
      if (p.state === 'discharged' || p.state === 'transferred') return !!moved[p.pid] // gone: show briefly
      return true
    })
    const rank = (p) => {
      // critical and still being sorted out (not settled in a bed for a while)
      if (p.severity === 1 && (p.state !== 'placed' || moved[p.pid])) return 0
      if (p.state === 'held') return 1
      if (p.state === 'waiting') return 2
      if (p.state === 'incoming') return 3
      if (moved[p.pid]) return 4
      return 5
    }
    return here.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.severity || 9) - (b.severity || 9) ||
        (moved[b.pid]?.clock ?? -1) - (moved[a.pid]?.clock ?? -1) ||
        (b.waited || 0) - (a.waited || 0),
    )
  }, [st.patients, moved])

  const incoming = (st.patients || []).filter((p) => p.state === 'incoming').length
  const busyLeft = st.busy_until != null ? st.busy_until - clock : 0
  let status = 'A normal evening'
  if (busCrash && incoming > 0) status = `Bus crash: ${incoming} patient${incoming === 1 ? '' : 's'} arriving`
  else if (busCrash) status = 'Bus crash: everyone has arrived'
  else if (busyLeft > 0) status = `Busy night · ${busyLeft} min left`

  // By default only what's happening now: arriving, waiting, needing an OK, or just moved.
  const active = rows.filter((p) => p.state !== 'placed' || moved[p.pid])
  const shown = everyone ? rows : active.slice(0, SHOW_FIRST)
  const decisions = [...(st.holds || []).map((h) => ({ type: 'hold', id: h.hold_id, h })), ...(st.approvals || []).map((a) => ({ type: 'approval', id: a.approval_id, a }))]
  const cycles = useMemo(() => {
    const m = {}
    for (const e of ev.feed) {
      if (e.type === 'cycle.start' && e.cycle_id) m[e.cycle_id] = { trigger: e.data?.trigger, clock: e.clock, done: false }
      if (e.type === 'cycle.end' && e.cycle_id) m[e.cycle_id] = { ...(m[e.cycle_id] || {}), done: true }
    }
    return m
  }, [ev.feed])

  return (
    <div className={`plain${decisions.length ? '' : ' plain-nodecide'}`}>
      <header className="p-hdr">
        <div className="p-brand">
          <span className="brand-cross" aria-hidden="true" />
          <span className="p-name">Emer Flow</span>
        </div>
        <div className="p-status" aria-live="polite">
          <span className="p-status-main">{status}</span>
          {(st.level ?? 0) >= 2 && <span className="p-status-full">The hospital is very full, so extra beds are in use</span>}
        </div>
        <div className="p-actions">
          <BusyNightButton st={st} sc={sc} />
          <BusCrashButton sc={sc} compact />
          <MoreMenu st={st} sc={sc} onFull={onFull} source={ev.source} onResults={() => setResultsOpen(true)} />
        </div>
      </header>

      <section className="p-bedcards" aria-label="Free beds">
        {FREE_UNITS.map(([id, label]) => {
          const u = (st.units || []).find((x) => x.unit === id)
          if (!u) return null
          const free = Math.max(0, (u.beds || 0) - (u.occupied || 0) - (u.reserved || 0))
          return (
            <div key={id} className={`p-bed p-bed-${id}${free === 0 ? ' full' : ''}`}>
              <span className="p-bed-name">{label}</span>
              <span className="p-bed-free">{free}</span>
              <span className="p-bed-of">{free === 0 ? 'full' : 'free'} · {u.beds} beds</span>
            </div>
          )
        })}
      </section>

      <main className="p-list" aria-label="Who goes where">
        <div className="p-list-head">
          <h2>Who goes where</h2>
          <button className="p-ai" onClick={() => setAiOpen(true)}>
            See how the AI decided
          </button>
        </div>
        {rows.length === 0 && <p className="p-empty">No patients right now. Everyday patients arrive every few minutes.</p>}
        <ul>
          {shown.map((p) => (
            <PatientRow key={p.pid} p={p} hold={holdsByPid[p.pid]} moved={moved[p.pid]} justArrived={arrived.has(p.pid)} onOpen={() => setOpenPid(p.pid)} />
          ))}
        </ul>
        {(everyone || rows.length > shown.length) && (
          <button className="p-more" onClick={() => setEveryone((v) => !v)} aria-expanded={everyone}>
            {everyone ? 'Show only what is happening now' : `Show everyone in the hospital (${rows.length})`}
          </button>
        )}
      </main>

      {decisions.length > 0 && <NeedsOk items={decisions} byPid={byPid} run={run} />}

      {openPid && byPid[openPid] && (
        <Sheet title={nameOf(byPid[openPid])} onClose={() => setOpenPid(null)}>
          <PatientSheet p={byPid[openPid]} hold={holdsByPid[openPid]} moved={moved[openPid]} justArrived={arrived.has(openPid)} run={run} />
        </Sheet>
      )}
      {resultsOpen && <ResultsDrawer onClose={() => setResultsOpen(false)} />}
      {aiOpen && (
        <Sheet title="How the AI decided" wide onClose={() => setAiOpen(false)}>
          <p className="p-ai-intro">
            Each hospital department has an AI agent. They report to a coordinator agent, which plans who goes where. Hospital rules check every move, and anything risky waits for a person.
          </p>
          <div className="p-ai-chat">
            <NamesContext.Provider value={names}>
              <SwarmChat messages={ev.messages} typing={ev.typing} cycles={cycles} onSelect={(pid) => byPid[pid] && (setAiOpen(false), setOpenPid(pid))} />
            </NamesContext.Provider>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function whereWords(p, hold) {
  if (p.state === 'held') return { text: 'Waiting: needs your OK', tone: 'ok' }
  if (p.state === 'incoming') return { text: `On the way by ambulance · ${p.eta ?? '?'} min`, tone: 'coming' }
  if (p.state === 'waiting') return { text: `Waiting for a bed · ${p.waited || 0} min`, tone: 'waiting' }
  if (p.state === 'discharged') return { text: 'Gone home', tone: 'gone' }
  if (p.state === 'transferred') return { text: 'Another hospital', tone: 'gone' }
  return { text: WHERE[p.unit] || 'In a bed', tone: 'placed', hold }
}

function whyWords(p, hold, moved, justArrived) {
  let note = p.note
  if (!note && hold) note = hold.sentence || `${firstName(p)} can't be moved yet: two hospitals' records disagree.`
  if (!note && (p.state === 'waiting' || p.state === 'incoming') && justArrived) note = 'Just arrived; waiting for a bed'
  const by = BY_WORDS[p.note_by] || p.note_by || (moved ? { fastlane: 'Hospital rules', swarm: 'AI agents', fallback: 'Hospital rules' }[moved.source] : '')
  return { note, by }
}

function PatientRow({ p, hold, moved, justArrived, onOpen }) {
  const sev = p.severity || 0
  const where = whereWords(p, hold)
  const target = p.state === 'held' && (hold?.to_unit || p.heading_to)
  return (
    <li>
      <button className={`p-row p-row1 p-sev-${sev}${p.state === 'held' ? ' p-row-ok' : ''}${justArrived || moved ? ' p-row-new' : ''}`}
        onClick={onOpen} title="See details">
        <span className={`p-dot dot-${sev}`} aria-label={URGENCY[sev] || ''} />
        <span className="p-who">{nameOf(p)}</span>
        <span className="p-what">{sentence(p.complaint)}</span>
        <span className="p-arrow" aria-hidden="true">→</span>
        <span className={`p-where where-${where.tone}`}>
          {target ? `${WHERE[target] || target} · needs your OK` : where.text}
        </span>
      </button>
    </li>
  )
}

function holdSentencePlain(h, p) {
  if (h.sentence) return h.sentence
  const facts = [...new Set((h.conflicts || []).map((c) => factPhrase(c.fact)))].join(' and ')
  return `${nameOf(p)} can't be moved to ${TO_WORDS[h.to_unit] || 'a new bed'} yet: two hospitals' records disagree about ${facts || 'something the move relies on'}.`
}
function approvalSentencePlain(a) {
  if (a.sentence) return a.sentence
  if (a.action === 'cancel_elective') return "Cancel tonight's planned operations so the recovery room can take intensive care patients?"
  if (a.action === 'call_in_staff') return "Call in 2 off-duty nurses? They'd arrive in about 45 minutes."
  if (/divert/.test(a.action)) return 'Send new ambulances to other hospitals for now?'
  if (/transfer/.test(a.action)) return 'Move stable patients to a partner hospital?'
  return `${sentence(String(a.action || '').replace(/_/g, ' '))}?`
}

function HoldButtons({ h, run }) {
  const [busy, setBusy] = useState(null)
  const act = async (outcome) => {
    setBusy(outcome)
    try {
      await run(() => api.resolveHold(h.hold_id, outcome), outcome === 'proceed' ? 'Moved' : 'Kept where they are')
    } catch {
      setBusy(null)
    }
  }
  return (
    <div className="p-btns">
      <a className="p-btn p-btn-quiet" href={deepchartHref(h)}>
        See both records
      </a>
      <button className="p-btn p-btn-go" onClick={() => act('proceed')} disabled={!!busy}>
        {busy === 'proceed' ? 'Moving…' : 'Move them'}
      </button>
      <button className="p-btn p-btn-quiet" onClick={() => act('cancel')} disabled={!!busy}>
        {busy === 'cancel' ? 'Keeping…' : 'Keep them here'}
      </button>
    </div>
  )
}

function ApprovalButtons({ a, run }) {
  const [busy, setBusy] = useState(null)
  const act = async (yes) => {
    setBusy(yes ? 'yes' : 'no')
    try {
      await run(() => api.resolveApproval(a.approval_id, yes), yes ? 'Approved' : 'Declined')
    } catch {
      setBusy(null)
    }
  }
  return (
    <div className="p-btns">
      <button className="p-btn p-btn-go" onClick={() => act(true)} disabled={!!busy}>
        {busy === 'yes' ? 'Saving…' : 'Yes'}
      </button>
      <button className="p-btn p-btn-quiet" onClick={() => act(false)} disabled={!!busy}>
        {busy === 'no' ? 'Saving…' : 'No'}
      </button>
    </div>
  )
}

function NeedsOk({ items, byPid, run }) {
  const [i, setI] = useState(0)
  const n = items.length
  const idx = Math.min(i, n - 1)
  const it = items[idx]
  return (
    <section className="p-ok" aria-labelledby="p-ok-h">
      <h2 id="p-ok-h" className="p-ok-h">
        Needs your OK <span>({idx + 1} of {n})</span>
      </h2>
      <div className="p-ok-body" key={it.id}>
        <p className="p-ok-text">{it.type === 'hold' ? holdSentencePlain(it.h, byPid[it.h.pid]) : approvalSentencePlain(it.a)}</p>
        {it.type === 'hold' ? <HoldButtons h={it.h} run={run} /> : <ApprovalButtons a={it.a} run={run} />}
      </div>
      {n > 1 && (
        <div className="p-pager">
          <button className="p-page" onClick={() => setI((idx - 1 + n) % n)} aria-label="Previous">
            ‹
          </button>
          <button className="p-page" onClick={() => setI((idx + 1) % n)} aria-label="Next">
            ›
          </button>
        </div>
      )}
    </section>
  )
}

function PatientSheet({ p, hold, moved, justArrived, run }) {
  const sev = p.severity || 0
  const where = whereWords(p, hold)
  const why = whyWords(p, hold, moved, justArrived)
  return (
    <div className="p-sheet">
      <p className="p-sheet-urg">
        <span className={`p-dot dot-${sev}`} aria-hidden="true" /> {URGENCY[sev] || 'Urgency not set'}
        {p.age != null ? `, age ${p.age}` : ''}
      </p>
      <dl className="p-facts">
        <dt>What's wrong</dt>
        <dd>{sentence(p.complaint) || 'Not recorded'}</dd>
        <dt>What they need</dt>
        <dd>{sentence(p.need) || 'Not decided yet'}</dd>
        <dt>Where they are</dt>
        <dd className={`where-${where.tone}`}>{where.text}</dd>
        {why.note && !hold && (
          <>
            <dt>Why</dt>
            <dd>
              {why.note}
              {why.by && <span className="p-by"> ({why.by})</span>}
            </dd>
          </>
        )}
      </dl>
      {hold && (
        <div className="p-sheet-ok">
          <p className="p-ok-text">{holdSentencePlain(hold, p)}</p>
          <HoldButtons h={hold} run={run} />
        </div>
      )}
    </div>
  )
}

function MoreMenu({ st, sc, onFull, source, onResults }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className="s-menu" ref={ref}>
      <button className="s-ctl p-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label="More" onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="s-pop p-pop" role="menu">
          <div className="p-pop-mode">
            <ModeBadge mode={st.mode} />
            {source === 'mock' && <span className="s-practice">practice data</span>}
          </div>
          {st.paused ? (
            <button role="menuitem" className="s-item" onClick={() => sc.control('resume', {}, 'Resumed')}>
              Resume the clock
            </button>
          ) : (
            <button role="menuitem" className="s-item" onClick={() => sc.control('pause', {}, 'Paused')}>
              Pause the clock
            </button>
          )}
          <p className="s-pop-k">Speed</p>
          <div className="s-pop-row">
            {[1, 2].map((sp) => (
              <button key={sp} role="menuitemradio" aria-checked={(st.speed || 1) === sp} className="s-chip" onClick={() => sc.control('speed', { speed: sp }, `Speed ${sp}×`)}>
                {sp}×
              </button>
            ))}
          </div>
          <button
            role="menuitem"
            className="s-item"
            onClick={() => {
              setOpen(false)
              onResults()
            }}
          >
            Results from this run
          </button>
          <button role="menuitem" className="s-item" onClick={onFull}>
            Full view (for staff)
          </button>
          <button role="menuitem" className={`s-item${sc.armReset ? ' danger' : ''}`} onClick={sc.reset}>
            {sc.armReset ? 'Click again to reset' : 'Reset the simulation'}
          </button>
        </div>
      )}
    </div>
  )
}

function Sheet({ title, onClose, wide, children }) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const prev = document.activeElement
    ref.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return (
    <div className="pd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`pd p-sheet-panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="pd-h">
          <h2 className="p-sheet-t">{title}</h2>
          <button ref={ref} className="pd-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="p-sheet-body">{children}</div>
      </aside>
    </div>
  )
}
