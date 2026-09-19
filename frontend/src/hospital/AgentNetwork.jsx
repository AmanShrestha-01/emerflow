import { memo, useEffect, useState } from 'react'
import { AGENTS, DEPARTMENTS } from './format.js'

// Fixed layout in a 400 x 186 box: coordinator in the middle, departments on a ring,
// rule-keepers as small squares along the bottom edge.
const W = 400
const H = 164
const CX = 200
const CY = 68
const POS = { COORDINATOR: { x: CX, y: CY, r: 17 } }
DEPARTMENTS.forEach((d, i) => {
  const a = (-90 + i * (360 / DEPARTMENTS.length)) * (Math.PI / 180)
  POS[d] = { x: CX + Math.cos(a) * 160, y: CY + Math.sin(a) * 46, r: 10 }
})
const RULES = ['FASTLANE', 'VALIDATOR', 'DEEPCHART', 'ESCALATION']
RULES.forEach((r, i) => {
  POS[r] = { x: 22 + i * 98, y: 154, r: 6, rule: true }
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

const targets = (to) => (to || []).flatMap((t) => (t === 'ALL' ? DEPARTMENTS : [t])).filter((t) => POS[t])

function AgentNetwork({ pulses, typing }) {
  const reduced = usePrefersReducedMotion()
  const speaking = new Set()
  const hearing = new Set()
  const lines = []
  for (const p of pulses) {
    if (!POS[p.from]) continue
    speaking.add(p.from)
    for (const t of targets(p.to)) {
      if (t === p.from) continue
      hearing.add(t)
      lines.push({ key: `${p.id}-${t}`, from: p.from, to: t, kind: p.kind })
    }
  }
  return (
    <div className="net">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Agent network: lines light up as agents message each other">
        {/* resting spokes */}
        {DEPARTMENTS.map((d) => (
          <line key={d} x1={CX} y1={CY} x2={POS[d].x} y2={POS[d].y} className="net-spoke" />
        ))}
        {/* live messages */}
        {lines.map((l) => {
          const a = POS[l.from]
          const b = POS[l.to]
          const path = `M${a.x},${a.y} L${b.x},${b.y}`
          return (
            <g key={l.key} className={`net-msg ag-${l.from} net-${l.kind}`}>
              <path d={path} className="net-line" pathLength="1" />
              {!reduced && (
                <circle r="3.2" className="net-dot">
                  <animateMotion dur="0.9s" fill="freeze" path={path} />
                </circle>
              )}
            </g>
          )
        })}
        {Object.entries(POS).map(([name, p]) => {
          const cls = [
            'net-node',
            `ag-${name}`,
            p.rule ? 'net-rule' : name === 'COORDINATOR' ? 'net-coord' : 'net-dept',
            typing[name] ? 'is-typing' : '',
            speaking.has(name) ? 'is-speaking' : '',
            hearing.has(name) ? 'is-hearing' : '',
          ].join(' ')
          const label = AGENTS[name]?.label || name
          return (
            <g key={name} className={cls} transform={`translate(${p.x},${p.y})`}>
              <title>{AGENTS[name]?.label || name}</title>
              {p.rule ? (
                <>
                  <rect x={-p.r} y={-p.r} width={p.r * 2} height={p.r * 2} className="net-shape" />
                  <text x={p.r + 4} y="3.5" className="net-rule-label">
                    {AGENTS[name]?.label}
                  </text>
                </>
              ) : (
                <>
                  <circle r={p.r + 5} className="net-halo" />
                  <circle r={p.r} className="net-shape" />
                  <text y={p.r + 12} className="net-label">
                    {label}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default memo(AgentNetwork)
