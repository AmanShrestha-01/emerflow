import { memo } from 'react'
import { unitLabel } from './format.js'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Compose 1–3 plain sentences about what is happening right now.
function compose(st, feed) {
  const patients = st.patients || []
  const incoming = patients.filter((p) => p.state === 'incoming').length
  const waiting = patients.filter((p) => p.state === 'waiting').length
  const critical = patients.filter((p) => p.state === 'waiting' && p.severity <= 2).length

  // was there a surge recently?
  let surge = false
  for (let i = feed.length - 1; i >= 0 && i >= feed.length - 150; i--) {
    const t = feed[i].type === 'notice' ? feed[i].data?.text || '' : ''
    if (/mass casualty|bus crash/i.test(t)) {
      surge = true
      break
    }
  }
  let first
  if (incoming >= 5 && surge) first = `${incoming} patients from a bus crash are arriving.`
  else if (incoming > 0) first = `${plural(incoming, 'ambulance is', 'ambulances are')} on the way${waiting ? ` and ${plural(waiting, 'patient is', 'patients are')} waiting for a bed` : ''}.`
  else if (waiting > 0) first = `${plural(waiting, 'patient is', 'patients are')} waiting for a bed${critical ? `, ${critical} of them seriously ill` : ''}.`
  else first = 'Everyone who has arrived has a bed.'

  // what the agents are doing about it, from the latest plan
  let plan = null
  for (let i = feed.length - 1; i >= 0; i--) {
    if (feed[i].type === 'coordinator.plan') {
      plan = feed[i].data
      break
    }
  }
  const full = (st.units || [])
    .filter((u) => ['ICU', 'ER', 'STEPDOWN', 'WARD', 'RESUS'].includes(u.unit) && u.beds && u.occupied >= u.beds)
    .map((u) => unitLabel(u.unit))
  const kinds = new Set((plan?.moves || []).map((m) => m.kind))
  let doing = null
  if (kinds.has('step_down')) doing = 'the agents are moving recovering patients to step-down'
  else if (kinds.has('discharge')) doing = 'the agents are discharging patients who are ready to leave'
  else if (kinds.has('transfer')) doing = 'the agents are moving patients to the ward'
  else if (kinds.has('admit')) doing = 'the agents are placing waiting patients'
  let second = null
  if (full.length && doing) second = `${full.slice(0, 2).join(' and ')} ${full.length > 1 ? 'are' : 'is'} full, so ${doing}.`
  else if (full.length) second = `${full.slice(0, 2).join(' and ')} ${full.length > 1 ? 'are' : 'is'} full.`
  else if (doing) second = doing.charAt(0).toUpperCase() + doing.slice(1) + '.'

  const holds = (st.holds || []).length
  const approvals = (st.approvals || []).length
  let third
  if (holds && approvals) third = `${plural(holds, 'move', 'moves')} and ${plural(approvals, 'big action', 'big actions')} need your decision.`
  else if (holds) third = `${plural(holds, 'move needs', 'moves need')} your decision.`
  else if (approvals) third = `${plural(approvals, 'big action needs', 'big actions need')} your decision.`
  else third = 'Nothing needs your decision right now.'
  return { first, second, third, pending: holds + approvals }
}

// Which of the three steps is happening: from the latest cycle's round.
function activeStep(feed) {
  for (let i = feed.length - 1; i >= 0; i--) {
    const e = feed[i]
    if (!e.cycle_id) continue
    if (e.type === 'cycle.end') return 0 // latest cycle finished
    if (e.round === 'apply') return 2
    if (e.round === 'status' || e.round === 'question' || e.round === 'plan') return 1
  }
  return 0
}

function StoryStrip({ st, feed }) {
  const story = compose(st, feed)
  const step = activeStep(feed)
  const current = step || (story.pending ? 3 : 0)
  const steps = [
    { n: 1, t: 'Agents talk', d: 'departments report and the coordinator plans' },
    { n: 2, t: 'Code checks', d: 'rules and records are checked before any move' },
    { n: 3, t: 'You decide', d: 'anything risky or big waits for a person' },
  ]
  return (
    <section className="story" aria-label="Right now">
      <div className="story-text" aria-live="polite">
        <h2 className="story-h">Right now</h2>
        <p>
          <strong>{story.first}</strong> {story.second} <span className={story.pending ? 'story-you' : ''}>{story.third}</span>
        </p>
      </div>
      <ol className="steps" aria-label="How a decision is made">
        {steps.map((s) => (
          <li key={s.n} className={`step${current === s.n ? ' step-on' : ''}${s.n === 3 && story.pending ? ' step-you' : ''}`} aria-current={current === s.n ? 'step' : undefined}>
            <span className="step-n">{s.n}</span>
            <span className="step-body">
              <span className="step-t">
                {s.t}
                {s.n === 3 && story.pending > 0 && <span className="step-count">{story.pending}</span>}
              </span>
              <span className="step-d">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default memo(StoryStrip)
