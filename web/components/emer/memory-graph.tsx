"use client"

import { useMemo } from "react"
import { AGENT, AGENTS, UNIT_NAME } from "@/lib/emer/agents"
import { useHospital, type FeedEvent, type Patient } from "@/lib/emer/hospital"

// What the swarm is holding in mind, drawn as a web: agents on the outside, units inside them, patients
// around the unit that holds them, and a line for every decision an agent made about a patient.
// Everything here comes from the live event feed the board already receives: no extra fetching, and the
// board does not import this file. Lines fade with age and vanish at the window, so a surge fills the web
// in and a quiet spell dissolves it.

// Which department speaks for each place. Mirrors OWNER in backend/agents/departments.py:21.
const OWNER: Record<string, string> = {
  RESUS: "ER", ER: "ER", HALLWAY: "ER", ICU: "ICU", STEPDOWN: "STEPDOWN", WARD: "STEPDOWN",
  LOUNGE: "STEPDOWN", OR: "OR", PACU: "OR", HOME: "STEPDOWN", PARTNER: "EMS",
}
// Hand-placed so the busy units (ward, emergency, close-watch, intensive care) sit far apart and their
// patients spread across the canvas instead of crowding one side. Angles are degrees, 0 = right.
const UNITS: [string, number, number][] = [
  ["ER", 200, 1.0], ["RESUS", 250, 0.75], ["HALLWAY", 160, 0.7],
  ["ICU", 320, 0.95], ["STEPDOWN", 20, 1.0], ["WARD", 90, 1.05],
  ["OR", 290, 0.6], ["PACU", 55, 0.6], ["LOUNGE", 125, 0.65],
]
const MAX_EDGES = 400 // a long session can hold thousands of decisions; draw the most recent

const W = 1000
const H = 700
const CX = W / 2
const CY = H / 2
const R_AGENT = 300 // outer ring
const R_UNIT = 165 // inner ring

type Node = { id: string; kind: "agent" | "unit" | "patient"; x: number; y: number; label: string; color: string; r: number }
type Edge = { from: string; to: string; clock: number; kind: string; color: string }

/** A stable pseudo-random number from an id, so a patient never jumps between renders. */
function seeded(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (Math.abs(h) % 1000) / 1000
}

const onRing = (i: number, n: number, r: number) => {
  const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2
  return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r * 0.78 } // squashed: the page is wider than tall
}

