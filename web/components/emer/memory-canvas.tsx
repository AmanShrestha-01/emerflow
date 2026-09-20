"use client"

// The swarm's memory as a living 3D web: agents, the places they speak for, and every patient they have
// decided about. Force-directed, so you can grab a node and the whole web follows, and lines fade out as
// the decision behind them ages. Loaded only in the browser (see memory-graph.tsx) because it needs WebGL.
//
// The lines are the memory itself: GET /api/memory is the agents' live notes, and a line exists only while
// the note behind it does. The hospital underneath (who is where) comes from the feed the board already
// receives. No other page imports this file.

import { useCallback, useEffect, useRef, useState } from "react"
import ForceGraph3D from "react-force-graph-3d"
import SpriteText from "three-spritetext"
import { LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry, WireframeGeometry } from "three"
import { AGENT, AGENTS, OWNER, UNIT_NAME } from "@/lib/emer/agents"
import type { HState, Patient } from "@/lib/emer/hospital"

const UNITS = ["ER", "RESUS", "HALLWAY", "ICU", "STEPDOWN", "WARD", "OR", "PACU", "LOUNGE"]
// A busy hour can leave every agent holding sixty notes. Cap what is drawn PER AGENT, newest first
// (/api/memory returns them that way), so a crowded swarm thins evenly instead of one department
// crowding the rest out — and so the hospital skeleton underneath is never what gets dropped.
const PER_AGENT = 40

// The three kinds of note an agent holds about a named patient, and what each looks like. Everything else
// it remembers (what it said, what it was asked) has no patient attached, so it makes the agent bigger
// rather than drawing a line.
const PROMISE = "#d99a2b" // offered: said it would happen
const KEPT = "#3fc3a4"    // happened: and it did
const MISSED = "#9c8f7d"  // happened: but not the way it was offered

const SEV = (s: number) => (s <= 2 ? "#e2503a" : s === 3 ? "#d99a2b" : "#3fc3a4")
const BG = "#101d1c"

// The web settles into a ball rather than a puddle: the coordinator at the core, the ten departments on a
// shell around it, the places just inside them and the patients on the outside. Radii in graph units.
const SHELL = 155
const RADIUS = (n: { id: string; kind: Kind }) =>
  n.id === "COORDINATOR" ? 0 : n.kind === "agent" ? SHELL * 0.6 : n.kind === "unit" ? SHELL * 0.42 : SHELL

/** A d3 force that eases every node towards the radius its kind belongs at. */
function shellForce(strength: number) {
  let nodes: N[] = []
  const force = (alpha: number) => {
    for (const n of nodes) {
      const d = Math.hypot(n.x || 0, n.y || 0, n.z || 0) || 1e-6
      const k = ((RADIUS(n) - d) / d) * strength * alpha
      n.vx = (n.vx || 0) + (n.x || 0) * k
      n.vy = (n.vy || 0) + (n.y || 0) * k
      n.vz = (n.vz || 0) + (n.z || 0) * k
    }
  }
  force.initialize = (ns: N[]) => { nodes = ns }
  return force
}

type Kind = "agent" | "unit" | "patient"
type N = {
  id: string; kind: Kind; label: string; sub: string; color: string; base: number
  hits: number; val: number
  x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number
  fx?: number; fy?: number; fz?: number
}
type Label = SpriteText & { material: { depthWrite: boolean }; position: { set(x: number, y: number, z: number): void } }
const STRUCTURE = new Set(["reports", "owns", "in"])  // the hospital underneath, never a memory
type L = { key: string; source: string | N; target: string | N; kind: string; color: string; fade: number }

const idOf = (e: string | N) => (typeof e === "string" ? e : e.id)

export type Note = { age_s: number; clock: number; kind: string; pid: string; name: string; text: string; here: boolean }
export type MemoryFeed = { window_s: number; agents: { unit: string; notes: Note[] }[] }

