"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { BedDouble, Check, Hand, ShieldCheck, Siren, Zap } from "lucide-react"
import { AGENT, DEPARTMENTS, PLACE, plainText } from "@/lib/emer/agents"
import { useHospital, type FeedEvent } from "@/lib/emer/hospital"
import { AgentAvatar } from "./avatar"

// The AI round as a living diagram on a tilted 3D stage. Positions are in stage units (W x H); the stage scales to fit.
const W = 1320
const H = 640
type Status = "idle" | "working" | "done" | "flagged"
type Node = { id: string; x: number; y: number; kind: "code" | "ai" | "human" | "start" }

const DEPT_POS = DEPARTMENTS.map((d, i) => {
  const t = (i - (DEPARTMENTS.length - 1) / 2) / ((DEPARTMENTS.length - 1) / 2) // -1..1
  return { id: d.id, x: 560 + 80 * (1 - t * t), y: H / 2 + t * 268 }
})
const NODES: Node[] = [
  { id: "trigger", x: 100, y: H / 2, kind: "start" },
  { id: "fastlane", x: 320, y: H / 2, kind: "code" },
  ...DEPT_POS.map((p) => ({ ...p, kind: "ai" as const })),
  { id: "COORDINATOR", x: 880, y: H / 2, kind: "ai" },
  { id: "validator", x: 1080, y: H / 2, kind: "code" },
  { id: "human", x: 1225, y: H / 2 - 130, kind: "human" },
  { id: "outcome", x: 1225, y: H / 2 + 130, kind: "code" },
]
const POS = Object.fromEntries(NODES.map((n) => [n.id, n]))
const EDGES: [string, string][] = [
  ["trigger", "fastlane"],
  ...DEPARTMENTS.map((d) => ["fastlane", d.id] as [string, string]),
  ...DEPARTMENTS.map((d) => [d.id, "COORDINATOR"] as [string, string]),
  ["COORDINATOR", "validator"],
  ["validator", "human"],
  ["validator", "outcome"],
]
const LABEL: Record<string, { title: string; sub: string; icon: typeof Zap }> = {
  trigger: { title: "Round starts", sub: "Patients waiting or beds low", icon: Siren },
  fastlane: { title: "Hospital rules", sub: "Place the obvious, instantly", icon: Zap },
  validator: { title: "Rule check", sub: "Every move, against live beds", icon: ShieldCheck },
  human: { title: "A person", sub: "Approves the big actions", icon: Hand },
  outcome: { title: "Beds updated", sub: "The hospital after this round", icon: BedDouble },
}

function curve(a: Node, b: Node) {
  const mx = (a.x + b.x) / 2
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
}

export function useRound(cid: string | null) {
  const { ev } = useHospital()
  return useMemo(() => {
    const feed = ev.feed.filter((e: FeedEvent) => e.cycle_id === cid)
    const msgs = ev.messages.filter((m) => m.cycle_id === cid)
    const status: Record<string, Status> = {}
    const say: Record<string, string> = {}
    const start = feed.find((e) => e.type === "cycle.start")
    const end = feed.find((e) => e.type === "cycle.end")
    const plan = feed.find((e) => e.type === "coordinator.plan")
    if (start) status.trigger = "done"
    if (start) status.fastlane = "done"
    const reported = new Set(feed.filter((e) => e.type === "agent.status").map((e) => e.data?.unit))
    for (const m of msgs) {
      if (AGENT[m.from]) {
        reported.add(m.from)
        say[m.from] = m.text
      }
    }
    for (const d of DEPARTMENTS) {
      if (reported.has(d.id)) status[d.id] = "done"
      else if (ev.typing?.[d.id]?.cycle_id === cid) status[d.id] = "working"
    }
    if (plan) status.COORDINATOR = "done"
    else if (start && (ev.typing?.COORDINATOR?.cycle_id === cid || reported.size >= DEPARTMENTS.length)) status.COORDINATOR = "working"
    const applied = feed.filter((e) => e.type === "move.applied")
    const dropped = feed.filter((e) => e.type === "move.dropped" && e.data?.pid)
    const asks = feed.filter((e) => e.type === "approval.requested")
    if (end) {
      status.validator = "done"
      status.outcome = "done"
      status.human = asks.length ? "flagged" : "done"
    } else if (plan) status.validator = "working"
    return { start, end, plan, status, say, applied, dropped, asks, trigger: start?.data?.trigger as string | undefined }
  }, [ev.feed, ev.messages, ev.typing, cid])
}

