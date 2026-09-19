"use client"

import { useMemo, useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Clock, FlaskConical, Hand, TrendingUp } from "lucide-react"
import { PLACE, UNIT_NAME, plainText } from "@/lib/emer/agents"
import { useHospital, type Patient } from "@/lib/emer/hospital"

// A charge nurse's handoff list for one unit: who arrived, who left, who could move on next, who is waiting.
// Bed assignments only: it says where a patient goes and why a bed is needed, never what care to give.

const GROUPS: { id: string; label: string; units: string[] }[] = [
  { id: "ER", label: "Emergency", units: ["ER", "RESUS", "HALLWAY"] },
  { id: "ICU", label: "Intensive care", units: ["ICU"] },
  { id: "STEPDOWN", label: "Close-watch beds", units: ["STEPDOWN"] },
  { id: "WARD", label: "Ward", units: ["WARD", "LOUNGE"] },
  { id: "OR", label: "Surgery", units: ["OR", "PACU"] },
]
const WINDOW = 30 // hospital-minutes of handoffs to show
const BY: Record<string, string> = { fastlane: "Hospital rules", fallback: "Hospital rules", baseline: "Hospital rules", swarm: "AI plan, checked by the rules", human: "A person" }
const KEY = "emerflow.myUnit"

type Move = { key: string; pid: string; name: string; other: string | null; reason: string; by: string; ago: number }

function nextStep(p: Patient): string | null {
  if (p.ready_for_discharge) return "Ready to go home"
  if (!p.improving) return null
  if (p.unit === "ICU") return "Getting better: could step down to a close-watch bed"
  if (p.unit === "STEPDOWN") return "Getting better: could go down to the ward"
  return "Getting better"
}

function tests(p: Patient): string {
  const t = [p.needs_ct && "CT scan", p.needs_xray && "X-ray", p.needs_labs && "lab results"].filter(Boolean) as string[]
  return t.join(", ").replace(/, ([^,]*)$/, " and $1")
}

function Row({ pid, title, sub, tag, onOpen }: { pid: string; title: string; sub: string; tag?: string; onOpen: (pid: string) => void }) {
  return (
    <li>
      <button onClick={() => onOpen(pid)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/70">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{title}</span>
          <span className="block text-xs leading-relaxed text-ink-soft">{sub}</span>
        </span>
        {tag && <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-ink/10">{tag}</span>}
      </button>
    </li>
  )
}

function Section({ icon: Icon, title, empty, children, count }: { icon: typeof Clock; title: string; empty: string; children: React.ReactNode; count: number }) {
  return (
    <div className="rounded-2xl bg-white/50 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink"><Icon className="size-4 text-jade-deep" /> {title} <span className="text-ink-soft">{count}</span></h3>
      {count ? <ul className="max-h-64 space-y-0.5 overflow-y-auto">{children}</ul> : <p className="px-2 text-xs text-ink-soft">{empty}</p>}
    </div>
  )
}

export function MyUnit({ onOpen }: { onOpen: (pid: string) => void }) {
  const { st, ev, names } = useHospital()
  const [group, setGroup] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY) // the board renders only after login, in the browser
      if (saved && GROUPS.some((g) => g.id === saved)) return saved
    } catch {}
    return "STEPDOWN"
  })
  const pick = (id: string) => {
    setGroup(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {}
  }
  const units = GROUPS.find((g) => g.id === group)!.units
  const now = st?.clock ?? 0

  const { arrived, left } = useMemo(() => {
    const arrived: Move[] = []
    const left: Move[] = []
    for (const e of ev.feed || []) {
      if (e.type !== "move.applied" || (e.clock ?? 0) < now - WINDOW) continue
      const d = e.data || {}
      const into = units.includes(d.to_unit)
      const outOf = d.from_unit && units.includes(d.from_unit)
      if (into === outOf) continue // moves inside the unit group are not handoffs
      const m: Move = {
        key: `${e.id}`, pid: d.pid, name: d.name || names[d.pid] || "A patient",
        other: into ? d.from_unit : d.to_unit, reason: plainText(d.reason || "", names), by: BY[d.source] || "Hospital rules",
        ago: now - (e.clock ?? now),
      }
      ;(into ? arrived : left).push(m)
    }
    return { arrived: arrived.reverse(), left: left.reverse() }
  }, [ev.feed, units, now, names])

  const here = (st?.patients || []).filter((p) => p.state === "placed" && p.unit && units.includes(p.unit))
  const moveOn = here.map((p) => ({ p, step: nextStep(p) })).filter((x) => x.step) as { p: Patient; step: string }[]
  const waitingTests = [...here, ...(group === "ER" ? (st?.patients || []).filter((p) => p.state === "waiting") : [])]
    .filter((p) => tests(p))
  const paused = (st?.holds || []).filter((h: { to_unit: string }) => units.includes(h.to_unit))

  const where = (u: string | null) => (u ? PLACE[u] || UNIT_NAME[u] || u : "outside")

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Choose your unit">
        {GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={g.id === group} onClick={() => pick(g.id)}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold ring-1 transition ${g.id === group ? "bg-ink text-white ring-ink" : "bg-white/70 text-ink ring-ink/10"}`}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Section icon={ArrowDownLeft} title="Came in" count={arrived.length} empty={`Nobody moved in over the last ${WINDOW} minutes.`}>
          {arrived.map((m) => <Row onOpen={onOpen} key={m.key} pid={m.pid} title={`${m.name}, from ${where(m.other)}`} sub={`${m.reason || "Moved in"} · ${m.by}`} tag={`${m.ago} min ago`} />)}
        </Section>
        <Section icon={ArrowUpRight} title="Left" count={left.length} empty={`Nobody moved out over the last ${WINDOW} minutes.`}>
          {left.map((m) => <Row onOpen={onOpen} key={m.key} pid={m.pid} title={`${m.name}, to ${where(m.other)}`} sub={`${m.reason || "Moved out"} · ${m.by}`} tag={`${m.ago} min ago`} />)}
        </Section>
        <Section icon={TrendingUp} title="Could move on next" count={moveOn.length} empty="Nobody here is marked as getting better or ready to go home.">
          {moveOn.map(({ p, step }) => <Row onOpen={onOpen} key={p.pid} pid={p.pid} title={p.name || "A patient"} sub={step} />)}
        </Section>
        <Section icon={FlaskConical} title="Waiting before they can move" count={waitingTests.length + paused.length} empty="No tests or record checks holding anyone here.">
          {waitingTests.map((p) => <Row onOpen={onOpen} key={p.pid} pid={p.pid} title={p.name || "A patient"} sub={`Waiting for ${tests(p)}`} />)}
          {paused.map((h: { hold_id: string; pid: string; name?: string }) => (
            <Row onOpen={onOpen} key={h.hold_id} pid={h.pid} title={h.name || names[h.pid] || "A patient"} sub="Move paused: records disagree, a person must check them" tag="Paused" />
          ))}
        </Section>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft">
        <Hand className="size-3.5" /> Bed assignments only. The care team decides the care; &quot;getting better&quot; and &quot;ready to go home&quot; come from their notes (simulated here).
      </p>
    </div>
  )
}
