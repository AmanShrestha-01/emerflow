import { useEffect, useRef, useState } from 'react'
import { api, DEMO_KEY } from '../api.js'

// Shared header actions: scenarios (bus crash, busy night) and clock controls.
export function useScenario(run) {
  const [busyKind, setBusyKind] = useState(null)
  const [armReset, setArmReset] = useState(false)
  const resetTimer = useRef(null)
  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const surge = async (kind) => {
    setBusyKind(kind)
    try {
      await run(
        () => api.surge(kind),
        (r) => (kind === 'bus' ? `Bus crash: ${r?.incoming ?? 25} patients on the way` : 'Busy night started: more everyday patients for the next hour'),
      )
    } catch {
      /* toast already shown */
    } finally {
      setBusyKind(null)
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
  return { surge, busyKind, control, reset, armReset }
}

export function BusyNightButton({ st, sc }) {
  const left = st.busy_until != null ? st.busy_until - (st.clock ?? 0) : 0
  const active = left > 0
  return (
    <button
      className={`busy${active ? ' busy-on' : ''}`}
      onClick={() => sc.surge('busy')}
      disabled={active || sc.busyKind === 'busy'}
      title="About three times the usual everyday patients for an hour"
    >
      {sc.busyKind === 'busy' ? 'Starting…' : active ? `Busy night: ${left} min left` : 'Busy night'}
    </button>
  )
}

export function BusCrashButton({ sc, compact }) {
  return (
    <button className={`mci${compact ? ' mci-compact' : ''}`} onClick={() => sc.surge('bus')} disabled={sc.busyKind === 'bus'}>
      <span className="mci-t">{sc.busyKind === 'bus' ? 'Sending…' : 'Bus crash'}</span>
      {!compact && <span className="mci-s">Send 25 patients</span>}
    </button>
  )
}

// Which screen to show: simple (default) or full. ?view=full wins; otherwise remembered.
const VIEW_KEY = 'emerflow.view.v1'
export function useView() {
  const [view, setViewState] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('view')
    if (q === 'full' || q === 'simple') return q
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'full' ? 'full' : 'simple'
    } catch {
      return 'simple'
    }
  })
  const setView = (v) => {
    setViewState(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* storage unavailable: choice lasts until reload */
    }
    const url = new URL(window.location.href)
    if (url.searchParams.has('view')) {
      url.searchParams.set('view', v)
      window.history.replaceState(null, '', url)
    }
  }
  return [view, setView]
}
