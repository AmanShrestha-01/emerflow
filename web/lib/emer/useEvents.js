import { useCallback, useEffect, useReducer, useRef } from 'react'
import { api, setMockBackend } from './api.js'
import { createMock } from './mock.js'

const FEED_CAP = 300
const FLASH_MS = 2600
const MSG_CAP = 400
const PULSE_MS = 1600
const TYPING_MS = 35000
// Conversation events live in `messages`/`typing`, not in the Log feed.
const CHAT_TYPES = new Set(['agent.message', 'agent.thinking'])
const toMsg = (ev) => ({ ...(ev.data || {}), id: ev.id, clock: ev.clock, cycle_id: ev.cycle_id ?? null, round: ev.round ?? null })
const splitFeed = (events) => ({
  feed: events.filter((e) => !CHAT_TYPES.has(e.type)).slice(-FEED_CAP),
  messages: events.filter((e) => e.type === 'agent.message').map(toMsg).slice(-MSG_CAP),
})
const OFFSITE = new Set(['HOME', 'PARTNER'])
// Events that change structure the incremental patch can't fully reproduce
// (metrics, counts). We patch immediately, then reconcile with GET /api/state.
const RECONCILE = new Set([
  'patient.arrived', 'level.changed', 'move.applied', 'move.held', 'move.flagged', 'move.dropped',
  'approval.requested', 'approval.resolved', 'hold.resolved', 'retriage.flag', 'cycle.end', 'notice',
])
export const EVENT_TYPES = [
  'snapshot', 'tick', 'patient.arrived', 'level.changed', 'cycle.start', 'agent.status', 'coordinator.question',
  'agent.answer', 'coordinator.plan', 'move.applied', 'move.held', 'move.flagged', 'move.dropped',
  'approval.requested', 'approval.resolved', 'hold.resolved', 'retriage.flag', 'cycle.end', 'notice',
  'agent.thinking', 'agent.message',
]

const initial = {
  state: null,
  feed: [],
  flashes: [],
  messages: [], // agent.message events, oldest first
  typing: {}, // from -> {from, to, at, cycle_id}
  pulses: [], // recent messages for the network view
  lastMoves: {}, // pid -> {to_unit, because, source} seen on the stream
  lastEventId: 0,
  source: null, // 'live' | 'mock'
  mockReason: null,
  connected: false,
  error: null,
}

function normalize(st) {
  return {
    units: [],
    patients: [],
    ct_queue: [],
    blood: {},
    or_cases: [],
    partners: {},
    holds: [],
    approvals: [],
    metrics: {},
    ...st,
  }
}

const recalc = (u) => ({ ...u, percent: u.beds ? Math.round((u.occupied / u.beds) * 100) : 0 })

function patchPatient(st, pid, fn) {
  return { ...st, patients: st.patients.map((p) => (p.pid === pid ? { ...p, ...fn(p) } : p)) }
}

