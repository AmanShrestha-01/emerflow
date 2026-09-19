import { memo } from 'react'
import { actionLabel, AGENTS, factLabel, LEVELS, simTime, unitLabel } from './format.js'

const ROUND_LABEL = { status: 'Status reports', question: 'Questions', plan: 'Plan', apply: 'Checks & apply' }
const MAX_GROUPS = 24

// Turn one contract event into a feed line: who said it, what kind of speaker, what it says.
function describe(ev) {
  const d = ev.data || {}
  const P = (pid) => ({ pid })
  switch (ev.type) {
    case 'cycle.start':
      return null // rendered as the group header
    case 'agent.status':
      return {
        agent: d.unit,
        text: d.line,
        meta: [
          d.free_now != null ? `${d.free_now} free` : null,
          d.can_free?.length ? `can free ${d.can_free.map((c) => `${c.pid}→${unitLabel(c.to_unit)}`).join(', ')}` : null,
          d.needs?.length ? `needs ${d.needs.join(', ')}` : null,
          d.blockers?.length ? `blocked: ${d.blockers.join('; ')}` : null,
        ].filter(Boolean),
        stale: d.stale,
      }
    case 'coordinator.question':
      return { agent: 'COORDINATOR', text: `asks ${AGENTS[d.unit]?.label || d.unit}: ${d.question}` }
    case 'agent.answer':
      return { agent: d.unit, text: d.answer, answer: true }
    case 'coordinator.plan':
      return {
        agent: 'COORDINATOR',
        text: d.summary,
        plan: {
          moves: d.moves || [],
          escalations: d.escalations || [],
        },
      }
    case 'move.applied': {
      const who = d.source === 'fastlane' ? 'FASTLANE' : 'VALIDATOR'
      const verb = d.to_unit === 'HOME' ? 'discharged' : d.to_unit === 'PARTNER' ? 'transferred' : 'placed'
      return {
        agent: who,
        tone: 'ok',
        text: `${verb} ${d.pid}${d.from_unit ? ` ${unitLabel(d.from_unit)} →` : ' →'} ${unitLabel(d.to_unit)}`,
        meta: [d.source && d.source !== 'fastlane' ? `via ${d.source}` : null, d.because?.length ? `because ${d.because.map(factLabel).join(', ')}` : null].filter(Boolean),
        ...P(d.pid),
      }
    }
    case 'move.held':
      return {
        agent: 'DEEPCHART',
        tone: 'hold',
        text: `held ${d.pid} → ${unitLabel(d.to_unit)}. VERIFICATION REQUIRED: sources disagree on ${(d.conflicts || []).map((c) => factLabel(c.fact)).join(', ') || 'a fact this move rests on'}`,
        meta: [d.hold_id, 'bed reserved while a human resolves'],
        ...P(d.pid),
      }
    case 'move.flagged':
      return {
        agent: 'DEEPCHART',
        tone: 'hold',
        text: `flagged ${d.pid} → ${unitLabel(d.to_unit)}: life-saving placement went ahead; sources disagree on ${(d.conflicts || []).map((c) => factLabel(c.fact)).join(', ')}`,
        ...P(d.pid),
      }
    case 'move.dropped':
      return { agent: 'VALIDATOR', tone: 'crit', text: `VALIDATOR dropped: ${d.reason}`, meta: [`${d.pid} → ${unitLabel(d.to_unit)}`], bare: true, ...P(d.pid) }
    case 'approval.requested':
      return { agent: 'ESCALATION', tone: 'hold', text: `needs your approval: ${actionLabel(d.action)}. ${d.reason || ''}`, meta: [d.approval_id, d.detail].filter(Boolean) }
    case 'approval.resolved':
      return { agent: 'ESCALATION', text: `${d.approval_id} ${d.approved ? 'approved' : 'rejected'} by staff`, tone: d.approved ? 'ok' : '' }
    case 'hold.resolved':
      return { agent: 'DEEPCHART', text: `${d.hold_id} resolved by staff: ${d.outcome === 'proceed' ? 'proceed' : 'cancelled'} (${d.pid})`, ...P(d.pid) }
    case 'level.changed':
      return {
        agent: 'ESCALATION',
        tone: d.new > d.old ? 'crit' : 'ok',
        text: `level ${d.old} ${LEVELS[d.old] || ''} → ${d.new} ${d.name || LEVELS[d.new] || ''}`,
      }
    case 'retriage.flag':
      return { agent: 'ESCALATION', tone: 'hold', text: `${d.pid} has waited ${d.waited} min: re-triage? (for staff to review)`, ...P(d.pid) }
    case 'patient.arrived':
      return { agent: 'ARRIVAL', text: `${d.pid} arrived, severity ${d.severity}: ${d.complaint}`, ...P(d.pid) }
    case 'cycle.end':
      return {
        agent: 'CYCLE',
        text: `cycle done: ${d.applied ?? 0} applied · ${d.held ?? 0} held · ${d.dropped ?? 0} dropped${d.ms != null ? ` · ${(d.ms / 1000).toFixed(1)}s` : ''}`,
      }
    case 'notice':
      return { agent: 'NOTICE', text: d.text }
    default:
      return { agent: 'SYSTEM', text: ev.type }
  }
}

