"use client"

// The swarm's memory as a living 3D web: agents, the places they speak for, and every patient they have
// decided about. Force-directed, so you can grab a node and the whole web follows, and lines fade out as
// the decision behind them ages. Loaded only in the browser (see memory-graph.tsx) because it needs WebGL.
//
// Everything here comes from the live feed the board already receives, plus GET /api/memory for the notes
// panel. Nothing is fetched twice and no other page imports this file.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph3D from "react-force-graph-3d"
import SpriteText from "three-spritetext"
import { AGENT, AGENTS, OWNER, UNIT_NAME } from "@/lib/emer/agents"
import type { FeedEvent, HState, Patient } from "@/lib/emer/hospital"

const UNITS = ["ER", "RESUS", "HALLWAY", "ICU", "STEPDOWN", "WARD", "OR", "PACU", "LOUNGE"]
// A patient who needs one of these is joined to the agent that provides it, so the service agents sit in
// the web rather than floating beside it.
const NEEDS: [keyof Patient, string][] = [
  ["needs_ct", "IMAGING"], ["needs_xray", "XRAY"], ["needs_labs", "LAB"],
]
const MAX_EDGES = 400 // a long session holds thousands of decisions; draw the most recent

const SEV = (s: number) => (s <= 2 ? "#e2503a" : s === 3 ? "#d99a2b" : "#3fc3a4")
const BG = "#101d1c"

type Kind = "agent" | "unit" | "patient"
type N = {
  id: string; kind: Kind; label: string; sub: string; color: string; base: number
  hits: number; val: number
  x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number
}
type L = { key: string; source: string | N; target: string | N; kind: string; color: string; fade: number }

const idOf = (e: string | N) => (typeof e === "string" ? e : e.id)

export type Note = { age_s: number; clock: number; kind: string; pid: string; name: string; text: string; here: boolean }
export type MemoryFeed = { window_s: number; agents: { unit: string; notes: Note[] }[] }

