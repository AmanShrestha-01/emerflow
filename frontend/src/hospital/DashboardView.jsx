import { useMemo, useRef, useState } from 'react'
import { NamesContext } from './SwarmChat.jsx'
import SwarmRoom from './SwarmRoom.jsx'
import AiWorkflowPage from './AiWorkflowPage.jsx'
import PlainView, {
  ApprovalButtons,
  approvalSentencePlain,
  firstName,
  HoldButtons,
  holdSentencePlain,
  MoreMenu,
  nameOf,
  PatientSheet,
  sentence,
  Sheet,
  statusPhrase,
  URGENCY,
  useRecent,
  WHERE,
} from './PlainView.jsx'
import { BusCrashButton, BusyNightButton, useScenario } from './scenario.jsx'
import { ModeBadge, ResultsContent } from './results.jsx'
import { UNIT_DEPT } from './format.js'

// Hospital dashboard: sidebar pages, KPI cards, a bed board (every bed a tile), decisions and arrivals.
// Names only, never patient codes.

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'workflow', label: 'AI workflow', icon: 'flow' },
  { id: 'beds', label: 'Beds', icon: 'bed' },
  { id: 'patients', label: 'Patients', icon: 'people' },
  { id: 'ok', label: 'Big decisions', icon: 'hand' },
  { id: 'ai', label: 'How the AI decided', icon: 'chat' },
]
const TITLES = { dashboard: 'Dashboard', workflow: 'AI workflow', beds: 'Beds', patients: 'Patients', ok: 'Big decisions for you', ai: 'How the AI decided', results: 'Results from this run' }

const GROUPS = ['RESUS', 'ER', 'ICU', 'STEPDOWN', 'WARD', 'OR', 'PACU']
const ONLY_IF_USED = ['HALLWAY', 'LOUNGE']
const GROUP_NAME = {
  RESUS: 'Critical care room',
  ER: 'Emergency',
  ICU: 'Intensive care',
  STEPDOWN: 'Close-watch beds',
  WARD: 'Ward',
  OR: 'Surgery',
  PACU: 'Recovery',
  HALLWAY: 'Extra hallway beds',
  LOUNGE: 'Going-home lounge',
}
const BED_PREFIX = { RESUS: 'Critical', ER: 'ER', ICU: 'ICU', STEPDOWN: 'Close-watch', WARD: 'Ward', OR: 'Surgery', PACU: 'Recovery', HALLWAY: 'Hallway', LOUNGE: 'Lounge' }
const FREE_UNITS = ['ER', 'ICU', 'STEPDOWN', 'WARD', 'OR']
const RECENT = 10

const freeIn = (u) => Math.max(0, (u.beds || 0) - (u.occupied || 0) - (u.reserved || 0))

