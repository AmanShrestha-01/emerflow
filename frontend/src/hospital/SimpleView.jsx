import { useEffect, useMemo, useRef, useState } from 'react'
import { LEVEL_SIGN, UNIT_DEPT, unitLabel } from './format.js'
import SwarmChat from './SwarmChat.jsx'
import Queue from './Queue.jsx'
import UnitMap from './UnitMap.jsx'
import { ApprovalCard, HoldCard } from './ApprovalDrawer.jsx'
import { BusCrashButton, BusyNightButton, useScenario } from './scenario.jsx'

// The default screen: talk (left), the hospital as bars (right), one decision at a time (bottom).
export default function SimpleView({ st, ev, run, patientsById, onSelect, onFull }) {
  const sc = useScenario(run)
  const [drawer, setDrawer] = useState(null) // {type:'queue'} | {type:'unit', unit}
  const waiting = (st.patients || []).filter((p) => p.state === 'waiting' || (p.state === 'held' && !p.unit)).length
  const decisions = (st.holds?.length || 0) + (st.approvals?.length || 0)

  const cycles = useMemo(() => {
    const m = {}
    for (const e of ev.feed) {
      if (e.type === 'cycle.start' && e.cycle_id) m[e.cycle_id] = { trigger: e.data?.trigger, clock: e.clock, done: false }
      if (e.type === 'cycle.end' && e.cycle_id) m[e.cycle_id] = { ...(m[e.cycle_id] || {}), done: true }
    }
    return m
  }, [ev.feed])

  return (
    <div className={`simple${decisions ? '' : ' simple-nodecide'}`}>
      <SimpleHeader st={st} ev={ev} sc={sc} waiting={waiting} decisions={decisions} onFull={onFull} />
      <main className="s-main">
        <section className="s-talk" aria-labelledby="s-talk-h">
          <h2 id="s-talk-h" className="s-h">The agents are talking</h2>
          <SwarmChat messages={ev.messages} typing={ev.typing} cycles={cycles} onSelect={onSelect} />
        </section>
        <section className="s-hosp" aria-labelledby="s-hosp-h">
          <h2 id="s-hosp-h" className="s-h">The hospital</h2>
          <Bars st={st} patientsById={patientsById} onOpen={(unit) => setDrawer({ type: 'unit', unit })} />
          <button className="s-waiting" onClick={() => setDrawer({ type: 'queue' })}>
            <span>Waiting room</span>
            <b>{waiting}</b>
            <Chevron />
          </button>
        </section>
      </main>
      {decisions > 0 && <Decisions st={st} patientsById={patientsById} onSelect={onSelect} run={run} />}
      {drawer && (
        <Drawer title={drawer.type === 'queue' ? 'Waiting room' : unitLabel(drawer.unit)} onClose={() => setDrawer(null)}>
          {drawer.type === 'queue' ? (
            <Queue patients={st.patients} holds={st.holds} onSelect={onSelect} run={run} bare />
          ) : (
            <UnitMap st={st} patientsById={patientsById} flashes={ev.flashes} onSelect={onSelect} only={drawer.unit} />
          )}
        </Drawer>
      )}
    </div>
  )
}

function SimpleHeader({ st, ev, sc, waiting, decisions, onFull }) {
  const level = Math.max(0, Math.min(4, st.level ?? 0))
  const sign = LEVEL_SIGN[level]
  const [menu, setMenu] = useState(false)
  const [help, setHelp] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menu) return
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !menuRef.current?.contains(e.target)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu])

  return (
    <header className="s-hdr">
      <div className="s-brand">
        <span className="brand-cross" aria-hidden="true" />
        <span className="s-name">Emer Flow</span>
        {ev.source === 'mock' && <span className="s-practice" title={ev.mockReason || ''}>practice data</span>}
      </div>
      <div className={`sign sign-${level} s-sign`} title={st.diversion ? 'Ambulances are being diverted' : sign.meaning}>
        <span className="sign-name">
          Level {level} · {sign.name}
        </span>
      </div>
      <p className="s-status" aria-live="polite">
        <b>{waiting}</b> waiting · <b className={decisions ? 's-you' : ''}>{decisions}</b> need you
      </p>
      <div className="s-actions">
        <BusyNightButton st={st} sc={sc} />
        <BusCrashButton sc={sc} compact />
        {st.paused ? (
          <button className="s-ctl" onClick={() => sc.control('resume', {}, 'Resumed')}>
            Resume
          </button>
        ) : (
          <button className="s-ctl" onClick={() => sc.control('pause', {}, 'Paused')} aria-label="Pause">
            Pause
          </button>
        )}
        <div className="s-menu" ref={menuRef}>
          <button className="s-ctl" aria-haspopup="menu" aria-expanded={menu} aria-label="More controls" onClick={() => setMenu((v) => !v)}>
            ⋯
          </button>
          {menu && (
            <div className="s-pop" role="menu">
              <p className="s-pop-k">Speed</p>
              <div className="s-pop-row">
                {[1, 2].map((sp) => (
                  <button key={sp} role="menuitemradio" aria-checked={(st.speed || 1) === sp} className="s-chip" onClick={() => sc.control('speed', { speed: sp }, `Speed ${sp}×`)}>
                    {sp}×
                  </button>
                ))}
              </div>
              <button role="menuitem" className={`s-item${sc.armReset ? ' danger' : ''}`} onClick={sc.reset}>
                {sc.armReset ? 'Click again to reset' : 'Reset the simulation'}
              </button>
              <button
                role="menuitem"
                className="s-item"
                onClick={() => {
                  setHelp(true)
                  setMenu(false)
                }}
              >
                How to read this
              </button>
            </div>
          )}
        </div>
        <button className="s-full" onClick={onFull}>
          Full view
        </button>
      </div>
      {help && (
        <div className="s-help" role="dialog" aria-label="How to read this">
          <p>
            <b>Left:</b> AI agents for each department talk to a coordinator to find beds. Grey lines are rules written in code checking their work.
          </p>
          <p>
            <b>Right:</b> how full each unit is. Amber means beds waiting on your decision. Click a bar to see its beds.
          </p>
          <p>
            <b>Bottom:</b> anything risky waits for you. Approve or stop it there.
          </p>
          <button className="btn btn-primary" onClick={() => setHelp(false)}>
            Got it
          </button>
        </div>
      )}
    </header>
  )
}

