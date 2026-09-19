import { useEffect, useMemo, useRef } from 'react'
import {
  useSwarmRun,
  pushSource,
  WorkflowCanvas,
  StepDetails,
  DecisionLog,
  HospitalSnapshot,
} from '@hospital-swarm/agent-workflow'
import '@hospital-swarm/agent-workflow/styles.css'
import { EMERFLOW_WORKFLOW, latestRound, roundEvents } from './workflowAdapter.js'
import './AiWorkflow.css'

// The teammate's workflow view, driven by our live swarm rounds instead of its own simulation.
export default function AiWorkflowPage({ st, ev }) {
  const { source, push } = useMemo(() => pushSource(), [])
  const swarm = useSwarmRun({ source, workflow: EMERFLOW_WORKFLOW })
  const cid = latestRound(ev.feed)
  const events = useMemo(
    () => (cid ? roundEvents(cid, ev.feed, ev.messages, st, ev.typing) : []),
    [cid, ev.feed, ev.messages, ev.typing, st],
  )

  // Push only events this round hasn't seen yet; a new round starts a fresh run.
  const sent = useRef({ cid: null, seen: new Set(), ended: false })
  useEffect(() => {
    if (!cid) return
    if (sent.current.cid !== cid) {
      sent.current = { cid, seen: new Set(), ended: false }
      swarm.start({ round: cid })
    }
    for (const e of events) {
      if (sent.current.ended) break
      const key = JSON.stringify(e)
      if (sent.current.seen.has(key)) continue
      sent.current.seen.add(key)
      push(e)
      if (e.type === 'end') sent.current.ended = true
    }
  }, [cid, events, swarm, push])

  const round = cid ? cid.replace(/^cy/, '') : null
  const running = swarm.phase === 'running'
  return (
    <div className="d-wf">
      <div className="d-wf-head">
        <p className="d-wf-intro">
          Every few minutes the AI agents hold a round. This shows the latest one as it happens: each box lights up while
          that agent works. Click a box to see what it was told, what it said and why.
        </p>
        <p className={`d-wf-status${running ? ' live' : ''}`}>
          {!round ? 'Waiting for the first round of the evening.' : running ? `Round ${round} in progress` : `Round ${round} finished`}
        </p>
      </div>
      {!round ? (
        <p className="d-empty">The agents meet when patients are waiting or beds run low. Press Busy night or Bus crash to start one.</p>
      ) : (
        <div className="d-wf-grid">
          <div className="d-wf-canvas">
            <WorkflowCanvas key={cid} swarm={swarm} layout="horizontal" className="h-[560px]" />
          </div>
          <div className="d-wf-side">
            <StepDetails swarm={swarm} />
          </div>
          <div className="d-wf-log">
            <DecisionLog swarm={swarm} />
          </div>
          <div className="d-wf-snap">
            <HospitalSnapshot swarm={swarm} />
          </div>
        </div>
      )}
    </div>
  )
}