export function MemoryCanvas({
  st, feed, windowMin, notes, width, height, onPick,
}: {
  st: HState | null
  feed: FeedEvent[]
  windowMin: number
  notes: MemoryFeed | null
  width: number
  height: number
  onPick: (id: string | null) => void
}) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const fg = useRef<any>(null)
  const store = useRef({ n: new Map<string, N>(), l: new Map<string, L>(), shape: "" })
  const touched = useRef(false) // once the viewer moves the camera, stop re-framing it for them
  const [data, setData] = useState<{ nodes: N[]; links: L[] }>({ nodes: [], links: [] })
  const [hot, setHot] = useState<{ nodes: Set<string>; links: Set<string> }>({ nodes: new Set(), links: new Set() })
  const [spin, setSpin] = useState(true)

  const now = st?.clock ?? 0
  const noteCount = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of notes?.agents || []) c[a.unit] = a.notes.filter((n) => n.here).length
    return c
  }, [notes])

  // Rebuild the web, keeping every node object that is still here so nothing jumps between updates.
  useEffect(() => {
    const want = new Map<string, N>()
    const links = new Map<string, L>()
    const keep = store.current.n

    const put = (id: string, kind: Kind, label: string, sub: string, color: string, base: number) => {
      const old = keep.get(id)
      const n: N = old || { id, kind, label, sub, color, base, hits: 0, val: base }
      n.kind = kind; n.label = label; n.sub = sub; n.color = color; n.base = base; n.hits = 0
      want.set(id, n)
      return n
    }
    const join = (a: string, b: string, kind: string, color: string, fade = 1) => {
      const key = `${a}>${b}>${kind}`
      if (!want.has(a) || !want.has(b)) return
      const had = links.get(key)
      if (had) { had.fade = Math.max(had.fade, fade); return }
      links.set(key, { key, source: a, target: b, kind, color, fade })
    }

    for (const a of AGENTS) put(a.id, "agent", a.name, a.role, a.to, a.id === "COORDINATOR" ? 9 : 6)
    for (const u of UNITS) put(`unit:${u}`, "unit", UNIT_NAME[u] || u, "a place in the hospital", AGENT[OWNER[u]]?.to || "#6b7d78", 2.4)
    for (const p of (st?.patients || []) as Patient[]) {
      if (p.state !== "waiting" && p.state !== "placed" && p.state !== "held") continue
      put(p.pid, "patient", p.name || p.pid, `${p.complaint}${p.age ? `, ${p.age}` : ""}`, SEV(p.severity), 0.5)
    }

    // the skeleton: every department reports to the coordinator, and speaks for its own places
    for (const a of AGENTS) if (a.id !== "COORDINATOR") join("COORDINATOR", a.id, "reports", "#3d5a54", 1)
    for (const u of UNITS) join(OWNER[u] || "ER", `unit:${u}`, "owns", AGENT[OWNER[u]]?.to || "#6b7d78", 1)

    // where each patient is now, and who they are waiting on
    for (const p of (st?.patients || []) as Patient[]) {
      if (!want.has(p.pid)) continue
      if (p.unit && want.has(`unit:${p.unit}`)) join(`unit:${p.unit}`, p.pid, "in", "#57736c", 1)
      else join("ER", p.pid, "in", "#57736c", 1)
      for (const [flag, agent] of NEEDS) if (p[flag]) join(agent, p.pid, "needs", AGENT[agent].to, 0.8)
    }

    // one line per decision, faded by how long ago it was made
    for (const e of feed.slice(-2000)) {
      const d = e.data || {}
      if (!d.pid || !want.has(d.pid)) continue
      const age = now - (e.clock ?? 0)
      if (age > windowMin) continue
      const fade = Math.max(0.05, 1 - age / windowMin)
      const agent = OWNER[d.from_unit || d.to_unit] || "ER"
      if (e.type === "move.applied" || e.type === "move.flagged") join(agent, d.pid, "moved", AGENT[agent]?.to || "#6b7d78", fade)
      else if (e.type === "move.dropped") join(agent, d.pid, "refused", "#9c8f7d", fade)
      else if (e.type === "move.held") join("COORDINATOR", d.pid, "held", "#d99a2b", fade)
    }

    const drawn = [...links.values()].slice(-MAX_EDGES)
    for (const l of drawn) {
      if (l.kind === "moved" || l.kind === "refused" || l.kind === "held") {
        want.get(idOf(l.source))!.hits++
        want.get(idOf(l.target))!.hits++
      }
    }
    for (const n of want.values()) {
      const busy = n.kind === "agent" ? n.hits + (noteCount[n.id] || 0) * 0.6 : n.hits
      n.val = n.base + Math.min(n.base * 1.8, busy * (n.kind === "patient" ? 0.12 : 0.22))
    }

    // Only hand React a new graph when the shape changed; otherwise repaint in place, so a quiet minute
    // does not shake the web apart.
    const shape = `${[...want.keys()].join()}|${drawn.map((l) => l.key).join()}`
    store.current.n = want
    store.current.l = new Map(drawn.map((l) => [l.key, l]))
    if (shape !== store.current.shape) {
      store.current.shape = shape
      setData({ nodes: [...want.values()], links: drawn })
    } else {
      fg.current?.refresh()
    }
  }, [st?.patients, feed, now, windowMin, noteCount])

  // gentle forces: short leashes for the skeleton, longer for patients, so clusters stay readable
  useEffect(() => {
    const g = fg.current
    if (!g) return
    g.d3Force("charge")?.strength(-38).distanceMax(260)
    g.d3Force("link")?.distance((l: L) => (l.kind === "reports" ? 46 : l.kind === "owns" ? 22 : l.kind === "in" ? 11 : 28))
      .strength((l: L) => (l.kind === "reports" ? 0.6 : l.kind === "in" ? 1 : 0.3))
    g.cameraPosition({ z: 320 })
  }, [])

  useEffect(() => {
    const c = fg.current?.controls?.()
    if (c) { c.autoRotate = spin; c.autoRotateSpeed = 0.5 }
  }, [spin, data])

  const light = useCallback((n: N | null) => {
    if (!n) { setHot({ nodes: new Set(), links: new Set() }); onPick(null); return }
    const nodes = new Set<string>([n.id])
    const links = new Set<string>()
    for (const l of store.current.l.values()) {
      if (idOf(l.source) === n.id || idOf(l.target) === n.id) {
        links.add(l.key)
        nodes.add(idOf(l.source)); nodes.add(idOf(l.target))
      }
    }
    setHot({ nodes, links })
    onPick(n.id)
  }, [onPick])

  const dim = hot.nodes.size > 0
  const nodeColor = useCallback((n: N) => (!dim || hot.nodes.has(n.id) ? n.color : "#2a3b38"), [dim, hot])
  const linkColor = useCallback((l: L) => {
    if (dim) return hot.links.has(l.key) ? l.color : "rgba(255,255,255,0.03)"
    const a = l.kind === "in" || l.kind === "reports" ? 0.16 : l.kind === "owns" ? 0.3 : 0.28 + l.fade * 0.55
    return withAlpha(l.color, a)
  }, [dim, hot])

  const nodeObject = useCallback((n: N) => {
    if (n.kind === "patient") return null
    const t = new SpriteText(n.label) as SpriteText & { material: { depthWrite: boolean }; position: { set(x: number, y: number, z: number): void } }
    t.color = n.kind === "agent" ? "#f5f0e4" : "#a7c4bb"
    t.textHeight = n.kind === "agent" ? (n.id === "COORDINATOR" ? 7 : 5.5) : 3.4
    t.fontWeight = n.kind === "agent" ? "700" : "500"
    t.material.depthWrite = false // labels stay legible through the web instead of flickering behind it
    t.position.set(0, Math.cbrt(n.val) * 4 + (n.kind === "agent" ? 6 : 4), 0)
    return t
  }, [])

  return (
    <div
      className="relative"
      style={{ width, height }}
      onPointerDownCapture={() => { touched.current = true }}
      onWheelCapture={() => { touched.current = true }}
    >
      <ForceGraph3D
        ref={fg}
        graphData={data}
        width={width}
        height={height}
        backgroundColor={BG}
        showNavInfo={false}
        nodeRelSize={4}
        nodeVal={(n: N) => n.val}
        nodeOpacity={0.92}
        nodeResolution={12}
        nodeColor={nodeColor as any}
        nodeThreeObject={nodeObject as any}
        nodeThreeObjectExtend
        nodeLabel={(n: N) =>
          `<div style="background:#0d1918;color:#f5f0e4;border:1px solid #2f4a45;border-radius:10px;padding:6px 9px;font:500 12px Inter,sans-serif;max-width:220px">
             <b>${esc(n.label)}</b><br/><span style="color:#93b0a8">${esc(n.sub)}</span>
             ${n.hits ? `<br/><span style="color:#93b0a8">${n.hits} decision${n.hits === 1 ? "" : "s"} in this window</span>` : ""}
           </div>` as any
        }
        linkColor={linkColor as any}
        linkWidth={(l: L) => (hot.links.has(l.key) ? 1.6 : l.kind === "moved" ? 0.6 + l.fade : 0.4)}
        linkOpacity={1}
        linkCurvature={(l: L) => (l.kind === "moved" || l.kind === "held" ? 0.16 : 0)}
        linkDirectionalParticles={(l: L) => (l.fade > 0.72 && (l.kind === "moved" || l.kind === "held") ? 2 : 0)}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleSpeed={0.012}
        onNodeHover={light as any}
        onNodeClick={((n: N) => {
          setSpin(false)
          touched.current = true
          const d = 1 + 90 / Math.hypot(n.x || 1, n.y || 1, n.z || 1)
          fg.current?.cameraPosition({ x: (n.x || 0) * d, y: (n.y || 0) * d, z: (n.z || 0) * d }, n, 900)
        }) as any}
        onNodeDrag={(() => setSpin(false)) as any}
        onNodeDragEnd={((n: N) => { n.fx = undefined; n.fy = undefined; n.fz = undefined; fg.current?.d3ReheatSimulation() }) as any}
        onBackgroundClick={() => { light(null); fg.current?.cameraPosition({ x: 0, y: 0, z: 460 }, { x: 0, y: 0, z: 0 }, 900) }}
        cooldownTime={4000}
        warmupTicks={40}
        onEngineStop={() => { if (!touched.current) fg.current?.zoomToFit(700, 55) }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
        <p className="text-xs text-[#7f9a92]">
          {store.current.l.size} lines · drag a node to pull the web · click one to fly to it · scroll to zoom
        </p>
        <button
          onClick={() => setSpin((s) => !s)}
          className="pointer-events-auto rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[#cfe3dc] ring-1 ring-white/15 hover:bg-white/20"
        >
          {spin ? "Stop spin" : "Spin"}
        </button>
      </div>
    </div>
  )
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "")
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a.toFixed(2)})`
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
}