function applyEvent(s, ev) {
  const st = s.state
  const d = ev.data || {}
  if (!st) return s
  switch (ev.type) {
    case 'tick': {
      const delta = Math.max(0, (d.clock ?? st.clock) - st.clock)
      return {
        ...st,
        clock: d.clock ?? st.clock,
        level: d.level ?? st.level,
        patients: delta
          ? st.patients.map((p) =>
              p.state === 'waiting' || (p.state === 'held' && !p.unit) ? { ...p, waited: (p.waited || 0) + delta } : p,
            )
          : st.patients,
      }
    }
    case 'level.changed':
      return { ...st, level: d.new, level_name: d.name }
    case 'patient.arrived': {
      if (st.patients.some((p) => p.pid === d.pid))
        return patchPatient(st, d.pid, (p) => (p.state === 'incoming' ? { state: 'waiting', eta: null, waited: 0 } : {}))
      return {
        ...st,
        patients: [
          ...st.patients,
          { pid: d.pid, name: '', age: null, complaint: d.complaint, severity: d.severity, state: 'waiting', unit: null, waited: 0, eta: null },
        ],
      }
    }
    case 'move.applied': {
      const to = d.to_unit
      const units = st.units.map((u) => {
        let x = u
        if (x.occupants?.includes(d.pid)) x = { ...x, occupants: x.occupants.filter((p) => p !== d.pid), occupied: Math.max(0, x.occupied - 1) }
        if (x.reserved_for?.includes(d.pid)) x = { ...x, reserved_for: x.reserved_for.filter((p) => p !== d.pid), reserved: Math.max(0, (x.reserved || 0) - 1) }
        if (x.unit === to) x = { ...x, occupants: [...(x.occupants || []), d.pid], occupied: x.occupied + 1 }
        return x === u ? u : recalc(x)
      })
      const next = patchPatient({ ...st, units, holds: st.holds.filter((h) => h.pid !== d.pid) }, d.pid, () => ({
        state: to === 'HOME' ? 'discharged' : to === 'PARTNER' ? 'transferred' : 'placed',
        unit: OFFSITE.has(to) ? null : to,
        locked: false,
        eta: null,
      }))
      return next
    }
    case 'move.held': {
      const hold = { hold_id: d.hold_id, pid: d.pid, to_unit: d.to_unit, because: d.because || [], conflicts: d.conflicts || [], created_at: ev.clock }
      const units = st.units.map((u) =>
        u.unit === d.to_unit && !u.reserved_for?.includes(d.pid)
          ? { ...u, reserved_for: [...(u.reserved_for || []), d.pid], reserved: (u.reserved || 0) + 1 }
          : u,
      )
      const holds = st.holds.some((h) => h.hold_id === d.hold_id) ? st.holds : [...st.holds, hold]
      return patchPatient({ ...st, units, holds }, d.pid, () => ({ state: 'held', locked: true, records_flag: true }))
    }
    case 'move.flagged':
      return patchPatient(st, d.pid, () => ({ records_flag: true }))
    case 'hold.resolved': {
      const h = st.holds.find((x) => x.hold_id === d.hold_id)
      const next = { ...st, holds: st.holds.filter((x) => x.hold_id !== d.hold_id) }
      if (d.outcome === 'cancel') {
        next.units = st.units.map((u) =>
          u.reserved_for?.includes(d.pid)
            ? { ...u, reserved_for: u.reserved_for.filter((p) => p !== d.pid), reserved: Math.max(0, (u.reserved || 0) - 1) }
            : u,
        )
        return patchPatient(next, d.pid, (p) => ({ locked: false, state: p.unit ? 'placed' : 'waiting' }))
      }
      return h ? next : next
    }
    case 'approval.requested':
      if (st.approvals.some((a) => a.approval_id === d.approval_id)) return st
      return { ...st, approvals: [...st.approvals, { ...d, level: st.level, created_at: ev.clock }] }
    case 'approval.resolved':
      return { ...st, approvals: st.approvals.filter((a) => a.approval_id !== d.approval_id) }
    case 'retriage.flag':
      return patchPatient(st, d.pid, () => ({ retriage: true, waited: d.waited }))
    default:
      return st
  }
}

function reducer(s, a) {
  switch (a.type) {
    case 'source':
      return { ...s, source: a.source, mockReason: a.reason || null }
    case 'connected':
      return { ...s, connected: a.value, error: a.value ? null : s.error }
    case 'error':
      return { ...s, error: a.error }
    case 'state': {
      // reconcile from GET /api/state; never go backwards in version within one run.
      // A different run (backend restarted or reset) starts its version over, so take it whole.
      const st = normalize(a.state)
      if (s.state && a.state.run && a.state.run !== s.state.run) {
        return { ...s, state: st, ...splitFeed(st.feed || []), lastEventId: 0, flashes: [], typing: {}, pulses: [] }
      }
      if (s.state && (a.state.version ?? 0) < (s.state.version ?? 0)) return s
      if (s.feed.length || s.messages.length) return { ...s, state: st }
      return { ...s, state: st, ...splitFeed(st.feed || []) }
    }
    case 'unflash': {
      const cutoff = a.now - FLASH_MS
      const flashes = s.flashes.filter((f) => f.at > cutoff)
      const pulses = s.pulses.filter((p) => p.at > a.now - PULSE_MS)
      const staleTyping = Object.values(s.typing).filter((t) => t.at <= a.now - TYPING_MS)
      if (flashes.length === s.flashes.length && pulses.length === s.pulses.length && !staleTyping.length) return s
      const typing = { ...s.typing }
      for (const t of staleTyping) delete typing[t.from]
      return { ...s, flashes, pulses, typing }
    }
    case 'events': {
      // a frame's worth of events, applied in order as one render
      let next = s
      for (const ev of a.list) next = reducer(next, { type: 'event', ev, now: a.now })
      return next
    }
    case 'event': {
      const ev = a.ev
      if (ev.type === 'snapshot') {
        const st = normalize(ev.data)
        return { ...s, state: st, ...splitFeed(st.feed || []), lastEventId: ev.id ?? 0, flashes: [], typing: {}, pulses: [] }
      }
      if (ev.id != null && ev.id <= s.lastEventId) return s // duplicate (reconnect replay)
      if (ev.type === 'agent.thinking') {
        const d = ev.data || {}
        if (!d.from) return { ...s, lastEventId: ev.id ?? s.lastEventId }
        return {
          ...s,
          lastEventId: ev.id ?? s.lastEventId,
          typing: { ...s.typing, [d.from]: { from: d.from, to: d.to || [], at: a.now, cycle_id: ev.cycle_id ?? null } },
        }
      }
      if (ev.type === 'agent.message') {
        const m = toMsg(ev)
        const typing = { ...s.typing }
        delete typing[m.from]
        return {
          ...s,
          lastEventId: ev.id ?? s.lastEventId,
          messages: [...s.messages, m].slice(-MSG_CAP),
          typing,
          pulses: [...s.pulses, { id: m.id, from: m.from, to: m.to || [], kind: m.kind, at: a.now }].slice(-24),
        }
      }
      const next = { ...s, lastEventId: ev.id ?? s.lastEventId, state: applyEvent(s, ev) }
      if (ev.type !== 'tick') next.feed = [...s.feed, ev].slice(-FEED_CAP)
      if (ev.type === 'move.applied' || ev.type === 'move.held' || ev.type === 'move.flagged') {
        const kind = ev.type === 'move.applied' ? 'applied' : ev.type === 'move.held' ? 'held' : 'flagged'
        next.flashes = [
          ...s.flashes.filter((f) => f.pid !== ev.data.pid),
          { id: ev.id, pid: ev.data.pid, unit: ev.data.to_unit, kind, source: ev.data.source || null, at: a.now },
        ]
        if (ev.data.because || ev.type === 'move.applied')
          next.lastMoves = { ...s.lastMoves, [ev.data.pid]: { to_unit: ev.data.to_unit, because: ev.data.because || [], source: ev.data.source || 'swarm' } }
      }
      return next
    }
    default:
      return s
  }
}

