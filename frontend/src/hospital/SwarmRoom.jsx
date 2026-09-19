import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { How, Text } from './SwarmChat.jsx'
import { simTime } from './format.js'
import './Swarm.css'

// "How the AI decided" as a swarm group chat: who's talking to whom (left), the conversation (right).
// Names only; patient codes are turned into names by <Text> (NamesContext).

const DEPTS = ['ER', 'ICU', 'STEPDOWN', 'OR', 'STAFFING', 'IMAGING', 'BLOODBANK', 'EMS']
const AGENT = {
  ER: { name: 'Emergency', ini: 'ER' },
  ICU: { name: 'Intensive care', ini: 'IC' },
  STEPDOWN: { name: 'Close-watch', ini: 'CW' },
  OR: { name: 'Surgery', ini: 'SU' },
  STAFFING: { name: 'Nurses', ini: 'NU' },
  IMAGING: { name: 'Scans (X-ray & CT)', short: 'Scans', ini: 'SC' },
  BLOODBANK: { name: 'Blood bank', ini: 'BB' },
  EMS: { name: 'Ambulances', ini: 'AM' },
  COORDINATOR: { name: 'Coordinator', ini: 'CO' },
  VALIDATOR: { name: 'Rule check', rule: true },
  FASTLANE: { name: 'Hospital rules', rule: true },
  ESCALATION: { name: 'Hospital rules', rule: true },
  DEEPCHART: { name: 'Records check', rule: true },
  ALL: { name: 'everyone' },
}
const PERSONA = { ER: 'Apex', ICU: 'Veil', STEPDOWN: 'Forge', OR: 'Crux', STAFFING: 'Root', IMAGING: 'Trace', BLOODBANK: 'Void', EMS: 'Orbit', COORDINATOR: 'Prism' }
const nameOf = (a) => AGENT[a]?.name || a || 'Someone'
const shortOf = (a) => AGENT[a]?.short || nameOf(a)
const isRule = (a) => !!AGENT[a]?.rule
const RENDER_CAP = 260

function Avatar({ a, size = 'md', typing }) {
  return (
    <span className={`sw-av sw-av-${size} swc-${a}${typing ? ' is-typing' : ''}`} aria-hidden="true">
      {AGENT[a]?.ini || '?'}
    </span>
  )
}

function Who({ a, persona }) {
  return (
    <b className={`sw-who swt-${a}`}>
      {nameOf(a)}
      {persona && <span className="sw-persona"> · {persona}</span>}
    </b>
  )
}

function To({ to }) {
  const list = (to || []).filter(Boolean)
  if (!list.length) return null
  return (
    <span className="sw-to">
      <span className="sw-arrow" aria-label="to">→</span>
      {list.map((t, i) => (
        <Fragment key={t}>
          {i > 0 && (i === list.length - 1 ? ' and ' : ', ')}
          <span className={`swt-${t}`}>{nameOf(t)}</span>
        </Fragment>
      ))}
    </span>
  )
}

// ---------- building the conversation ----------
function buildRounds(messages, cycles) {
  const rounds = []
  const byId = new Map()
  let loose = null
  for (const m of messages) {
    const key = m.cycle_id || null
    let r
    if (key) {
      r = byId.get(key)
      if (!r) {
        r = { id: key, key, items: [], asks: [], standup: null }
        byId.set(key, r)
        rounds.push(r)
      }
      loose = null
    } else {
      if (!loose || rounds[rounds.length - 1] !== loose) {
        loose = { id: `out-${m.id}`, key: null, items: [], asks: [], standup: null }
        rounds.push(loose)
      }
      r = loose
    }
    if (m.kind === 'status') {
      // the round's stand-up: all status reports together where the first one appeared
      if (!r.standup) {
        r.standup = { type: 'standup', id: `su-${m.id}`, list: [] }
        r.items.push(r.standup)
      }
      r.standup.list.push(m)
      continue
    }
    if (m.kind === 'ask') {
      const t = { type: 'thread', id: m.id, ask: m, replies: [] }
      r.items.push(t)
      r.asks.push(t)
      continue
    }
    if (m.kind === 'reply') {
      const t = [...r.asks].reverse().find((a) => !a.replies.length && a.ask.from !== m.from && (m.to || []).includes(a.ask.from) && (a.ask.to || []).includes(m.from))
      if (t) {
        t.replies.push(m)
        continue
      }
    }
    r.items.push({ type: 'msg', id: m.id, m })
  }
  for (const r of rounds) r.info = r.key ? cycles[r.key] || null : null
  return rounds
}

