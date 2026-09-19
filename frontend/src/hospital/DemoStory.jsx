import { useEffect, useMemo, useRef, useState } from 'react'
import { api, DEMO_KEY } from '../api.js'
import { ApprovalButtons, approvalSentencePlain } from './PlainView.jsx'
import { Text } from './SwarmChat.jsx'
import { Avatar, PERSONA, Who } from './SwarmRoom.jsx'
import './DemoStory.css'

// Guided demo for judges: five captioned steps over the real (live or stub) hospital.
// The clock pauses at each step; the presenter clicks Next. Every number shown is read from the live state.

const COUNTED = ['RESUS', 'ER', 'ICU', 'STEPDOWN', 'WARD']
const HOME = new Set(['LOUNGE', 'HOME', 'PARTNER'])
const TALKERS = new Set(['ER', 'ICU', 'STEPDOWN', 'OR', 'STAFFING', 'IMAGING', 'BLOODBANK', 'EMS', 'COORDINATOR'])
const STEP_TITLES = ['A normal evening', 'Bus crash', 'The AIs meet', 'The plan', 'A person decides']

const UNIT_WORDS = [[/\bWARD\b/g, 'the ward'], [/\bSTEPDOWN\b/g, 'close-watch beds'], [/\bPACU\b/g, 'recovery'],
  [/\bRESUS\b/g, 'the critical care room'], [/\bLOUNGE\b/g, 'the going-home lounge'], [/\bHALLWAY\b/g, 'a hallway bed']]
const unitWords = (t) => UNIT_WORDS.reduce((s, [re, w]) => s.replace(re, w), String(t || ''))
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function useStory(st, ev, run) {
  const [step, setStep] = useState(0) // 0 = off, 1..5, 6 = finished
  const [ready, setReady] = useState(false)
  const mem = useRef({ crashAt: null, cycles: [], cid: null, approvalId: null, resolved: null })
  const control = (action, extra) => api.control(action, extra).catch(() => {})

  // Step entry actions.
  const go = async (n) => {
    setReady(false)
    setStep(n)
    const m = mem.current
    if (n === 1) {
      Object.assign(m, { crashAt: null, cycles: [], cid: null, approvalId: null, resolved: null, maxWaiting: 0, waitingAtStart: 0 })
      await control('reset', { key: DEMO_KEY })
      await control('speed', { speed: 1 })
      await control('pause')
      setReady(true)
    } else if (n === 2) {
      m.crashAt = null
      await api.surge('bus').catch(() => {})
      await control('resume')
    } else if (n === 3) {
      // The meeting keeps going while the clock is paused; resume only if we need a later round.
    } else if (n === 4) {
      setReady(true)
    } else if (n === 5) {
      m.approvalId = null
      m.resolved = null
      m.noneNeeded = false
      m.step5Clock = st.clock ?? 0
      // A big decision may already be waiting from the peak of the crash: show it without restarting the clock.
      if (!(st.approvals || []).length) await control('resume')
    } else if (n === 6) {
      await control('speed', { speed: 0.5 })
    }
  }
  const exit = async () => {
    setStep(0)
    setReady(false)
    await control('speed', { speed: 0.5 })
  }

  // Watch the live feed and decide when each step is ready.
  useEffect(() => {
    const m = mem.current
    const feed = ev.feed
    if (step === 2) {
      m.maxWaiting = Math.max(m.maxWaiting || 0, st.metrics?.waiting || 0)
      if (m.crashAt == null) {
        const crash = [...feed].reverse().find((e) => e.type === 'notice' && /bus crash/i.test(e.data?.text || ''))
        if (crash) {
          m.crashAt = crash.id ?? 0
          m.crashClock = crash.clock ?? 0
        }
        return
      }
      // Wait for a round about patients who are waiting (the ER is full), or 20 hospital-minutes at most.
      const start = feed.find((e) => e.type === 'cycle.start' && (e.id ?? 0) > m.crashAt && !m.cycles.includes(e.cycle_id) &&
        (/waiting/.test(e.data?.trigger || '') || (e.clock ?? 0) - m.crashClock >= 20))
      if (start && !ready) {
        m.waitingAtStart = Number((start.data?.trigger || '').match(/(\d+) waiting/)?.[1] || 0)
        m.cid = start.cycle_id
        m.cycles.push(start.cycle_id)
        control('pause')
        setReady(true)
      }
    } else if (step === 3 && !ready && m.cid) {
      const end = feed.find((e) => e.type === 'cycle.end' && e.cycle_id === m.cid)
      if (!end) return
      const moved = feed.some((e) => e.type === 'move.applied' && e.cycle_id === m.cid && e.data?.source !== 'fastlane')
      if (moved) {
        control('pause')
        setReady(true)
        return
      }
      // That round changed nothing: let the clock run until the next round starts.
      const next = feed.find((e) => e.type === 'cycle.start' && (e.id ?? 0) > (end.id ?? 0) && !m.cycles.includes(e.cycle_id))
      if (next) {
        m.cid = next.cycle_id
        m.cycles.push(next.cycle_id)
        m.resumedFor = null
      } else if (m.resumedFor !== m.cid) {
        m.resumedFor = m.cid
        control('resume')
      }
    } else if (step === 5) {
      if (!m.approvalId) {
        const a = (st.approvals || [])[0]
        if (a) {
          m.approvalId = a.approval_id
          control('pause')
          setReady(true)
        } else if ((st.clock ?? 0) - (m.step5Clock ?? 0) >= 30) {
          // Nothing big was needed: say so rather than wait forever.
          m.noneNeeded = true
          control('pause')
          setStep(6)
        }
        return
      }
      if (!m.resolved) {
        const done = feed.find((e) => e.type === 'approval.resolved' && e.data?.approval_id === m.approvalId)
        if (done?.data?.expired) {
          m.approvalId = null // the hospital calmed down before anyone answered; wait for the next one
          setReady(false)
        } else if (done) {
          m.resolved = done.data
          setStep(6)
        }
      }
    }
  }, [step, ready, ev.feed, st.approvals, st.metrics?.waiting, st.clock]) // eslint-disable-line react-hooks/exhaustive-deps

  return { step, ready, go, exit, mem: mem.current }
}

