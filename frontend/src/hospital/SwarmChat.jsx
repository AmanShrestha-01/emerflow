import { createContext, Fragment, memo, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { agentKind, agentLabel, simTime } from './format.js'

const RENDER_CAP = 220 // messages drawn at once (the store keeps ~400)

// Routine chatter is folded away by default; the interesting turns stay visible.
const isRoutine = (m) => m.kind === 'status' || m.kind === 'ack' || (m.kind === 'plan' && !(m.to || []).includes('ALL'))

// Group messages by cycle, and thread each reply under the ask it answers.
function buildGroups(messages, cycles) {
  const groups = []
  const byCycle = new Map()
  let run = null
  for (const m of messages) {
    const key = m.cycle_id || null
    let g
    if (key) {
      g = byCycle.get(key)
      if (!g) {
        g = { id: key, key, items: [], asks: [] }
        byCycle.set(key, g)
        groups.push(g)
      }
      run = null
    } else {
      if (!run || groups[groups.length - 1] !== run) {
        run = { id: `out-${m.id}`, key: null, items: [], asks: [] }
        groups.push(run)
      }
      g = run
    }
    if (m.kind === 'ask') {
      const t = { type: 'thread', id: m.id, ask: m, replies: [] }
      g.items.push(t)
      g.asks.push(t)
      continue
    }
    if (m.kind === 'reply') {
      // the most recent unanswered ask from the reply's addressee to its sender
      const t = [...g.asks].reverse().find((a) => !a.replies.length && a.ask.from !== m.from && (m.to || []).includes(a.ask.from) && (a.ask.to || []).includes(m.from))
      if (t) {
        t.replies.push(m)
        continue
      }
    }
    g.items.push({ type: 'msg', id: m.id, m, routine: isRoutine(m) })
  }
  for (const g of groups) {
    g.info = g.key ? cycles[g.key] || null : null
    const routine = g.items.filter((it) => it.routine).map((it) => it.m)
    g.reported = new Set(routine.filter((m) => m.kind === 'status').map((m) => m.from)).size
    g.confirmed = new Set(routine.filter((m) => m.kind === 'ack').map((m) => m.from)).size
    g.told = routine.filter((m) => m.kind === 'plan').length
    g.routineN = routine.length
  }
  return groups
}

// Link patient ids mentioned in the text; list any others after it.
// When provided (pid -> name), patient codes are shown as names everywhere in the chat.
export const NamesContext = createContext(null)
const CODE_RE = /\b([A-Z]{1,3}-\d{1,4})\b/g

function NamedText({ text, pids, names, onSelect }) {
  const parts = text.split(CODE_RE)
  const seen = new Set()
  const out = parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>
    seen.add(part)
    const nm = names[part]
    return nm ? (
      <button key={i} className="pidlink pidname" onClick={() => onSelect(part)}>
        {nm}
      </button>
    ) : (
      <Fragment key={i}>a patient</Fragment>
    )
  })
  const extra = [...new Set(pids.filter((p) => p && !seen.has(p) && names[p] && !text.includes(names[p])))]
  return (
    <>
      {out}
      {extra.length > 0 && (
        <span className="pidchips">
          {extra.map((p) => (
            <button key={p} className="pidlink pidname" onClick={() => onSelect(p)}>
              {names[p]}
            </button>
          ))}
        </span>
      )}
    </>
  )
}

// everyday unit words in agent text
const tidy = (t) => String(t || '')
  .replace(/\bstepp(ing|ed) down\b/gi, (m, g) => (g.toLowerCase() === 'ing' ? 'moving' : 'moved'))
  .replace(/\bstep down\b/gi, (m) => (m[0] === 'S' ? 'Move to close-watch beds' : 'move to close-watch beds'))
  .replace(/\bstep-?downs?\b/gi, (m) => (m[0] === 'S' ? 'Close-watch' : 'close-watch'))
  .replace(/\bPACU\b/g, 'Recovery')