export function MemoryGraph({ windowMin = 60, className = "" }: { windowMin?: number; className?: string }) {
  const { st, ev, names } = useHospital()
  const now = st?.clock ?? 0

  const { nodes, edges } = useMemo(() => {
    const nodes = new Map<string, Node>()

    // the ring of agents, in the order they are listed on the site
    AGENTS.forEach((a, i) => {
      const p = onRing(i, AGENTS.length, R_AGENT)
      nodes.set(a.id, { id: a.id, kind: "agent", x: p.x, y: p.y, label: a.name, color: a.to, r: a.id === "COORDINATOR" ? 13 : 10 })
    })

    // the units, each sitting near the department that speaks for it
    const unitAt = new Map<string, { x: number; y: number }>()
    UNITS.forEach(([u, deg, far]) => {
      const a = (deg * Math.PI) / 180
      const p = { x: CX + Math.cos(a) * R_UNIT * far, y: CY + Math.sin(a) * R_UNIT * far * 0.8 }
      unitAt.set(u, p)
      nodes.set(`unit:${u}`, {
        id: `unit:${u}`, kind: "unit", x: p.x, y: p.y, label: UNIT_NAME[u] || u,
        color: AGENT[OWNER[u] || "ER"]?.to || "#5b5b57", r: 8,
      })
    })

    // every patient, clustered around the unit holding them
    for (const p of (st?.patients || []) as Patient[]) {
      // waiting or on the way: their own cluster in the middle, not stacked on a unit
      const home = unitAt.get(p.unit || "") || { x: CX, y: CY }
      const t = seeded(p.pid) * Math.PI * 2
      const spread = 34 + seeded(p.pid + "r") * 46
      nodes.set(p.pid, {
        id: p.pid, kind: "patient",
        x: home.x + Math.cos(t) * spread,
        y: home.y + Math.sin(t) * spread * 0.8,
        label: p.name || p.pid,
        color: p.severity <= 2 ? "#d9442f" : p.severity === 3 ? "#c7831a" : "#1f8a70",
        r: p.severity <= 2 ? 5 : 4,
      })
    }

    // a line per decision: the department that owns the move, to the patient it was about
    const edges: Edge[] = []
    for (const e of (ev.feed || []) as FeedEvent[]) {
      const d = e.data || {}
      if (!d.pid || !nodes.has(d.pid)) continue
      const clock = e.clock ?? 0
      if (now - clock > windowMin) continue
      const unit = d.from_unit || d.to_unit
      const agent = OWNER[unit] || "ER"
      if (e.type === "move.applied" || e.type === "move.flagged") {
        edges.push({ from: agent, to: d.pid, clock, kind: e.type, color: AGENT[agent]?.to || "#5b5b57" })
        if (d.to_unit && unitAt.has(d.to_unit)) edges.push({ from: `unit:${d.to_unit}`, to: d.pid, clock, kind: "in", color: "#9aa5a1" })
      } else if (e.type === "move.dropped") {
        edges.push({ from: agent, to: d.pid, clock, kind: e.type, color: "#c2b8a8" })
      } else if (e.type === "move.held") {
        edges.push({ from: "COORDINATOR", to: d.pid, clock, kind: e.type, color: "#c7831a" })
      }
    }

    return { nodes: [...nodes.values()], edges: edges.slice(-MAX_EDGES) }
  }, [st?.patients, ev.feed, now, windowMin])

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes])
  const touched = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of edges) {
      c[e.from] = (c[e.from] || 0) + 1
      c[e.to] = (c[e.to] || 0) + 1
    }
    return c
  }, [edges])

  const fade = (clock: number) => Math.max(0, 1 - (now - clock) / windowMin)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="What the agents are holding in mind">
      <rect width={W} height={H} fill="#12211f" rx={24} />
      {/* the decisions */}
      {edges.map((e, i) => {
        const a = byId[e.from]
        const b = byId[e.to]
        if (!a || !b) return null
        const o = fade(e.clock)
        if (o <= 0.02) return null
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12 // a gentle curve, so parallel lines separate
        const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12
        return (
          <path
            key={`${e.from}-${e.to}-${e.clock}-${i}`}
            d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`}
            fill="none"
            stroke={e.color}
            strokeWidth={e.kind === "in" ? 0.6 : 1.1}
            strokeDasharray={e.kind === "move.dropped" ? "3 4" : undefined}
            opacity={o * (e.kind === "in" ? 0.25 : 0.55)}
          />
        )
      })}
      {/* the things that remember */}
      {nodes.map((n) => {
        const busy = touched[n.id] || 0
        const r = n.r + Math.min(7, busy * 0.5)
        return (
          <g key={n.id}>
            {n.kind !== "patient" && busy > 0 && <circle cx={n.x} cy={n.y} r={r + 7} fill={n.color} opacity={0.12} />}
            <circle cx={n.x} cy={n.y} r={r} fill={n.color} opacity={n.kind === "patient" ? 0.85 : 1}>
              <title>{n.kind === "patient" ? `${n.label} · ${busy} decision${busy === 1 ? "" : "s"}` : n.label}</title>
            </circle>
            {n.kind === "agent" && (
              <text x={n.x} y={n.y - r - 8} textAnchor="middle" fill="#f4efe2" fontSize={13} fontWeight={700}>
                {n.label}
              </text>
            )}
            {n.kind === "unit" && (
              <text x={n.x} y={n.y + r + 13} textAnchor="middle" fill="#a9c9be" fontSize={11}>
                {n.label}
              </text>
            )}
          </g>
        )
      })}
      <text x={24} y={H - 22} fill="#7f9a92" fontSize={12}>
        {edges.length} decisions in the last {windowMin} hospital minutes · {Object.keys(names || {}).length} patients
      </text>
    </svg>
  )
}