function Caption({ step, st, ev, mem }) {
  const units = st.units || []
  if (step === 1) {
    const beds = units.filter((u) => COUNTED.includes(u.unit))
    const total = beds.reduce((s, u) => s + (u.beds || 0), 0)
    const full = beds.reduce((s, u) => s + (u.occupied || 0), 0)
    return (
      <>
        <p className="ds-big">A normal evening. {full} of {total} beds are full.</p>
        <p className="ds-sub">Every card below is a real bed. Green cards are empty beds.</p>
      </>
    )
  }
  if (step === 2) {
    const incoming = (st.patients || []).filter((p) => p.state === 'incoming').length
    const waiting = st.metrics?.waiting ?? 0
    const er = units.find((u) => u.unit === 'ER')
    return (
      <>
        <p className="ds-big">Bus crash: 25 injured people are on the way.</p>
        <p className="ds-sub">
          {incoming ? `${plural(incoming, 'ambulance patient')} still on the way. ` : 'Everyone has arrived. '}
          {er ? `Emergency: ${er.occupied} of ${er.beds} beds full. ` : ''}
          {waiting ? `${plural(waiting, 'person', 'people')} waiting for a bed.` : 'Critical patients get a bed straight away.'}
        </p>
      </>
    )
  }
  if (step === 3) {
    const waiting = Math.max(mem.waitingAtStart || 0, mem.maxWaiting || 0, st.metrics?.waiting || 0)
    return (
      <>
        <p className="ds-big">
          {waiting ? `${plural(waiting, 'person is', 'people are')} waiting for a bed. ` : 'The hospital is filling up. '}
          The department AIs are meeting now…
        </p>
        <p className="ds-sub">Each department has its own AI. They report, ask each other questions, and a coordinator writes one plan.</p>
      </>
    )
  }
  if (step === 4) {
    const moves = ev.feed.filter((e) => e.type === 'move.applied' && e.cycle_id === mem.cid && e.data?.source !== 'fastlane')
    const home = moves.filter((e) => HOME.has(e.data.to_unit)).length
    const placed = moves.filter((e) => !e.data.from_unit && !HOME.has(e.data.to_unit)).length
    const on = moves.length - home - placed
    const parts = [on && `move ${plural(on, 'patient')} to other floors`, home && `send ${home} home`, placed && `give ${plural(placed, 'waiting patient')} a bed`].filter(Boolean)
    const freed = on + home
    return (
      <>
        <p className="ds-big">
          Plan: {parts.join(', ')}.{freed ? ` That frees ${plural(freed, 'bed')} for the crash victims.` : ''}
        </p>
        <p className="ds-sub">The hospital rules checked every move before it happened. The bed cards below already show the moves.</p>
      </>
    )
  }
  if (step === 5) {
    const a = (st.approvals || []).find((x) => x.approval_id === mem.approvalId)
    if (!a) {
      return (
        <>
          <p className="ds-big">Some moves are too big for the AI to make alone…</p>
          <p className="ds-sub">The clock is running until the AIs ask for one.</p>
        </>
      )
    }
    return (
      <>
        <p className="ds-big">This one needs a person: {approvalSentencePlain(a)}</p>
        <p className="ds-sub">The AI can suggest it, but only a person can say yes.</p>
      </>
    )
  }
  if (step === 6) {
    const r = mem.resolved
    if (mem.noneNeeded) {
      return (
        <>
          <p className="ds-big">No big decision was needed this time: the AIs and the hospital rules found room on their own.</p>
          <p className="ds-sub">When one is needed (calling in nurses, postponing surgeries), it waits here for a person to say yes.</p>
        </>
      )
    }
    return (
      <>
        <p className="ds-big">{r?.approved ? `Done: ${r.detail}.` : 'OK, the hospital carries on without it.'}</p>
        <p className="ds-sub">AI talks, the hospital rules check, a person decides. The hospital keeps running now.</p>
      </>
    )
  }
  return null
}