export function useEvents() {
  const [s, dispatch] = useReducer(reducer, initial)
  const refetchRef = useRef(() => {})

  useEffect(() => {
    let cancelled = false
    let es = null
    let mock = null
    let unsub = null
    let refetchTimer = null
    let pollTimer = null
    const params = new URLSearchParams(window.location.search)
    const forceMock = params.get('mock') === '1'
    const neverMock = params.get('mock') === '0'

    let queued = []
    let flushing = null
    const flush = () => {
      flushing = null
      const batch = queued
      queued = []
      if (!cancelled && batch.length) dispatch({ type: 'events', list: batch, now: Date.now() })
    }
    const onEvent = (ev) => {
      if (cancelled || !ev || !ev.type) return
      queued.push(ev)
      if (flushing == null) flushing = requestAnimationFrame(flush)
      if (RECONCILE.has(ev.type)) scheduleRefetch()
    }
    const refetch = async () => {
      try {
        const st = await api.state()
        if (!cancelled) dispatch({ type: 'state', state: st })
      } catch (e) {
        if (!cancelled) dispatch({ type: 'error', error: e.message })
      }
    }
    function scheduleRefetch() {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(refetch, 450)
    }
    refetchRef.current = scheduleRefetch

    const startMock = (reason) => {
      mock = createMock()
      setMockBackend(mock)
      dispatch({ type: 'source', source: 'mock', reason })
      dispatch({ type: 'connected', value: true })
      unsub = mock.subscribe(onEvent)
      mock.start()
    }
    const startLive = () => {
      dispatch({ type: 'source', source: 'live' })
      es = new EventSource('/api/events')
      es.onopen = () => dispatch({ type: 'connected', value: true })
      es.onerror = () => {
        // EventSource reconnects on its own; the server re-sends a snapshot.
        dispatch({ type: 'connected', value: false })
        dispatch({ type: 'error', error: 'Live feed interrupted, reconnecting…' })
      }
      const handler = (msg) => {
        try {
          onEvent(JSON.parse(msg.data))
        } catch {
          /* ignore keep-alives and malformed lines */
        }
      }
      es.onmessage = handler
      // Also accept named SSE events (`event: move.applied`), in case the server uses them.
      for (const t of EVENT_TYPES) es.addEventListener(t, handler)
      pollTimer = setInterval(refetch, 15000)
    }

    ;(async () => {
      if (forceMock) return startMock('?mock=1 in the URL')
      try {
        const st = await api.state()
        if (cancelled) return
        dispatch({ type: 'state', state: st })
        startLive()
      } catch (e) {
        if (cancelled) return
        if (neverMock) {
          dispatch({ type: 'error', error: `Backend unreachable: ${e.message}` })
          startLive()
        } else startMock('backend unreachable at /api/state')
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(refetchTimer)
      clearInterval(pollTimer)
      es?.close()
      unsub?.()
      mock?.stop()
      if (flushing != null) cancelAnimationFrame(flushing)
      if (mock) setMockBackend(null)
    }
  }, [])

  // expire tile highlights
  // expire tile highlights, network pulses and stale typing indicators
  useEffect(() => {
    const t = setInterval(() => dispatch({ type: 'unflash', now: Date.now() }), 300)
    return () => clearInterval(t)
  }, [])

  const refresh = useCallback(() => refetchRef.current(), [])
  return { ...s, refresh }
}