function Bubble({ m, onSelect, nested }) {
  const kind = m.kind || 'status'
  const persona = m.persona || PERSONA[m.from]
  if (kind === 'system' || isRule(m.from)) {
    return (
      <div className="sw-sys" role="note">
        <b>{nameOf(m.from)}:</b> <Text text={m.text} pids={m.pids} onSelect={onSelect} />
        <span className="sw-time">{simTime(m.clock)}</span>
      </div>
    )
  }
  if (kind === 'ack') {
    return (
      <div className={`sw-ack swc-${m.from}`}>
        <Avatar a={m.from} size="sm" />
        <span className="sw-ack-b">
          <span className="sw-tick" aria-label="confirmed">✓</span>
          <Who a={m.from} persona={persona} /> <Text text={m.text} pids={m.pids} onSelect={onSelect} />
        </span>
      </div>
    )
  }
  const broadcast = kind === 'plan' && (m.to || []).includes('ALL')
  const deptToDept = (kind === 'ask' || kind === 'reply') && m.from !== 'COORDINATOR' && !(m.to || []).includes('COORDINATOR')
  const cls = ['sw-msg', `sw-${kind}`, `swc-${m.from}`, m.from === 'COORDINATOR' ? 'sw-coord' : '', broadcast ? 'sw-plan-all' : '', nested ? 'sw-nested' : ''].join(' ')
  return (
    <div className={cls}>
      <span className="sw-avs">
        <Avatar a={m.from} />
        {deptToDept && (m.to || [])[0] && <Avatar a={m.to[0]} size="xs" />}
      </span>
      <div className="sw-bubble">
        <div className="sw-head">
          <Who a={m.from} persona={persona} />
          <To to={m.to} />
          {broadcast && <span className="sw-tag sw-tag-plan">Plan for everyone</span>}
          {kind === 'ask' && <span className="sw-tag">asks</span>}
          {kind === 'object' && <span className="sw-tag sw-tag-object">objects</span>}
          <span className="sw-spacer" />
          <How how={m.how} />
          <span className="sw-time">{simTime(m.clock)}</span>
        </div>
        <div className="sw-text">
          <Text text={m.text} pids={m.pids} onSelect={onSelect} />
        </div>
      </div>
    </div>
  )
}