function groupFeed(feed) {
  // One group per cycle_id; events outside any cycle collect into "between cycles" runs.
  const groups = []
  const byCycle = new Map()
  let run = null
  for (const ev of feed) {
    const key = ev.cycle_id || null
    let g
    if (key) {
      g = byCycle.get(key)
      if (!g) {
        g = { key, id: key, cycle: true, events: [], start: null, end: null }
        byCycle.set(key, g)
        groups.push(g)
      }
      run = null
    } else {
      if (!run || groups[groups.length - 1] !== run) {
        run = { key: null, id: `out-${ev.id}`, cycle: false, events: [] }
        groups.push(run)
      }
      g = run
    }
    if (ev.type === 'cycle.start') g.start = ev
    else if (ev.type === 'cycle.end') g.end = ev
    g.events.push(ev)
  }
  const recent = groups.slice(-MAX_GROUPS).reverse()
  // keep a running cycle pinned on top so arrivals during it don't push it down
  const running = recent.findIndex((g) => g.cycle && !g.end)
  if (running > 0) recent.unshift(...recent.splice(running, 1))
  return recent
}

function SwarmFeed({ feed, onSelect, embedded }) {
  const groups = groupFeed(feed)
  const key = (
    <span className="feed-key">
      <span className="fk fk-ai">AI agent</span>
      <span className="fk fk-coord">coordinator</span>
      <span className="fk fk-rule">rule-keeper (code)</span>
    </span>
  )
  const Wrap = embedded ? 'div' : 'section'
  return (
    <Wrap className={embedded ? 'feed-pane' : 'zone zone-feed'} aria-label="Swarm event log">
      {embedded ? (
        <div className="feed-keyrow">{key}</div>
      ) : (
        <h2 className="zone-h">
          Swarm feed
          {key}
        </h2>
      )}
      <div className="feed-scroll" aria-live="polite" aria-relevant="additions">
        {groups.length === 0 && <p className="empty">The swarm speaks when a cycle starts: unplaced patients, a unit at 90%, or every 10 minutes.</p>}
        {groups.map((g, gi) => (
          <Group key={g.id} g={g} live={gi === 0} onSelect={onSelect} />
        ))}
      </div>
    </Wrap>
  )
}

function Group({ g, live, onSelect }) {
  const rows = []
  let round = undefined
  for (const ev of g.events) {
    if (ev.type === 'cycle.start') continue
    if (g.cycle && ev.round && ev.round !== round) {
      round = ev.round
      rows.push(
        <li key={`r-${ev.id}`} className={`round round-${ev.round}`}>
          {ROUND_LABEL[ev.round] || ev.round}
        </li>,
      )
    }
    const line = describe(ev)
    if (line) rows.push(<Line key={ev.id} ev={ev} line={line} onSelect={onSelect} />)
  }
  return (
    <div className={`fgroup${g.cycle ? ' fgroup-cycle' : ' fgroup-out'}${live ? ' fgroup-live' : ''}`}>
      {g.cycle ? (
        <div className="fgroup-h">
          <span className="fgroup-id">Cycle {g.key.replace(/^cy/, '')}</span>
          <span className="fgroup-trig">{g.start?.data?.trigger || ''}</span>
          <span className="fgroup-t">{g.start ? simTime(g.start.clock) : ''}</span>
          {!g.end && <span className="fgroup-running">running</span>}
        </div>
      ) : (
        <div className="fgroup-h fgroup-h-out">Between cycles</div>
      )}
      <ol className="flines">{rows}</ol>
    </div>
  )
}

function Line({ ev, line, onSelect }) {
  const meta = AGENTS[line.agent]
  const kind = meta?.kind || 'sys'
  const cls = `fl fl-${kind} ag-${line.agent}${line.tone ? ` tone-${line.tone}` : ''}${line.answer ? ' fl-answer' : ''}`
  return (
    <li className={cls}>
      <span className="fl-t">{simTime(ev.clock)}</span>
      <span className="fl-who">{meta?.label || line.agent}</span>
      <span className="fl-body">
        <span className="fl-text">
          {line.bare ? line.text.replace(/^VALIDATOR /, '') : line.text}
          {line.stale && <span className="stale">stale report reused</span>}
        </span>
        {line.meta?.length > 0 && <span className="fl-meta">{line.meta.join(' · ')}</span>}
        {line.plan && <Plan plan={line.plan} onSelect={onSelect} />}
        {line.pid && (
          <button className="fl-link" onClick={() => onSelect(line.pid)}>
            open {line.pid}
          </button>
        )}
      </span>
    </li>
  )
}

function Plan({ plan, onSelect }) {
  if (!plan.moves.length && !plan.escalations.length) return null
  return (
    <ul className="plan">
      {plan.moves.map((m, i) => (
        <li key={i}>
          <button className="plan-pid" onClick={() => onSelect(m.pid)}>
            {m.pid}
          </button>
          <span className="plan-arrow">→</span>
          <span className="plan-unit">{unitLabel(m.to_unit)}</span>
          <span className="plan-kind">{m.kind?.replace(/_/g, ' ')}</span>
          {m.reason && <span className="plan-why">{m.reason}</span>}
        </li>
      ))}
      {plan.escalations.map((e, i) => (
        <li key={`e${i}`} className="plan-esc">
          <span className="plan-flag">ask staff</span>
          <span className="plan-unit">{actionLabel(e.action)}</span>
          {e.reason && <span className="plan-why">{e.reason}</span>}
        </li>
      ))}
    </ul>
  )
}

export default memo(SwarmFeed)