const CORE = ['ER', 'ICU', 'STEPDOWN', 'WARD', 'OR', 'PACU']
const EXTRA = ['RESUS', 'HALLWAY', 'LOUNGE']

function Bars({ st, patientsById, onOpen }) {
  const byUnit = Object.fromEntries((st.units || []).map((u) => [u.unit, u]))
  const order = [...CORE, ...EXTRA.filter((u) => (byUnit[u]?.occupied || 0) > 0)]
  return (
    <ul className="bars">
      {order.map((id) => {
        const u = byUnit[id]
        if (!u) return null
        const beds = u.beds || 0
        const occ = u.occupied ?? (u.occupants || []).length
        const heldOcc = (u.occupants || []).filter((pid) => patientsById[pid]?.state === 'held').length
        const heldRes = (u.reserved_for || []).filter((pid) => patientsById[pid]?.state === 'held').length
        const held = heldOcc + heldRes
        const reservedOther = Math.max(0, (u.reserved ?? (u.reserved_for || []).length) - heldRes)
        const plain = Math.max(0, occ - heldOcc)
        const over = occ + (u.reserved ?? 0) > beds && beds > 0 ? occ + (u.reserved ?? 0) - beds : 0
        const pct = (n) => `${beds ? (Math.min(n, beds) / beds) * 100 : 0}%`
        const words = over ? `${over} over` : occ >= beds ? 'full' : `${occ} of ${beds}`
        return (
          <li key={id}>
            <button className={`bar dept-${UNIT_DEPT[id] || 'OTHER'}`} onClick={() => onOpen(id)} aria-label={`${unitLabel(id)}: ${occ} of ${beds} beds${held ? `, ${held} waiting on your decision` : ''}${over ? `, ${over} over capacity` : ''}. Show beds.`}>
              <span className="bar-name">{unitLabel(id)}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill" style={{ width: pct(plain) }} />
                {held > 0 && <span className="bar-held" style={{ width: pct(held) }} />}
                {reservedOther > 0 && <span className="bar-res" style={{ width: pct(reservedOther) }} />}
                {over > 0 && <span className="bar-over">over</span>}
              </span>
              <span className={`bar-words${over ? ' over' : occ >= beds ? ' full' : ''}`}>{words}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Decisions({ st, patientsById, onSelect, run }) {
  const items = [...(st.holds || []).map((h) => ({ type: 'hold', id: h.hold_id, h })), ...(st.approvals || []).map((a) => ({ type: 'approval', id: a.approval_id, a }))]
  const [i, setI] = useState(0)
  const n = items.length
  const idx = Math.min(i, n - 1)
  const it = items[idx]
  if (!it) return null
  return (
    <section className="s-decide" aria-labelledby="s-decide-h">
      <h2 id="s-decide-h" className="s-decide-h">
        You decide <span>({idx + 1} of {n})</span>
      </h2>
      <div className="s-decide-card">
        {it.type === 'hold' ? (
          <HoldCard key={it.id} h={it.h} p={patientsById[it.h.pid]} onSelect={onSelect} run={run} />
        ) : (
          <ApprovalCard key={it.id} a={it.a} run={run} />
        )}
      </div>
      {n > 1 && (
        <div className="s-pager">
          <button className="s-ctl" onClick={() => setI((idx - 1 + n) % n)} aria-label="Previous decision">
            ‹
          </button>
          <button className="s-ctl" onClick={() => setI((idx + 1) % n)} aria-label="Next decision">
            ›
          </button>
        </div>
      )}
    </section>
  )
}

function Drawer({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    ref.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="pd s-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="pd-h">
          <h2 className="s-drawer-t">{title}</h2>
          <button ref={ref} className="pd-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="s-drawer-body">{children}</div>
      </aside>
    </div>
  )
}

const Chevron = () => (
  <svg viewBox="0 0 10 16" width="9" height="14" aria-hidden="true">
    <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