function Text({ text: raw = '', pids = [], onSelect }) {
  const names = useContext(NamesContext)
  const text = tidy(raw)
  if (names) return <NamedText text={text} pids={pids || []} names={names} onSelect={onSelect} />
  const ids = [...new Set(pids.filter(Boolean))]
  if (!ids.length) return <>{text}</>
  const re = new RegExp(`(${ids.map((p) => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`, 'g')
  const parts = text.split(re)
  const missing = ids.filter((p) => !text.includes(p))
  return (
    <>
      {parts.map((part, i) =>
        ids.includes(part) ? (
          <button key={i} className="pidlink" onClick={() => onSelect(part)}>
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
      {missing.length > 0 && (
        <span className="pidchips">
          {missing.map((p) => (
            <button key={p} className="pidlink" onClick={() => onSelect(p)}>
              {p}
            </button>
          ))}
        </span>
      )}
    </>
  )
}

function How({ how }) {
  if (how === 'live') return <span className="how how-live" title="Written by Gemini">Gemini</span>
  if (how === 'replay') return <span className="how how-live" title="Replayed from a recorded live Gemini run">Gemini (replay)</span>
  if (how === 'stub' || how === 'fallback') return <span className="how how-rules" title={`Written by rules (${how})`}>rules</span>
  return null
}

// Each agent's thinking persona (Kairos-style archetype), e.g. ICU "Veil".
function Persona({ m }) {
  return m.persona ? <span className="persona" title={`${m.persona}: this agent's thinking style`}>{m.persona}</span> : null
}

function Route({ m }) {
  const to = m.to || []
  return (
    <span className="route">
      <b className={`who ag-${m.from}`}>{agentLabel(m.from)}</b>
      <Persona m={m} />
      <span className="route-to"> to </span>
      {to.map((t, i) => (
        <Fragment key={t}>
          {i > 0 && (i === to.length - 1 ? ' and ' : ', ')}
          <span className={`who-to ag-${t}`}>{agentLabel(t)}</span>
        </Fragment>
      ))}
    </span>
  )
}

function Bubble({ m, onSelect, nested }) {
  const kind = m.kind || 'status'
  if (kind === 'system' || agentKind(m.from) === 'rule') {
    return (
      <div className={`sysmsg ag-${m.from}`}>
        <span className="sysmsg-who">{agentLabel(m.from)}</span>
        <span className="sysmsg-text">
          <Text text={m.text} pids={m.pids} onSelect={onSelect} />
        </span>
        <span className="sysmsg-t time">{simTime(m.clock)}</span>
      </div>
    )
  }
  if (kind === 'ack') {
    return (
      <div className={`ack ag-${m.from}`}>
        <span className="ack-tick" aria-label="confirmed">✓</span>
        <b className={`who ag-${m.from}`}>{agentLabel(m.from)}</b>
        <Persona m={m} />
        <span className="ack-text">
          <Text text={m.text} pids={m.pids} onSelect={onSelect} />
        </span>
      </div>
    )
  }
  const broadcast = kind === 'plan' && (m.to || []).includes('ALL')
  const coord = m.from === 'COORDINATOR'
  const cls = ['msg', `msg-${kind}`, `ag-${m.from}`, coord ? 'msg-coord' : 'msg-dept', broadcast ? 'msg-broadcast' : '', nested ? 'msg-nested' : ''].join(' ')
  return (
    <div className={cls}>
      <div className="msg-head">
        {broadcast ? <b className="who ag-COORDINATOR">Coordinator's plan for everyone</b> : <Route m={m} />}
        {kind === 'object' && <span className="kind-tag kind-object">objects</span>}
        <How how={m.how} />
        <span className="msg-t time">{simTime(m.clock)}</span>
      </div>
      <div className="msg-text">
        <Text text={m.text} pids={m.pids} onSelect={onSelect} />
      </div>
    </div>
  )
}

function Thread({ t, typing, onSelect }) {
  const waitingOn = (t.ask.to || []).filter((a) => typing[a] && (typing[a].to || []).includes(t.ask.from))
  return (
    <div className="thread">
      <Bubble m={t.ask} onSelect={onSelect} />
      <div className="thread-replies">
        {t.replies.map((r) => (
          <Bubble key={r.id} m={r} onSelect={onSelect} nested />
        ))}
        {!t.replies.length && (
          <div className="thread-wait">
            {waitingOn.length ? (
              <>
                {agentLabel(waitingOn[0])} is replying <Dots />
              </>
            ) : (
              'Waiting for a reply'
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const Dots = () => (
  <span className="dots" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
)

function routineSummary(g) {
  const bits = []
  if (g.reported) bits.push(`${g.reported} department${g.reported === 1 ? '' : 's'} reported in`)
  if (g.told) bits.push(`${g.told} got their part of the plan`)
  if (g.confirmed) bits.push(`${g.confirmed} confirmed`)
  if (!bits.length) return `${g.routineN} routine messages`
  return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0]
}

function SwarmChat({ messages, typing, cycles, onSelect }) {
  const scrollRef = useRef(null)
  const stuck = useRef(true)
  const [unseen, setUnseen] = useState(0)
  const [open, setOpen] = useState(() => new Set())
  const lastId = useRef(0)
  const groups = useMemo(() => buildGroups(messages.slice(-RENDER_CAP), cycles), [messages, cycles])
  const typingList = Object.values(typing)
  // persona per agent, from what they last said (thinking events don't carry it)
  const personas = useMemo(() => {
    const m = {}
    for (const x of messages) if (x.persona) m[x.from] = x.persona
    return m
  }, [messages])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const newest = messages.length ? messages[messages.length - 1].id : 0
    const added = newest !== lastId.current
    lastId.current = newest
    if (stuck.current) el.scrollTop = el.scrollHeight
    else if (added) setUnseen((n) => n + 1)
  }, [messages, typingList.length])

  const lastTop = useRef(0)
  const onScroll = () => {
    const el = scrollRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    // only a real upward scroll unsticks; layout changes (resize, view switch) don't
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
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {groups.length === 0 && <p className="empty chat-empty">A normal evening. Everyday patients are arriving; the agents place them as beds open.</p>}
        {groups.map((g) => {
          const expanded = open.has(g.id)
          return (
            <section key={g.id} className={`cgroup${g.key ? '' : ' cgroup-out'}`}>
              {g.key && (
                <h3 className="cgroup-h">
                  <span className="cgroup-id">Round {g.key.replace(/^cy/, '')}</span>
                  {g.info?.trigger && <span className="cgroup-trig">because of {g.info.trigger}</span>}
                  {g.info && !g.info.done && <span className="cgroup-live">in progress</span>}
                </h3>
              )}
              {g.routineN > 0 && (
                <button className="routine" onClick={() => toggle(g.id)} aria-expanded={expanded}>
                  <span>{routineSummary(g)}.</span>
                  <span className="routine-act">{expanded ? 'Hide' : 'Show'}</span>
                </button>
              )}
              {g.items
                .filter((it) => expanded || !it.routine)
                .map((it) =>
                  it.type === 'thread' ? (
                    <Thread key={it.id} t={it} typing={typing} onSelect={onSelect} />
                  ) : (
                    <Bubble key={it.id} m={it.m} onSelect={onSelect} />
                  ),
                )}
            </section>
          )
        })}
      </div>
      {unseen > 0 && (
        <button className="newpill" onClick={jump}>
          {unseen} new message{unseen === 1 ? '' : 's'}
        </button>
      )}
      <div className={`typing${typingList.length ? ' typing-on' : ''}`} aria-live="off">
        {typingList.length === 0 && <span className="typing-idle">No agent is writing right now</span>}
        {typingList.slice(0, 3).map((t) => (
          <span key={t.from} className={`typing-item ag-${t.from}`}>
            <b className="who">
              {agentLabel(t.from)}
              {personas[t.from] ? ` (${personas[t.from]})` : ''}
            </b>
            <Dots />
          </span>
        ))}
        {typingList.length > 3 && <span className="typing-idle">and {typingList.length - 3} more</span>}
        {typingList.length > 0 && <span className="typing-idle">{typingList.length === 1 ? 'is' : 'are'} writing</span>}
      </div>
    </div>
  )
}

export default memo(SwarmChat)