export function WorkflowStage({ cid, selected, onSelect }: { cid: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const { names } = useHospital()
  const reduce = useReducedMotion()
  const r = useRound(cid)
  const wrap = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth / W) * 0.9)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The agent that spoke last gets a speech bubble.
  const speaker = useMemo(() => {
    const ids = Object.keys(r.say)
    return ids.length ? ids[ids.length - 1] : null
  }, [r.say])

  const active = (a: string, b: string) => {
    const sa = r.status[a], sb = r.status[b]
    return (sa === "done" && (sb === "working" || sb === undefined) && !!r.start && !r.end) || sb === "working"
  }

  return (
    <div ref={wrap} className="relative w-full" style={{ height: H * scale + 40 }}>
      <div className="absolute left-1/2 top-0 origin-top" style={{ width: W, height: H, transform: `translateX(-50%) scale(${scale})`, perspective: 1600 }}>
        <div className="relative h-full w-full" style={{ transform: reduce ? undefined : "rotateX(11deg)", transformStyle: "preserve-3d" }}>
          {/* stage floor */}
          <div aria-hidden className="absolute inset-0 rounded-[40px] bg-white/35 ring-1 ring-white/80 [background-image:radial-gradient(rgb(14_59_54/0.12)_1px,transparent_1px)] [background-size:26px_26px]" />
          <svg className="absolute inset-0 overflow-visible" width={W} height={H} aria-hidden>
            <defs>
              <linearGradient id="edge-ai" x1="0" x2="1">
                <stop offset="0" stopColor="#1f8a70" />
                <stop offset="1" stopColor="#6d5df6" />
              </linearGradient>
            </defs>
            {EDGES.map(([a, b]) => {
              const d = curve(POS[a], POS[b])
              const on = active(a, b)
              const done = r.status[a] === "done" && (r.status[b] === "done" || r.status[b] === "flagged")
              return (
                <g key={a + b}>
                  <path d={d} fill="none" stroke={done ? "url(#edge-ai)" : "rgb(14 59 54 / 0.14)"} strokeWidth={done ? 2.5 : 2} strokeLinecap="round" />
                  {on && !reduce && (
                    <>
                      <path d={d} fill="none" stroke="#6d5df6" strokeWidth={2.5} strokeDasharray="6 10" strokeLinecap="round">
                        <animate attributeName="stroke-dashoffset" from="32" to="0" dur="0.8s" repeatCount="indefinite" />
                      </path>
                      <circle r={5} fill="#6d5df6">
                        <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                      </circle>
                    </>
                  )}
                </g>
              )
            })}
          </svg>

          {NODES.map((n) => {
            const s = r.status[n.id] || "idle"
            const sel = selected === n.id
            const a = AGENT[n.id]
            const lab = LABEL[n.id]
            const Icon = lab?.icon
            const isCoord = n.id === "COORDINATOR"
            return (
              <motion.button
                key={n.id}
                onClick={() => onSelect(n.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-left"
                style={{ left: n.x, top: n.y }}
                animate={s === "working" && !reduce ? { y: [0, -5, 0] } : { y: 0 }}
                transition={s === "working" ? { repeat: Infinity, duration: 1.4 } : undefined}
                aria-label={a ? `${a.name} AI, ${s}` : `${lab.title}, ${s}`}
              >
                <div
                  className={`relative flex items-center gap-2.5 rounded-2xl px-3 py-2.5 transition-shadow ${
                    sel ? "ring-2 ring-ai" : ""
                  } ${isCoord ? "bg-ink text-white" : "bg-white/90 text-ink"} ${
                    s === "idle" ? "opacity-60" : ""
                  } shadow-[0_16px_30px_-18px_rgb(14_59_54/0.7)]`}
                  style={{ width: isCoord ? 186 : 168 }}
                >
                  {s === "working" && <span aria-hidden className="ai-ring animate-spin-ring absolute -inset-[3px] -z-10 rounded-[19px]" />}
                  {a ? (
                    <AgentAvatar id={n.id} size={isCoord ? 42 : 34} typing={s === "working"} />
                  ) : (
                    <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${n.kind === "human" ? "bg-human-soft text-human" : n.kind === "start" ? "bg-critical-soft text-critical" : "bg-mist text-jade-deep"}`}>
                      <Icon className="size-4.5" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold leading-tight">{a ? a.name : lab.title}</span>
                    <span className={`block text-[11.5px] leading-tight ${isCoord ? "text-white/70" : "text-ink-soft"}`}>
                      {a ? a.persona : lab.sub}
                    </span>
                  </span>
                  {(s === "done" || s === "flagged") && (
                    <span className={`absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full text-white ${s === "flagged" ? "bg-human" : "bg-jade"}`}>
                      {s === "flagged" ? <Hand className="size-3" /> : <Check className="size-3" />}
                    </span>
                  )}
                </div>
              </motion.button>
            )
          })}

          {/* the latest speaker's words */}
          <AnimatePresence>
            {speaker && r.say[speaker] && !r.end && (
              <motion.div
                key={speaker + r.say[speaker].slice(0, 12)}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                className="glass-strong pointer-events-none absolute z-20 w-[300px] rounded-2xl rounded-bl-md p-3 text-[13px] leading-snug text-ink"
                style={speaker === "COORDINATOR" ? { left: POS[speaker].x - 150, top: POS[speaker].y - 170 } : { left: POS[speaker].x + 70, top: POS[speaker].y - 92 }}
              >
                <b style={{ color: AGENT[speaker].to }}>{AGENT[speaker].persona}: </b>
                <span className="line-clamp-3">{plainText(r.say[speaker], names)}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/** What one node did in this round, in plain words. */
export function NodeDetail({ id, cid }: { id: string; cid: string | null }) {
  const { ev, names, st } = useHospital()
  const r = useRound(cid)
  const a = AGENT[id]
  const name = (pid: string) => names[pid] || "a patient"
  let lines: string[] = []
  let title = a ? `${a.name} AI · ${a.persona}` : LABEL[id]?.title
  let about = a ? `${a.role}. Pushes for: ${a.pushesFor.toLowerCase()}.` : LABEL[id]?.sub
  let fromEarlier = false
  if (a) {
    const mine = ev.messages.filter((m) => m.from === id)
    let said = mine.filter((m) => m.cycle_id === cid)
    if (!said.length && mine.length) {
      const last = mine[mine.length - 1].cycle_id
      said = mine.filter((m) => m.cycle_id === last)
      fromEarlier = said.length > 0
    }
    lines = said.map((m) => plainText(m.text, names))
  } else if (id === "trigger") {
    lines = [r.trigger ? `Started because: ${r.trigger}.` : "Waiting for the next round."]
  } else if (id === "fastlane") {
    about = "Plain code, no AI: critical patients always get a bed at once; anyone with a clearly fitting free bed gets it."
    const i = ev.feed.findIndex((e) => e === r.start)
    let j = i
    while (j > 0 && ev.feed[j - 1].type !== "cycle.end") j--
    lines = ev.feed.slice(j, i).filter((e) => e.type === "move.applied" && e.data?.source === "fastlane").slice(-8)
      .map((e) => `${name(e.data.pid)} → ${PLACE[e.data.to_unit] || e.data.to_unit}`)
    if (!lines.length) lines = ["No obvious cases right before this round."]
  } else if (id === "validator") {
    lines = [
      ...r.applied.map((e) => `OK: ${name(e.data.pid)} → ${PLACE[e.data.to_unit] || e.data.to_unit}`),
      ...r.dropped.map((e) => `Not possible: ${name(e.data.pid)} → ${PLACE[e.data.to_unit] || e.data.to_unit}`),
    ]
    if (!lines.length) lines = [r.end ? "Nothing to check this round." : "Waiting for the plan."]
  } else if (id === "human") {
    lines = r.asks.length ? r.asks.map((e) => plainText(e.data.detail || e.data.reason || "", names)) : ["Nothing big to decide this round."]
  } else if (id === "outcome") {
    const waiting = st?.metrics?.waiting ?? 0
    lines = r.end ? [`${r.applied.length} patient move(s) in about ${Math.round((r.end.data?.ms || 0) / 1000)} seconds.`, `${waiting} waiting for a bed now.`] : ["The round is still going."]
  }
  if (!title) title = id
  return (
    <div>
      <div className="flex items-center gap-3">
        {a ? <AgentAvatar id={id} size={44} /> : null}
        <div>
          <h3 className="font-heading text-lg font-bold text-ink">{title}</h3>
          <p className="text-sm text-ink-soft">{about}</p>
        </div>
      </div>
      {fromEarlier && <p className="mt-3 text-xs font-semibold text-ink-soft">From the round before; this one is still going.</p>}
      <ul className="mt-4 space-y-2">
        {(lines.length ? lines : ["Nothing said yet in this round."]).map((l, i) => (
          <li key={i} className="rounded-2xl bg-white/80 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink">{l}</li>
        ))}
      </ul>
    </div>
  )
}