export function MemoryCanvas({
  st, maxAgeS, notes, width, height, onPick,
}: {
  st: HState | null
  maxAgeS: number
  notes: MemoryFeed | null
  width: number
  height: number
  onPick: (id: string | null) => void
}) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const fg = useRef<any>(null)
  const store = useRef({ n: new Map<string, N>(), l: new Map<string, L>(), shape: "" })
  const labels = useRef(new Map<string, Label>())
  const touched = useRef(false) // once the viewer moves the camera, stop re-framing it for them
  const [data, setData] = useState<{ nodes: N[]; links: L[] }>({ nodes: [], links: [] })
  const [hot, setHot] = useState<{ nodes: Set<string>; links: Set<string> }>({ nodes: new Set(), links: new Set() })
  const [spin, setSpin] = useState(true)

  // Rebuild the web out of what the agents are holding right now. Every line is one live note; when the
  // note ages out of memory on the server the line is simply not here any more. Nodes are kept across
  // updates so the web never jumps.
  useEffect(() => {
    const want = new Map<string, N>()
    const links = new Map<string, L>()
    const keep = store.current.n
    const window = notes?.window_s || 900

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

    // the hospital underneath: departments report to the coordinator and speak for their own places,
    // and every patient sits in the place holding them
    for (const a of AGENTS) if (a.id !== "COORDINATOR") join("COORDINATOR", a.id, "reports", "#3d5a54", 1)
    for (const u of UNITS) join(OWNER[u] || "ER", `unit:${u}`, "owns", AGENT[OWNER[u]]?.to || "#6b7d78", 1)
    for (const p of (st?.patients || []) as Patient[]) {
      if (!want.has(p.pid)) continue
      if (p.unit && want.has(`unit:${p.unit}`)) join(`unit:${p.unit}`, p.pid, "in", "#57736c", 1)
      else join("ER", p.pid, "in", "#57736c", 1)
    }

    // and the memory on top: one line per note still in an agent's head
    const held: Record<string, number> = {}
    for (const a of notes?.agents || []) {
      if (!want.has(a.unit)) continue
      let drawnHere = 0
      for (const n of a.notes) {
        if (!n.here || n.age_s > maxAgeS) continue
        held[a.unit] = (held[a.unit] || 0) + 1
        if (!n.pid || !want.has(n.pid) || drawnHere >= PER_AGENT) continue
        drawnHere++
        const fade = Math.max(0.05, 1 - n.age_s / window)
        if (n.kind === "offered") join(a.unit, n.pid, "offered", PROMISE, fade)
        else if (n.kind === "happened") {
          const done = / moved to /.test(n.text)
          join(a.unit, n.pid, done ? "kept" : "missed", done ? KEPT : MISSED, fade)
        }
      }
    }

    const drawn = [...links.values()]
    for (const l of drawn) {
      if (l.kind === "offered" || l.kind === "kept" || l.kind === "missed") {
        want.get(idOf(l.source))!.hits++
        want.get(idOf(l.target))!.hits++
      }
    }
    for (const n of want.values()) {
      // an agent swells with everything it is holding, a patient with how many agents still have them in mind
      const busy = n.kind === "agent" ? held[n.id] || 0 : n.hits
      n.val = n.base + Math.min(n.base * 1.8, busy * (n.kind === "patient" ? 0.5 : 0.22))
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
  }, [st?.patients, notes, maxAgeS])

  // gentle forces: short leashes for the skeleton, longer for patients, so clusters stay readable
  useEffect(() => {
    const g = fg.current
    if (!g) return
    g.d3Force("center")?.strength(1) // keep the ball on the middle of its shell
    g.d3Force("charge")?.strength(-34).distanceMax(260)
    g.d3Force("link")?.distance((l: L) => (l.kind === "reports" ? 46 : l.kind === "owns" ? 22 : l.kind === "in" ? 14 : 30))
      .strength((l: L) => (l.kind === "reports" ? 0.35 : l.kind === "in" ? 0.7 : 0.25))
    g.d3Force("shell", shellForce(0.9))

    // a glass shell around it all, so the memory reads as one object rather than a cloud
    const glass = new Mesh(
      new SphereGeometry(SHELL * 1.08, 32, 24),
      new MeshBasicMaterial({ color: 0x2f4a45, transparent: true, opacity: 0.05, depthWrite: false }),
    )
    const wire = new LineSegments(
      new WireframeGeometry(new SphereGeometry(SHELL * 1.08, 20, 14)),
      new LineBasicMaterial({ color: 0x2f4a45, transparent: true, opacity: 0.16, depthWrite: false }),
    )
    g.scene().add(glass)
    g.scene().add(wire)
    g.cameraPosition({ z: 430 })
    return () => { g.scene().remove(glass); g.scene().remove(wire) }
  }, [])

  useEffect(() => {
    const apply = () => {
      const c = fg.current?.controls?.()
      if (c) { c.autoRotate = spin && !document.hidden; c.autoRotateSpeed = 0.5 }
    }
    apply()
    document.addEventListener("visibilitychange", apply)
    return () => document.removeEventListener("visibilitychange", apply)
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

  const held = (notes?.agents || []).reduce((t, a) => t + a.notes.filter((n) => n.here && n.age_s <= maxAgeS).length, 0)
  const dim = hot.nodes.size > 0
  // Hovering pushes the rest back rather than switching it off: a flat dark grey made the whole sphere
  // look dead every time the pointer crossed a node.
  const nodeColor = useCallback((n: N) => (!dim || hot.nodes.has(n.id) ? n.color : withAlpha(n.color, 0.3)), [dim, hot])
  const linkColor = useCallback((l: L) => {
    // Highlighting a structure line keeps it grey: "this is where they are lying" must never look like
    // "this is something an agent remembers".
    if (dim) return hot.links.has(l.key) ? (STRUCTURE.has(l.kind) ? "#7d9891" : l.color) : withAlpha(l.color, 0.07)
    const a = l.kind === "in" || l.kind === "reports" ? 0.13 : l.kind === "owns" ? 0.22 : 0.45 + l.fade * 0.5
    return withAlpha(l.color, a)
  }, [dim, hot])

  const nodeObject = useCallback((n: N) => {
    if (n.kind === "patient") return null
    // Building a text sprite draws a canvas, so keep each one: the web rebuilds often, the labels do not.
    let t = labels.current.get(n.id)
    if (!t) {
      t = new SpriteText(n.label) as Label
      t.color = n.kind === "agent" ? "#f5f0e4" : "#a7c4bb"
      t.textHeight = n.kind === "agent" ? (n.id === "COORDINATOR" ? 7 : 5.5) : 3.4
      t.fontWeight = n.kind === "agent" ? "700" : "500"
      t.material.depthWrite = false // labels stay legible through the web instead of flickering behind it
      labels.current.set(n.id, t)
    }
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
        nodeResolution={8}
        nodeColor={nodeColor as any}
        nodeThreeObject={nodeObject as any}
        nodeThreeObjectExtend
        nodeLabel={(n: N) =>
          `<div style="background:#0d1918;color:#f5f0e4;border:1px solid #2f4a45;border-radius:10px;padding:6px 9px;font:500 12px Inter,sans-serif;max-width:220px">
             <b>${esc(n.label)}</b><br/><span style="color:#93b0a8">${esc(n.sub)}</span>
             ${n.hits ? `<br/><span style="color:#93b0a8">${n.hits} note${n.hits === 1 ? "" : "s"} still held about them</span>` : ""}
           </div>` as any
        }
        linkColor={linkColor as any}
        linkWidth={(l: L) => (STRUCTURE.has(l.kind) ? (hot.links.has(l.key) ? 0.7 : 0.35) : hot.links.has(l.key) ? 2 : 0.7 + l.fade * 0.9)}
        linkOpacity={1}
        linkCurvature={(l: L) => (l.kind === "offered" || l.kind === "kept" || l.kind === "missed" ? 0.22 : 0)}
        linkDirectionalParticles={(l: L) => (l.fade > 0.94 && l.kind === "kept" ? 2 : 0)}
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
        cooldownTime={2500}
      />
      <div className="pointer-events-none absolute left-4 top-4 space-y-1.5 text-[11px] text-[#9fb9b1]">
        <p className="font-bold uppercase tracking-wide text-[#7f9a92]">Every line is a note still in mind</p>
        <Key color="#d99a2b" text="offered — said it would move them" />
        <Key color="#3fc3a4" text="kept — and it happened" />
        <Key color="#9c8f7d" text="missed — it did not" />
        <Key color="#3d5a54" text="the hospital underneath: who reports to whom, who is where" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
        <p className="text-xs text-[#7f9a92]">
          {held} notes held · drag a node to pull the web · click one to fly to it · scroll to zoom
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

function Key({ color, text }: { color: string; text: string }) {
  return (
    <p className="flex items-center gap-2">
      <span className="h-0.5 w-5 shrink-0 rounded-full" style={{ background: color }} />
      {text}
    </p>
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