function StandUp({ list, onSelect }) {
  return (
    <section className="sw-standup" aria-label="Stand-up: each department reports">
      <p className="sw-standup-h">Stand-up: each department tells the coordinator how it's doing</p>
      <div className="sw-standup-grid">
        {list.map((m) => (
          <div key={m.id} className={`sw-msg sw-status swc-${m.from}`}>
            <span className="sw-avs">
              <Avatar a={m.from} size="sm" />
            </span>
            <div className="sw-bubble">
              <div className="sw-head">
                <Who a={m.from} persona={m.persona || PERSONA[m.from]} />
                <span className="sw-spacer" />
                <span className="sw-time">{simTime(m.clock)}</span>
              </div>
              <div className="sw-text">
                <Text text={m.text} pids={m.pids} onSelect={onSelect} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Thread({ t, typing, onSelect }) {
  const waitingOn = (t.ask.to || []).find((a) => typing[a])
  return (
    <div className="sw-thread">
      <Bubble m={t.ask} onSelect={onSelect} />
      <div className="sw-replies">
        {t.replies.map((r) => (
          <Bubble key={r.id} m={r} onSelect={onSelect} nested />
        ))}
        {!t.replies.length && (
          <p className="sw-waiting">
            {waitingOn ? (
              <>
                {nameOf(waitingOn)} is replying <Dots />
              </>
            ) : (
              'Waiting for a reply'
            )}
          </p>
        )}
      </div>
    </div>
  )
}

const Dots = () => (
  <span className="sw-dots" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
)

// ---------- the swarm map ----------
const MAP = 300
const C = MAP / 2
const POS = { COORDINATOR: { x: C, y: C } }
DEPTS.forEach((d, i) => {
  const a = (-90 + i * 45) * (Math.PI / 180)
  POS[d] = { x: C + Math.cos(a) * 108, y: C + Math.sin(a) * 102 }
})

function usePrefersReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)'
  const [v, setV] = useState(() => window.matchMedia?.(q).matches ?? false)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const on = () => setV(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return v
}

function SwarmMap({ pulses, typing, personas }) {
  const reduced = usePrefersReducedMotion()
  const lines = []
  for (const p of pulses || []) {
    if (!POS[p.from]) continue
    const targets = (p.to || []).flatMap((t) => (t === 'ALL' ? DEPTS : [t])).filter((t) => POS[t] && t !== p.from)
    for (const t of targets) lines.push({ key: `${p.id}-${t}`, from: p.from, to: t })
  }
  return (
    <svg className="sw-map" viewBox={`0 0 ${MAP} ${MAP}`} role="img" aria-label="The swarm: a line lights up when one agent messages another">
      {DEPTS.map((d) => (
        <line key={d} x1={C} y1={C} x2={POS[d].x} y2={POS[d].y} className="sw-spoke" />
      ))}
      {lines.map((l) => {
        const a = POS[l.from]
        const b = POS[l.to]
        const path = `M${a.x},${a.y} L${b.x},${b.y}`
        return (
          <g key={l.key} className={`sw-line swc-${l.from}`}>
            <path d={path} pathLength="1" />
            {!reduced && (
              <circle r="4">
                <animateMotion dur="1.2s" fill="freeze" path={path} />
              </circle>
            )}
          </g>
        )
      })}
      {Object.entries(POS).map(([a, p]) => {
        const coord = a === 'COORDINATOR'
        const r = coord ? 26 : 19
        return (
          <g key={a} className={`sw-node swc-${a}${typing[a] ? ' is-typing' : ''}`} transform={`translate(${p.x},${p.y})`}>
            <title>{`${nameOf(a)} · ${personas[a] || PERSONA[a]}`}</title>
            <circle r={r + 6} className="sw-halo" />
            <circle r={r} className="sw-dot" />
            <text className="sw-ini" y="4.5">
              {AGENT[a].ini}
            </text>
            {typing[a] && (
              <text className="sw-typing-mark" x={r - 2} y={-r + 4}>
                …
              </text>
            )}
            <text className="sw-label" y={r + 13}>
              {shortOf(a)}
            </text>
            <text className="sw-plabel" y={r + 24}>
              {personas[a] || PERSONA[a]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function statusWord(a, last, typing) {
  if (typing[a]) return { w: 'typing…', tone: 'typing' }
  if (!last) return { w: 'listening', tone: 'idle' }
  const to = (last.to || [])[0]
  switch (last.kind) {
    case 'status':
      return { w: 'reported in', tone: 'done' }
    case 'ask':
      return { w: `asking ${to ? shortOf(to) : ''}`.trim(), tone: 'active' }
    case 'reply':
      return { w: `answered ${to ? shortOf(to) : ''}`.trim(), tone: 'done' }
    case 'plan':
      return { w: a === 'COORDINATOR' ? 'shared the plan' : 'got the plan', tone: 'done' }
    case 'ack':
      return { w: 'done', tone: 'done' }
    case 'object':
      return { w: 'raised a concern', tone: 'warn' }
    default:
      return { w: 'done', tone: 'done' }
  }
}

// ---------- the page ----------
function SwarmRoom({ messages, typing, pulses, cycles, onSelect, showSwarm = true }) {
  const scrollRef = useRef(null)
  const stuck = useRef(true)
  const lastTop = useRef(0)
  const lastId = useRef(0)
  const [unseen, setUnseen] = useState(0)
  const rounds = useMemo(() => buildRounds(messages.slice(-RENDER_CAP), cycles), [messages, cycles])
  const personas = useMemo(() => {
    const p = {}
    for (const m of messages) if (m.persona) p[m.from] = m.persona
    return p
  }, [messages])
  const latestRound = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].cycle_id) return messages[i].cycle_id
    return null
  }, [messages])
  const lastByAgent = useMemo(() => {
    const l = {}
    for (const m of messages) if (m.cycle_id === latestRound) l[m.from] = m
    return l
  }, [messages, latestRound])
  const typingList = Object.values(typing || {}).filter((t) => AGENT[t.from] && !isRule(t.from))

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const newest = messages.length ? messages[messages.length - 1].id : 0
    const added = newest !== lastId.current
    lastId.current = newest
    if (stuck.current) el.scrollTop = el.scrollHeight
    else if (added) setUnseen((n) => n + 1)
  }, [messages, typingList.length])

  const onScroll = () => {
    const el = scrollRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (atBottom) stuck.current = true
    else if (el.scrollTop < lastTop.current - 4) stuck.current = false
    lastTop.current = el.scrollTop
    if (atBottom && unseen) setUnseen(0)
  }
  const jump = () => {
    const el = scrollRef.current
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    stuck.current = true
    setUnseen(0)
  }

  const typingNames = typingList.map((t) => `${shortOf(t.from)} · ${personas[t.from] || PERSONA[t.from]}`)
  const typingText =
    typingNames.length === 0
      ? null
      : typingNames.length === 1
        ? `${typingNames[0]} is typing`
        : typingNames.length <= 2
          ? `${typingNames.join(' and ')} are typing`
          : `${typingNames.slice(0, 2).join(', ')} and ${typingNames.length - 2} more are typing`

  return (
    <div className={`swarm${showSwarm ? '' : ' swarm-chat-only'}`}>
      {showSwarm && (
      <aside className="sw-side" aria-label="The swarm">
        <h2 className="sw-side-h">The swarm</h2>
        <p className="sw-side-sub">Nine AI agents. A line lights up when one messages another.</p>
        <SwarmMap pulses={pulses} typing={typing || {}} personas={personas} />
        <ul className="sw-roster">
          {['COORDINATOR', ...DEPTS].map((a) => {
            const s = statusWord(a, lastByAgent[a], typing || {})
            return (
              <li key={a} className={`swc-${a}`}>
                <Avatar a={a} size="sm" typing={!!(typing || {})[a]} />
                <span className="sw-r-name">
                  {shortOf(a)} <span className="sw-persona">· {personas[a] || PERSONA[a]}</span>
                </span>
                <span className={`sw-r-state tone-${s.tone}`}>{s.w}</span>
              </li>
            )
          })}
        </ul>
      </aside>
      )}

      <section className="sw-main" aria-label="The conversation">
        <div className="sw-scroll" ref={scrollRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
          {rounds.length === 0 && (
            <p className="sw-empty">The agents talk every few minutes, whenever patients need beds. Press Bus crash to watch them work under pressure.</p>
          )}
          {rounds.map((r) => (
            <div key={r.id} className="sw-round">
              {r.key && (
                <div className="sw-divider" role="separator">
                  <span>
                    Round {r.key.replace(/^cy/, '')}
                    {r.info?.clock != null && ` · ${simTime(r.info.clock)}`}
                    {r.info?.trigger && ` · because ${r.info.trigger}`}
                  </span>
                </div>
              )}
              {r.items.map((it) =>
                it.type === 'standup' ? (
                  <StandUp key={it.id} list={it.list} onSelect={onSelect} />
                ) : it.type === 'thread' ? (
                  <Thread key={it.id} t={it} typing={typing || {}} onSelect={onSelect} />
                ) : (
                  <Bubble key={it.id} m={it.m} onSelect={onSelect} />
                ),
              )}
            </div>
          ))}
        </div>
        {unseen > 0 && (
          <button className="sw-newpill" onClick={jump}>
            {unseen} new message{unseen === 1 ? '' : 's'}
          </button>
        )}
        <div className="sw-typing" aria-live="off">
          {typingText ? (
            <>
              <span className="sw-typing-avs">
                {typingList.slice(0, 4).map((t) => (
                  <Avatar key={t.from} a={t.from} size="xs" />
                ))}
              </span>
              <span>{typingText}</span>
              <Dots />
            </>
          ) : (
            <span className="sw-quiet">No agent is typing right now</span>
          )}
        </div>
      </section>
    </div>
  )
}

export default memo(SwarmRoom)