function MeetingChat({ ev, cid }) {
  const box = useRef(null)
  const list = useMemo(
    () => ev.messages.filter((m) => m.cycle_id === cid && TALKERS.has(m.from) && m.text).slice(-4),
    [ev.messages, cid],
  )
  const typing = Object.entries(ev.typing || {}).filter(([a, t]) => TALKERS.has(a) && t?.cycle_id === cid).map(([a]) => a)
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [list.length])
  return (
    <aside className="ds-chat" aria-label="The department AIs talking" aria-live="polite">
      <p className="ds-chat-h">The AIs are talking</p>
      <div className="ds-chat-list" ref={box}>
        {list.map((m) => (
          <div key={m.id} className={`ds-msg swc-${m.from}`}>
            <Avatar a={m.from} size="sm" />
            <div className="ds-msg-b">
              <Who a={m.from} persona={m.persona || PERSONA[m.from]} />
              <p>
                <Text text={unitWords(m.text)} pids={m.pids} onSelect={() => {}} />
              </p>
            </div>
          </div>
        ))}
        {typing.length > 0 && <p className="ds-typing">{typing.length === 1 ? 'Someone is' : `${typing.length} AIs are`} typing…</p>}
        {!list.length && !typing.length && <p className="ds-typing">Starting the meeting…</p>}
      </div>
    </aside>
  )
}

export function StartDemoButton({ story }) {
  if (story.step) return null
  return (
    <button className="ds-start" onClick={() => story.go(1)}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
      </svg>
      Start demo
    </button>
  )
}

export default function DemoStory({ story, st, ev, run }) {
  const { step, ready, go, exit, mem } = story
  if (!step) return null
  const approval = step === 5 && (st.approvals || []).find((x) => x.approval_id === mem.approvalId)
  const waitingText = { 2: 'Waiting for the AIs to meet…', 3: 'The AIs are still talking…', 5: 'Waiting for a big decision…' }[step]
  return (
    <>
      <section className="ds-bar" aria-label="Guided demo">
        <ol className="ds-steps" aria-label="Demo steps">
          {STEP_TITLES.map((t, i) => (
            <li key={t} className={i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''} aria-current={i + 1 === step ? 'step' : undefined}>
              <span className="ds-dot">{i + 1}</span>
              <span className="ds-step-t">{t}</span>
            </li>
          ))}
        </ol>
        <div className="ds-body" aria-live="polite">
          <Caption step={step} st={st} ev={ev} mem={mem} />
        </div>
        <div className="ds-actions">
          {approval && <ApprovalButtons a={approval} run={run} />}
          {step < 5 && (
            <button className="ds-next" onClick={() => go(step + 1)} disabled={!ready}>
              {ready ? 'Next' : waitingText}
            </button>
          )}
          {step === 6 && (
            <button className="ds-next" onClick={exit}>
              Finish
            </button>
          )}
          <button className="ds-exit" onClick={exit}>
            Exit demo
          </button>
        </div>
      </section>
      {(step === 3 || step === 4) && mem.cid && <MeetingChat ev={ev} cid={mem.cid} />}
    </>
  )
}

export { useStory }
