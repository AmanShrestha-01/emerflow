// Turns one live Hospital Swarm round (our SSE events) into the event format of the teammate's
// workflow view (@hospital-swarm/agent-workflow, protocol v1). Pure functions: same input, same output.

const DEPTS = [
  ['ER', 'Emergency', 'Gets waiting patients into beds'],
  ['ICU', 'Intensive care', 'Keeps beds for the sickest'],
  ['STEPDOWN', 'Close-watch beds', 'Takes patients leaving intensive care'],
  ['OR', 'Surgery', 'Protects urgent operations'],
  ['STAFFING', 'Staffing', 'Keeps nurse numbers safe'],
  ['IMAGING', 'Imaging', 'Scans the most urgent first'],
  ['BLOODBANK', 'Blood bank', 'Watches the blood supply'],
  ['EMS', 'Ambulances', 'Tracks who is on the way'],
]
const PERSONA = { ER: 'Apex', ICU: 'Veil', STEPDOWN: 'Forge', OR: 'Crux', STAFFING: 'Root', IMAGING: 'Trace', BLOODBANK: 'Void', EMS: 'Orbit' }
const PLACE = {
  RESUS: 'resuscitation', ER: 'an emergency bed', HALLWAY: 'a hallway bed', ICU: 'intensive care',
  STEPDOWN: 'a close-watch bed', WARD: 'a ward bed', OR: 'surgery', PACU: 'recovery', LOUNGE: 'the discharge lounge',
  HOME: 'home', PARTNER: 'another hospital',
}
const UNIT_NAMES = [
  ['RESUS', 'Resuscitation'], ['ER', 'Emergency'], ['ICU', 'Intensive care'], ['STEPDOWN', 'Close-watch'],
  ['WARD', 'Ward'], ['OR', 'Surgery'], ['PACU', 'Recovery'],
]

