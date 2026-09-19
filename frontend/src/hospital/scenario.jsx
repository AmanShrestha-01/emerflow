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

// Speed meter: pause/play plus a 5-stop slider. 1× = one hospital minute every real second.
export const SPEEDS = [0.25, 0.5, 1, 2, 5]
const SPEED_LABEL = { 0.25: '¼×', 0.5: '½×', 1: '1×', 2: '2×', 5: '5×' }
export const speedLabel = (sp) => SPEED_LABEL[sp] || `${sp}×`

export function SpeedMeter({ st, sc }) {
  const live = st.speed ?? 0.5
  const [idx, setIdx] = useState(Math.max(0, SPEEDS.indexOf(live)))
  useEffect(() => {
    const i = SPEEDS.indexOf(live)
    if (i >= 0) setIdx(i)
  }, [live])
  const pick = (i) => {
    setIdx(i)
    if (SPEEDS[i] !== live || st.paused) sc.control('speed', { speed: SPEEDS[i] }, `Speed ${speedLabel(SPEEDS[i])}`)
  }
  const sp = SPEEDS[idx]
  return (
    <div className={`d-speed${st.paused ? ' paused' : ''}`} title={`Each real second moves the hospital clock ${sp === 1 ? '1 minute' : sp < 1 ? `${sp * 60} seconds` : `${sp} minutes`}`}>
      <button
        className="d-speed-play"
        aria-label={st.paused ? 'Resume the clock' : 'Pause the clock'}
        onClick={() => (st.paused ? sc.control('resume', {}, 'Resumed') : sc.control('pause', {}, 'Paused'))}
      >
        {st.paused ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>
        )}
      </button>
      <label className="d-speed-body">
        <span className="d-speed-k">{st.paused ? 'Paused' : 'Speed'}</span>
        <input
          type="range"
          min="0"
          max={SPEEDS.length - 1}
          step="1"
          value={idx}
          aria-valuetext={speedLabel(sp)}
          onChange={(e) => pick(Number(e.target.value))}
          list="d-speed-ticks"
        />
        <datalist id="d-speed-ticks">
          {SPEEDS.map((_, i) => <option key={i} value={i} />)}
        </datalist>
      </label>
      <span className="d-speed-v">{speedLabel(sp)}</span>
    </div>
  )
}