export default function DashboardView({ st, ev, run, onFull }) {
  const sc = useScenario(run)
  const [page, setPage] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('page')
    return PAGES.some((p) => p.id === q) ? q : 'dashboard'
  })
  const [openPid, setOpenPid] = useState(null)
  const { moved, arrived, busCrash } = useRecent(st, ev.feed)
  const byPid = useMemo(() => Object.fromEntries((st.patients || []).map((p) => [p.pid, p])), [st.patients])
  const holdsByPid = useMemo(() => Object.fromEntries((st.holds || []).map((h) => [h.pid, h])), [st.holds])
  const names = useMemo(() => Object.fromEntries((st.patients || []).filter((p) => p.name).map((p) => [p.pid, p.name])), [st.patients])
  const beds = useBedSlots(st.units || [], byPid)
  const decisions = [...(st.holds || []).map((h) => ({ type: 'hold', id: h.hold_id, h })), ...(st.approvals || []).map((a) => ({ type: 'approval', id: a.approval_id, a }))]
  const status = statusPhrase(st, busCrash)
  const cycles = useMemo(() => {
    const m = {}
    for (const e of ev.feed) {
      if (e.type === 'cycle.start' && e.cycle_id) m[e.cycle_id] = { trigger: e.data?.trigger, clock: e.clock, done: false }
      if (e.type === 'cycle.end' && e.cycle_id) m[e.cycle_id] = { ...(m[e.cycle_id] || {}), done: true }
    }
    return m
  }, [ev.feed])
  const open = (pid) => byPid[pid] && setOpenPid(pid)

  return (
    <div className="dash">
      <nav className="d-side" aria-label="Pages">
        <div className="d-logo">
          <span className="d-cross" aria-hidden="true" />
          <span className="d-logo-t">Emer Flow</span>
        </div>
        <ul className="d-nav">
          {PAGES.map((p) => (
            <li key={p.id}>
              <button className={`d-navbtn${page === p.id ? ' on' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)} title={p.label}>
                <Icon name={p.icon} />
                <span className="d-navlabel">{p.label}</span>
                {p.id === 'ok' && decisions.length > 0 && <span className="d-badge">{decisions.length}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="d-side-foot">
          <ModeBadge mode={st.mode} />
          {ev.source === 'mock' && <span className="d-practice">Practice data</span>}
          <div className="d-side-links">
            <button onClick={onFull}>Full view</button>
            <button onClick={sc.reset} className={sc.armReset ? 'armed' : ''}>
              {sc.armReset ? 'Click again to reset' : 'Reset'}
            </button>
          </div>
        </div>
      </nav>

      <div className="d-main">
        <header className="d-hdr">
          <div className="d-titles">
            <h1 className="d-title">{TITLES[page]}</h1>
            <p className="d-status" aria-live="polite">
              {status}
              {(st.level ?? 0) >= 2 && <span className="d-full">The hospital is very full, so extra beds are in use</span>}
            </p>
          </div>
          <div className="d-actions">
            <button className={`d-wfbtn${page === 'workflow' ? ' on' : ''}`} onClick={() => setPage('workflow')}>
              <Icon name="flow" /> AI workflow
            </button>
            <BusyNightButton st={st} sc={sc} />
            <BusCrashButton sc={sc} compact />
            <MoreMenu st={st} sc={sc} onFull={onFull} source={ev.source} onResults={() => setPage('results')} />
          </div>
        </header>

        {page === 'dashboard' && (
          <>
            <Kpis st={st} decisions={decisions.length} onPage={setPage} />
            <div className="d-grid">
              <section className="d-panel d-beds" aria-labelledby="d-beds-h">
                <div className="d-panel-h">
                  <h2 id="d-beds-h">Beds</h2>
                  <Legend />
                </div>
                <BedBoard groups={beds} compact onOpen={open} />
              </section>
              <div className="d-right">
                <section className="d-panel d-ok" aria-labelledby="d-ok-h">
                  <div className="d-panel-h">
                    <h2 id="d-ok-h">Big decisions for you</h2>
                    {decisions.length > 3 && (
                      <button className="d-link" onClick={() => setPage('ok')}>
                        See all {decisions.length}
                      </button>
                    )}
                  </div>
                  <OkCards items={decisions.slice(0, 3)} byPid={byPid} run={run} empty="Nothing to decide right now." />
                </section>
                <section className="d-panel d-arr" aria-labelledby="d-arr-h">
                  <div className="d-panel-h">
                    <h2 id="d-arr-h">Arriving now</h2>
                    <button className="d-link" onClick={() => setPage('patients')}>
                      All patients
                    </button>
                  </div>
                  <ArrivalsTable st={st} moved={moved} onOpen={open} />
                </section>
              </div>
            </div>
          </>
        )}
        {page === 'beds' && (
          <section className="d-panel d-page" aria-label="All beds">
            <div className="d-panel-h">
              <Legend />
            </div>
            <BedBoard groups={beds} onOpen={open} />
          </section>
        )}
        {page === 'patients' && (
          <section className="d-panel d-page d-patients">
            <PlainView st={st} ev={ev} run={run} onFull={onFull} embedded />
          </section>
        )}
        {page === 'ok' && (
          <section className="d-panel d-page">
            <OkCards items={decisions} byPid={byPid} run={run} wide empty="Nothing needs you right now. When a big decision comes up, like calling in extra nurses, it waits here." />
          </section>
        )}
        {page === 'ai' && (
          <section className="d-panel d-page d-ai">
            <p className="d-ai-intro">
              Each department has an AI agent. They report to a coordinator agent, which plans who goes where. Hospital rules check every move, and anything risky waits for a person.
            </p>
            <div className="d-ai-chat">
              <NamesContext.Provider value={names}>
                <SwarmRoom messages={ev.messages} typing={ev.typing} pulses={ev.pulses} cycles={cycles} onSelect={open} />
              </NamesContext.Provider>
            </div>
          </section>
        )}
        {page === 'workflow' && (
          <section className="d-panel d-page">
            <AiWorkflowPage st={st} ev={ev} />
          </section>
        )}
        {page === 'results' && (
          <section className="d-panel d-page d-results">
            <ResultsContent />
          </section>
        )}
      </div>

      {openPid && byPid[openPid] && (
        <Sheet title={nameOf(byPid[openPid])} onClose={() => setOpenPid(null)}>
          <PatientSheet p={byPid[openPid]} hold={holdsByPid[openPid]} moved={moved[openPid]} justArrived={arrived.has(openPid)} run={run} />
        </Sheet>
      )}
    </div>
  )
}

// ---------- KPI cards ----------
function Kpis({ st, decisions, onPage }) {
  const units = st.units || []
  const free = units.filter((u) => FREE_UNITS.includes(u.unit)).reduce((a, u) => a + freeIn(u), 0)
  const ps = st.patients || []
  const waiting = st.metrics?.waiting ?? ps.filter((p) => p.state === 'waiting').length
  const incoming = ps.filter((p) => p.state === 'incoming')
  const nextEta = incoming.length ? Math.min(...incoming.map((p) => p.eta ?? 99)) : null
  const longest = st.metrics?.longest_wait
  const cards = [
    { k: 'Free beds', v: free, icon: 'bed', tone: free === 0 ? 'crit' : 'ok', cap: free ? `${free} free across the main units` : 'The main units are full', page: 'beds' },
    { k: 'Waiting for a bed', v: waiting, icon: 'clock', tone: waiting > 0 ? 'plain' : 'ok', cap: waiting && longest != null ? `Longest wait ${longest} min` : 'No one is waiting', page: 'patients' },
    { k: 'Big decisions for you', v: decisions, icon: 'hand', tone: decisions ? 'you' : 'ok', cap: decisions ? 'The AI can\'t do these without you' : 'Nothing to decide', page: 'ok' },
    { k: 'Arriving by ambulance', v: incoming.length, icon: 'ambulance', tone: 'blue', cap: nextEta != null ? `Next one in ${nextEta} min` : 'None on the way', page: 'patients' },
  ]
  return (
    <section className="d-kpis" aria-label="Key numbers">
      {cards.map((c) => (
        <button key={c.k} className={`d-kpi kpi-${c.tone}`} onClick={() => onPage(c.page)}>
          <span className="d-kpi-icon">
            <Icon name={c.icon} />
          </span>
          <span className="d-kpi-body">
            <span className="d-kpi-k">{c.k}</span>
            <span className="d-kpi-v">{c.v}</span>
            <span className="d-kpi-cap">{c.cap}</span>
          </span>
        </button>
      ))}
    </section>
  )
}

// ---------- stable bed numbers ----------
// The API lists occupants in no fixed order. Keep each patient in the same numbered bed while they stay.
function useBedSlots(units, byPid) {
  const slotsRef = useRef({})
  return useMemo(() => {
    const byUnit = Object.fromEntries(units.map((u) => [u.unit, u]))
    const order = [...GROUPS, ...ONLY_IF_USED.filter((id) => (byUnit[id]?.occupied || 0) + (byUnit[id]?.reserved || 0) > 0)]
    const groups = []
    for (const id of order) {
      const u = byUnit[id]
      if (!u) continue
      const occupants = u.occupants || []
      const reservedFor = u.reserved_for || []
      const keys = [...occupants, ...reservedFor]
      const present = new Set(keys)
      let slots = (slotsRef.current[id] || []).map((k) => (k && present.has(k) ? k : null))
      const placed = new Set(slots.filter(Boolean))
      for (const k of keys) {
        if (placed.has(k)) continue
        let i = slots.indexOf(null)
        if (i < 0 || i >= Math.max(u.beds, slots.length)) i = slots.length
        slots[i] = k
        placed.add(k)
      }
      while (slots.length > u.beds && slots[slots.length - 1] == null) slots.pop()
      slotsRef.current[id] = slots
      // occupied beds the API doesn't name: fill the highest empty beds
      let anon = Math.max(0, (u.occupied || 0) - occupants.length)
      const total = Math.max(u.beds, slots.length)
      const anonSlots = new Set()
      for (let i = Math.min(total, u.beds) - 1; i >= 0 && anon > 0; i--) {
        if (!slots[i]) {
          anonSlots.add(i)
          anon--
        }
      }
      const resSet = new Set(reservedFor)
      const tiles = []
      for (let i = 0; i < total; i++) {
        const key = slots[i] || null
        const label = `${BED_PREFIX[id] || id} ${i + 1}`
        const pre = BED_PREFIX[id] || id
        const num = i + 1
        const over = i >= u.beds
        if (!key) {
          tiles.push({ label, pre, num, kind: anonSlots.has(i) ? 'occ' : 'empty', over })
          continue
        }
        if (String(key).startsWith('case:')) {
          tiles.push({ label, pre, num, kind: 'booked', over })
          continue
        }
        const p = byPid[key]
        if (resSet.has(key)) tiles.push({ label, pre, num, kind: p?.state === 'held' ? 'held' : 'reserved', p, over })
        else tiles.push({ label, pre, num, kind: 'occ', p, over, leaving: p?.state === 'held' })
      }
      groups.push({ id, name: GROUP_NAME[id] || id, dept: UNIT_DEPT[id] || 'OTHER', beds: u.beds, free: freeIn(u), tiles })
    }
    return groups
  }, [units, byPid])
}

function BedBoard({ groups, compact, onOpen }) {
  // tiles remount when their status changes (see key); only ring them after the first render
  const born = useRef(Date.now())
  const ring = Date.now() - born.current > 1500
  return (
    <div className={`d-board${compact ? ' compact' : ''}`}>
      {groups.map((g) => (
        <section key={g.id} className={`d-group dept-${g.dept}`} aria-label={g.name}>
          <h3 className="d-group-h">
            <span className="d-group-name">{g.name}</span>
            <span className={`d-group-free${g.free === 0 ? ' none' : ''}`}>
              {g.free} of {g.beds} free
            </span>
          </h3>
          <div className="d-tiles">
            {g.tiles.map((t) => (
              <Tile key={`${t.label}|${t.kind}|${t.p?.pid || ''}`} t={t} ring={ring} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Tile({ t, ring, onOpen }) {
  // Decide once, when the tile first appears: only a tile that appeared after the board settled (its
  // status just changed, so it re-mounted) rings. Existing tiles never pick the ring up later.
  const [fresh] = useState(ring)
  const p = t.p
  let word = 'Empty'
  let who = null
  let small = null
  let kind = t.kind
  if (t.over) kind = t.kind === 'empty' ? 'empty' : 'over'
  if (t.over && p) small = `Extra bed: ${sentence(p.complaint)}`
  if (t.kind === 'occ') {
    word = t.over ? 'Extra bed' : 'Occupied'
    who = p ? nameOf(p) : null
    small = p ? sentence(p.complaint) : null
    if (t.leaving) small = 'Move waiting on your OK'
  } else if (t.kind === 'held') {
    word = `Held for ${firstName(p)}`
    small = 'needs your OK'
  } else if (t.kind === 'reserved') {
    word = p ? `Kept for ${firstName(p)}` : 'Kept for a patient'
    small = 'On the way'
  } else if (t.kind === 'booked') {
    word = 'Booked'
    small = 'Planned surgery'
  }
  const title = p ? `${nameOf(p)}${p.age != null ? `, ${p.age}` : ''}: ${sentence(p.complaint)}${p.need ? `. Needs: ${p.need}` : ''}` : `${t.label}: ${word}`
  const cls = `d-tile tile-${kind}${t.leaving ? ' leaving' : ''}${fresh ? ' ring' : ''}`
  const body = (
    <>
      <span className="d-tile-num" aria-label={t.label}>
        <span className="d-tile-pre">{t.pre}</span>
        <span className="d-tile-n">{t.num}</span>
      </span>
      <span className="d-tile-info">
        <span className="d-tile-word">
          {p && t.kind === 'occ' && <span className={`p-dot dot-${p.severity || 0}`} aria-label={URGENCY[p.severity] || ''} />}
          {who || word}
        </span>
        {small && <span className="d-tile-small">{small}</span>}
      </span>
    </>
  )
  return p ? (
    <button className={cls} title={title} onClick={() => onOpen(p.pid)}>
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  )
}

function Legend() {
  return (
    <ul className="d-legend" aria-label="Bed colours">
      <li>
        <i className="lg-empty" /> Empty
      </li>
      <li>
        <i className="lg-occ" /> Occupied
      </li>
      <li>
        <i className="lg-booked" /> Booked
      </li>
      <li>
        <i className="lg-over" /> Over capacity
      </li>
    </ul>
  )
}

// ---------- decisions ----------
function OkCards({ items, byPid, run, empty, wide }) {
  if (!items.length) return <p className="d-empty">{empty}</p>
  return (
    <div className={`d-okcards${wide ? ' wide' : ''}`}>
      {items.map((it) => (
        <article key={it.id} className={`d-okcard ${it.type === 'hold' ? 'hold' : 'approval'}`}>
          <p className="d-okcard-t">{it.type === 'hold' ? holdSentencePlain(it.h, byPid[it.h.pid]) : approvalSentencePlain(it.a)}</p>
          {it.type === 'hold' ? <HoldButtons h={it.h} run={run} /> : <ApprovalButtons a={it.a} run={run} />}
        </article>
      ))}
    </div>
  )
}

// ---------- arrivals table ----------
function ArrivalsTable({ st, moved, onOpen }) {
  const clock = st.clock ?? 0
  const rows = (st.patients || [])
    .filter((p) => p.state === 'incoming' || p.state === 'waiting' || (p.state === 'held' && !p.unit) || (p.state === 'placed' && moved[p.pid] && clock - moved[p.pid].clock <= RECENT))
    .map((p) => {
      let pill = WHERE[p.unit] || 'In a bed'
      let tone = 'bed'
      if (p.state === 'incoming') {
        pill = `Arriving in ${p.eta ?? '?'} min`
        tone = 'arriving'
      } else if (p.state === 'waiting') {
        pill = 'Waiting for a bed'
        tone = 'waiting'
      } else if (p.state === 'held') {
        pill = 'Needs your OK'
        tone = 'ok'
      } else if (p.unit === 'OR') {
        pill = 'In surgery'
        tone = 'surgery'
      }
      const rank = { ok: 0, arriving: 1, waiting: 2, surgery: 3, bed: 3 }[tone]
      return { p, pill, tone, rank }
    })
    .sort((a, b) => a.rank - b.rank || (a.p.severity || 9) - (b.p.severity || 9))
    .slice(0, 8)
  if (!rows.length) return <p className="d-empty">No one is waiting. Press Busy night or Bus crash to see the hospital under pressure.</p>
  return (
    <table className="d-table">
      <thead>
        <tr>
          <th scope="col">Patient</th>
          <th scope="col">Now</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ p, pill, tone }) => (
          <tr key={p.pid} onClick={() => onOpen(p.pid)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.pid)}>
            <td className="d-td-name" title={`${nameOf(p)}: ${sentence(p.complaint)}`}>
              <span className="d-td-who">
                <span className={`p-dot dot-${p.severity || 0}`} aria-label={URGENCY[p.severity] || ''} />
                {nameOf(p)}
              </span>
              <span className="d-td-what">{sentence(p.complaint)}</span>
            </td>
            <td>
              <span className={`d-pill pill-${tone}`}>{pill}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------- icons ----------
function Icon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  switch (name) {
    case 'grid':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      )
    case 'bed':
      return (
        <svg {...common}>
          <path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
          <circle cx="7" cy="11" r="1.8" />
        </svg>
      )
    case 'people':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M16 14.2c2.8.3 5 2.6 5 5.8" />
        </svg>
      )
    case 'hand':
      return (
        <svg {...common}>
          <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10V4.5a1.5 1.5 0 0 1 3 0V11M15 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.9-2.7 7-6.5 7-2.4 0-4.2-1.2-5.5-3l-2.6-4a1.6 1.6 0 0 1 2.6-1.8L9 14V8.5a1.5 1.5 0 0 1 3 0" />
        </svg>
      )
    case 'flow':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="6" height="5" rx="1" /><rect x="15" y="4" width="6" height="5" rx="1" /><rect x="9" y="15" width="6" height="5" rx="1" />
          <path d="M6 9v2.5h12V9M12 11.5V15" />
        </svg>
      )
    case 'chat':
      return (
        <svg {...common}>
          <path d="M4 5h16v10H9l-5 4z" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'ambulance':
      return (
        <svg {...common}>
          <path d="M2 16V7h11v9M13 10h4l4 4v2h-8" />
          <circle cx="6.5" cy="17.5" r="1.8" />
          <circle cx="17" cy="17.5" r="1.8" />
          <path d="M7.5 9v4M5.5 11h4" />
        </svg>
      )
    default:
      return null
  }
}