export const EMERFLOW_WORKFLOW = {
  steps: [
    { id: 'trigger', kind: 'trigger', title: 'Round starts', role: 'Patients are waiting or beds are running out' },
    { id: 'fastlane', kind: 'code', title: 'Hospital rules', role: 'Place the obvious cases instantly' },
    ...DEPTS.map(([id, name, role]) => ({ id, kind: 'ai', title: `${name} (${PERSONA[id]})`, role })),
    { id: 'coordinator', kind: 'ai', title: 'Coordinator (Prism)', role: 'Reads every report and writes one plan' },
    { id: 'validator', kind: 'code', title: 'Rule check', role: 'Rejects moves that break a hospital rule' },
    { id: 'human', kind: 'human', title: 'Big decisions', role: 'A person approves big actions' },
    { id: 'outcome', kind: 'code', title: 'Beds updated', role: 'The hospital after this round' },
  ],
  edges: [
    { source: 'trigger', target: 'fastlane' },
    ...DEPTS.map(([id]) => ({ source: 'fastlane', target: id })),
    ...DEPTS.map(([id]) => ({ source: id, target: 'coordinator' })),
    { source: 'coordinator', target: 'validator' },
    { source: 'validator', target: 'human' },
    { source: 'human', target: 'outcome' },
  ],
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const tidy = (t) =>
  String(t || '')
    .replace(/\bstepp(ing|ed) down\b/gi, (m, g) => (g.toLowerCase() === 'ing' ? 'moving' : 'moved'))
    .replace(/\bstep down\b/gi, 'move to close-watch beds')
    .replace(/\bstep-?downs?\b/gi, 'close-watch')
    .replace(/\bPACU\b/g, 'recovery')

/** Latest round id in the feed, or null. */
export function latestRound(feed) {
  for (let i = feed.length - 1; i >= 0; i--) if (feed[i].type === 'cycle.start') return feed[i].cycle_id
  return null
}

/**
 * All protocol events for one round, in order, as far as it has got.
 * @param {string} cid round id (e.g. "cy7")
 * @param {object[]} feed our events (no chat)   @param {object[]} messages agent.message rows
 * @param {object} st latest state (units, patients)   @param {object} typing who is composing now
 */
export function roundEvents(cid, feed, messages, st, typing = {}) {
  const name = (pid) => (st?.patients || []).find((p) => p.pid === pid)?.name || 'a patient'
  const names = (s) => tidy(String(s || '').replace(/\b(?:IN|MC|WI|RD|TR|HB|SIM)-\d+\b/g, (m) => name(m)))
  const ev = feed.filter((e) => e.cycle_id === cid)
  const msgs = messages.filter((m) => m.cycle_id === cid)
  const start = ev.find((e) => e.type === 'cycle.start')
  if (!start) return []
  const out = [
    { type: 'meta', protocol: 1, round: cid, trigger: start.data?.trigger },
    { type: 'workflow', ...EMERFLOW_WORKFLOW },
    { type: 'step', id: 'trigger', status: 'done', summary: `A new round: ${start.data?.trigger || 'the hospital changed'}`,
      input: [], output: [], reasoning: null },
  ]
  // Hospital rules: what the fast lane placed just before this round began.
  const startIdx = feed.indexOf(start)
  let prevEnd = startIdx
  while (prevEnd > 0 && feed[prevEnd - 1].type !== 'cycle.end') prevEnd--
  const fast = feed.slice(prevEnd, startIdx).filter((e) => e.type === 'move.applied' && e.data?.source === 'fastlane')
  out.push({
    type: 'step', id: 'fastlane', status: 'done',
    summary: fast.length ? `Placed ${fast.length} patient(s) straight away by the rules` : 'No obvious cases to place right now',
    input: ['Everyone waiting, and every free bed'],
    output: fast.slice(-8).map((e) => `${name(e.data.pid)} → ${PLACE[e.data.to_unit] || e.data.to_unit}`),
    reasoning: 'Plain code, no AI: critical patients always get a bed at once; anyone with a clearly fitting free bed gets it.',
  })

  // Departments: running while composing, done with their report.
  const reports = Object.fromEntries(ev.filter((e) => e.type === 'agent.status').map((e) => [e.data.unit, e.data]))
  for (const [id, label] of DEPTS) {
    const r = reports[id]
    if (!r) {
      if (typing[id] && typing[id].cycle_id === cid) out.push({ type: 'step', id, status: 'running' })
      continue
    }
    out.push({
      type: 'step', id, status: 'done', summary: names(r.line),
      input: [`Sees only ${label.toLowerCase()}: its own beds, patients and staff`],
      output: [
        ...(r.free_now != null ? [`Free right now: ${r.free_now}`] : []),
        ...(r.can_free || []).map((o) => `Could move ${name(o.pid)} to ${PLACE[o.to_unit] || o.to_unit}`),
        ...(r.needs || []).map((n) => `Needs: ${names(n)}`),
        ...(r.blockers || []).map((b) => `Blocked: ${names(b)}`),
      ],
      reasoning: `${PERSONA[id]}'s view, written ${r.how === 'live' ? 'live by Gemini' : r.how === 'replay' ? 'by Gemini (replayed)' : 'by the rules'}.`,
    })
  }

  // Coordinator.
  const plan = ev.find((e) => e.type === 'coordinator.plan')
  const qa = [
    ...ev.filter((e) => e.type === 'coordinator.question').map((e) => `Asked ${e.data.unit}: ${names(e.data.question)}`),
    ...ev.filter((e) => e.type === 'agent.answer').map((e) => `${e.data.unit} answered: ${names(e.data.answer)}`),
    ...msgs.filter((m) => m.kind === 'ask' && m.from !== 'COORDINATOR').map((m) => `${m.from} asked ${(m.to || []).join(', ')}: ${names(m.text)}`),
    ...msgs.filter((m) => m.kind === 'object').map((m) => `${m.from} objected: ${names(m.text)}`),
  ]
  if (plan) {
    const d = plan.data
    out.push({
      type: 'step', id: 'coordinator', status: 'done', summary: names(d.summary),
      input: [`${Object.keys(reports).length} department reports`, ...qa],
      output: [
        ...(d.moves || []).map((m) => `${name(m.pid)} → ${PLACE[m.to_unit] || m.to_unit}${m.reason ? `: ${names(m.reason)}` : ''}`),
        ...(d.escalations || []).map((x) => `Ask a person: ${x.action.replace(/_/g, ' ')}`),
      ],
      reasoning: `One plan for the whole hospital, written ${d.how === 'live' ? 'live by Gemini' : d.how === 'replay' ? 'by Gemini (replayed)' : 'by the rules'}. It picks departments, never bed numbers.`,
    })
    out.push({ type: 'step', id: 'validator', status: 'running' })
  } else if (Object.keys(reports).length === DEPTS.length || (typing.COORDINATOR && typing.COORDINATOR.cycle_id === cid)) {
    out.push({ type: 'step', id: 'coordinator', status: 'running', summary: 'Reading the reports', input: qa, output: [], reasoning: null })
  }

  // Rule check, big decisions, outcome: once the round has finished.
  const end = ev.find((e) => e.type === 'cycle.end')
  if (end) {
    const applied = ev.filter((e) => e.type === 'move.applied')
    const dropped = ev.filter((e) => e.type === 'move.dropped' && e.data?.pid)
    out.push({
      type: 'step', id: 'validator', status: 'done',
      summary: `${applied.length} move(s) passed the hospital rules${dropped.length ? `, ${dropped.length} rejected` : ''}`,
      input: ['Every move in the plan, checked against the hospital as it is now'],
      output: [
        ...applied.map((e) => `OK: ${name(e.data.pid)} → ${PLACE[e.data.to_unit] || e.data.to_unit}`),
        ...dropped.map((e) => `Rejected: ${name(e.data.pid)} → ${PLACE[e.data.to_unit] || e.data.to_unit} (${names(e.data.reason)})`),
      ],
      reasoning: 'Plain code: full units, nurse limits, and patients in the wrong kind of bed are never allowed.',
    })
    const asks = ev.filter((e) => e.type === 'approval.requested')
    out.push(asks.length
      ? { type: 'step', id: 'human', status: 'flagged', summary: `${asks.length} big decision(s) waiting for a person`,
          input: [], output: asks.map((e) => cap(names(e.data.detail || e.data.reason))), reasoning: 'The AI cannot do these without a person saying yes.' }
      : { type: 'step', id: 'human', status: 'done', summary: 'Nothing big to decide this round', input: [], output: [], reasoning: null })
    const units = UNIT_NAMES.map(([code, nm]) => {
      const u = (st?.units || []).find((x) => x.unit === code)
      return { code, name: nm, occupied: u ? u.occupied + u.reserved : 0, capacity: u ? u.beds : 0,
               waiting: code === 'ER' ? (st?.metrics?.waiting || 0) : 0 }
    })
    const t = (st?.clock_start ?? 1260) + (end.clock || 0)
    const clock = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    out.push({ type: 'step', id: 'outcome', status: 'done',
      summary: `${applied.length} patient(s) moved in about ${Math.round((end.data?.ms || 0) / 1000)} s`,
      input: [], output: [], reasoning: null })
    out.push({ type: 'snapshot', label: 'After this round', clock, units })
    out.push({ type: 'end' })
  }
  return out
}
