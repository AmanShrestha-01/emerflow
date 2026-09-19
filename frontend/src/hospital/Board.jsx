import { useEffect, useMemo, useRef, useState } from 'react'
import { api, DEMO_KEY } from '../api.js'
import { useEvents } from '../useEvents.js'
import { LEVEL_SIGN, simTime } from './format.js'
import KpiBar from './KpiBar.jsx'
import Queue from './Queue.jsx'
import UnitMap from './UnitMap.jsx'
import SwarmFeed from './SwarmFeed.jsx'
import SwarmChat from './SwarmChat.jsx'
import AgentNetwork from './AgentNetwork.jsx'
import ApprovalDrawer from './ApprovalDrawer.jsx'
import PatientDetail from './PatientDetail.jsx'
import StoryStrip from './StoryStrip.jsx'
import { Hint, HintProvider, useHints } from './Hints.jsx'
import './Board.css'

export default function Board() {
  return (
    <HintProvider>
      <BoardInner />
    </HintProvider>
  )
}

function BoardInner() {
  const ev = useEvents()
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)
  const st = ev.state

  const say = (text, tone = 'info') => setToast({ text, tone, at: Date.now() })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Wraps an API call: reports errors on the board and reconciles state afterwards.
  const run = async (fn, okText) => {
    try {
      const res = await fn()
      if (okText) say(typeof okText === 'function' ? okText(res) : okText, 'ok')
      ev.refresh()
      return res
    } catch (e) {
      say(e.message, 'error')
      throw e
    }
  }

  const patientsById = useMemo(() => {
    const m = {}
    for (const p of st?.patients || []) m[p.pid] = p
    return m
  }, [st?.patients])

  if (!st) {
    return (
      <div className="boot">
        <div className="boot-mark">Emer Flow</div>
        <p>{ev.error ? ev.error : 'Connecting to the hospital…'}</p>
      </div>
    )
  }

  return (
    <div className={`board lvl-${st.level ?? 0}`}>
      <Header st={st} ev={ev} run={run} />
      <div className="storyrow">
        <StoryStrip st={st} feed={ev.feed} />
        <KpiBar metrics={st.metrics || {}} decisions={(st.holds?.length || 0) + (st.approvals?.length || 0)} />
      </div>
      <main className="zones">
        <Queue
          patients={st.patients}
          holds={st.holds}
          onSelect={setSelected}
          run={run}
        />
        <UnitMap st={st} patientsById={patientsById} flashes={ev.flashes} onSelect={setSelected} />
        <RightPanel ev={ev} onSelect={setSelected} />
      </main>
      <ApprovalDrawer approvals={st.approvals} holds={st.holds} patientsById={patientsById} onSelect={setSelected} run={run} />
      {selected && (
        <PatientDetail
          pid={selected}
          st={st}
          lastMove={ev.lastMoves[selected]}
          onClose={() => setSelected(null)}
          run={run}
        />
      )}
      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  )
}

function RightPanel({ ev, onSelect }) {
  const [raw, setRaw] = useState(false)
  // cycle_id -> {trigger, done}, from the event log
  const cycles = useMemo(() => {
    const m = {}
    for (const e of ev.feed) {
      if (e.type === 'cycle.start' && e.cycle_id) m[e.cycle_id] = { trigger: e.data?.trigger, clock: e.clock, done: false }
      if (e.type === 'cycle.end' && e.cycle_id) m[e.cycle_id] = { ...(m[e.cycle_id] || {}), done: true }
    }
    return m
  }, [ev.feed])
  return (
    <section className="zone zone-feed zone-right" aria-labelledby="agents-h">
      <header className="zone-h">
        <div className="zone-title">
          <h2 id="agents-h">The agents</h2>
          <p className="zone-cap">AI departments talk it through. Code checks every move.</p>
        </div>
        <button className="linkbtn" onClick={() => setRaw((v) => !v)} aria-pressed={raw}>
          {raw ? 'Back to conversation' : 'Show raw log'}
        </button>
      </header>
      <Hint id="agents">
        Each coloured dot is a department agent. A line lights up when one sends a message. Grey dashed boxes are rules written in code, not AI.
      </Hint>
      <AgentNetwork pulses={ev.pulses} typing={ev.typing} />
      {raw ? (
        <SwarmFeed feed={ev.feed} onSelect={onSelect} embedded />
      ) : (
        <SwarmChat messages={ev.messages} typing={ev.typing} cycles={cycles} onSelect={onSelect} />
      )}
    </section>
  )
}

function Header({ st, ev, run }) {
  const level = Math.max(0, Math.min(4, st.level ?? 0))
  const sign = LEVEL_SIGN[level]
  const { showAll } = useHints()
  const [surging, setSurging] = useState(false)
  const [armReset, setArmReset] = useState(false)
  const resetTimer = useRef(null)
  const prevLevel = useRef(level)
  const [bump, setBump] = useState(false)

  useEffect(() => {
    if (prevLevel.current !== level) {
      prevLevel.current = level
      setBump(true)
      const t = setTimeout(() => setBump(false), 1400)
      return () => clearTimeout(t)
    }
  }, [level])
  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const surge = async () => {
    setSurging(true)
    try {
      await run(() => api.surge(25), (r) => `Bus crash: ${r?.incoming ?? 25} patients on the way`)
    } catch {
      /* toast already shown */
    } finally {
      setSurging(false)
    }
  }
  const control = (action, extra, text) => run(() => api.control(action, extra), text).catch(() => {})
  const reset = () => {
    if (!armReset) {
      setArmReset(true)
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setArmReset(false), 3500)
      return
    }
    clearTimeout(resetTimer.current)
    setArmReset(false)
    control('reset', { key: DEMO_KEY }, 'Simulation reset')
  }

  return (
    <header className="hdr">
      <div className="brand">
        <span className="brand-cross" aria-hidden="true" />
        <div className="brand-text">
          <h1>
            Emer Flow <span className="brand-sub">Hospital Swarm</span>
          </h1>
          <div className="conn">
            {ev.source === 'mock' ? (
              <span className="conn-mock" title={ev.mockReason || ''}>
                Practice data ({ev.mockReason})
              </span>
            ) : (
              <span className={ev.connected ? 'conn-live' : 'conn-down'}>
                {ev.connected ? 'Live' : 'Reconnecting'}
                {st.mode ? `, ${st.mode === 'live' ? 'agents on Gemini' : st.mode === 'stub' ? 'agents on offline rules' : 'agents on fallback rules'}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={`sign sign-${level}${bump ? ' sign-bump' : ''}`} aria-live="polite" aria-label={`Level ${level}, ${sign.name}: ${sign.meaning}`}>
        <span className="sign-n">{level}</span>
        <span className="sign-body">
          <span className="sign-name">
            Level {level}: {sign.name}
          </span>
          <span className="sign-meaning">{st.diversion ? 'Ambulances are being diverted' : sign.meaning}</span>
        </span>
      </div>

      <div className="clock" aria-label="Simulated time">
        <span className="clock-t">{simTime(st.clock)}</span>
        <span className="clock-s">{st.paused ? 'Paused' : `Running at ${st.speed || 1}×`}</span>
      </div>

      <div className="controls" role="group" aria-label="Simulation controls">
        {st.paused ? (
          <button className="ctl" onClick={() => control('resume', {}, 'Resumed')}>
            <PlayIcon /> Resume
          </button>
        ) : (
          <button className="ctl" onClick={() => control('pause', {}, 'Paused')}>
            <PauseIcon /> Pause
          </button>
        )}
        {[1, 2].map((sp) => (
          <button
            key={sp}
            className="ctl ctl-speed"
            aria-pressed={!st.paused && (st.speed || 1) === sp}
            aria-label={`Speed ${sp}×`}
            onClick={() => control('speed', { speed: sp }, `Speed ${sp}×`)}
          >
            {sp}×
          </button>
        ))}
        <button className={`ctl ctl-reset${armReset ? ' armed' : ''}`} onClick={reset}>
          {armReset ? 'Confirm reset' : 'Reset'}
        </button>
        <button className="ctl ctl-help" onClick={showAll}>
          How to read this
        </button>
      </div>

      <button className="mci" onClick={surge} disabled={surging}>
        <span className="mci-t">{surging ? 'Sending…' : 'Bus crash'}</span>
        <span className="mci-s">Send 25 patients</span>
      </button>
    </header>
  )
}

const PlayIcon = () => (
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
  </svg>
)
const PauseIcon = () => (
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />
  </svg>
)
