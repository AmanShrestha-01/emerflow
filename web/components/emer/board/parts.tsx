"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Ambulance, BedDouble, Bus, Clock3, Flame, Hand, HeartPulse, Pause, Play, Sparkles, UserRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { api, type Approval, type HState, type Patient, useHospital } from "@/lib/emer/hospital"
import { SEVERITY, type BedGroup } from "@/lib/emer/beds"
import { PLACE, UNIT_NAME, plainText } from "@/lib/emer/agents"

const cap = (t?: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "")

/* ---------- KPIs ---------- */
const FREE_UNITS = ["ER", "ICU", "STEPDOWN", "WARD", "OR"]

export function Kpis({ st }: { st: HState }) {
  const free = (st.units || []).filter((u) => FREE_UNITS.includes(u.unit)).reduce((s, u) => s + Math.max(0, u.beds - u.occupied - u.reserved), 0)
  const waiting = st.metrics?.waiting ?? 0
  const incoming = (st.patients || []).filter((p) => p.state === "incoming")
  const next = incoming.reduce((m, p) => Math.min(m, p.eta ?? 999), 999)
  const decisions = (st.approvals || []).length + (st.holds || []).length
  const tiles = [
    { k: "Free beds", v: free, cap: `${free} free across the main units`, icon: BedDouble, dot: "bg-[#3fc3a4]" },
    { k: "Waiting for a bed", v: waiting, cap: waiting ? `Longest wait ${st.metrics?.longest_wait ?? 0} min` : "No one is waiting", icon: Clock3, dot: "bg-[#ffc861]" },
    { k: "Big decisions for you", v: decisions, cap: decisions ? "The AI can't do these without you" : "Nothing to decide", icon: Hand, dot: "bg-[#ff7a6b]" },
    { k: "Arriving by ambulance", v: incoming.length, cap: incoming.length ? `Next one in ${next} min` : "None on the way", icon: Ambulance, dot: "bg-[#a99bff]" },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map(({ k, v, cap, icon: I, dot }) => (
        <div key={k} className="card-dark rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[15px] text-white/80"><span className={`size-2 rounded-full ${dot}`} />{k}</p>
            <I className="size-5 text-white/40" strokeWidth={1.75} />
          </div>
          <motion.p key={v} initial={{ y: 6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} className="tabular mt-4 text-5xl font-bold leading-none">
            {v}
          </motion.p>
          <p className="mt-3 text-[15px] text-white/70">{cap}</p>
        </div>
      ))}
    </div>
  )
}

/* ---------- Bed wall ---------- */
export function BedWall({ groups, recent, onOpen }: { groups: BedGroup[]; recent: Set<string>; onOpen: (pid: string) => void }) {
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const used = g.beds - g.free
        const pct = g.beds ? Math.min(100, Math.round((used / g.beds) * 100)) : 0
        return (
          <section key={g.id} aria-label={g.name}>
            <div className="mb-2.5 flex items-center gap-3">
              <h3 className="font-heading text-[17px] font-bold text-ink">{g.name}</h3>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/70">
                <motion.div
                  className={`h-full rounded-full ${pct >= 90 ? "bg-critical" : pct >= 75 ? "bg-human" : "bg-jade"}`}
                  animate={{ width: `${pct}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${g.free ? "bg-mist text-jade-deep" : "bg-critical-soft text-critical"}`}>
                {g.free} of {g.beds} free
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
              {g.tiles.map((t) => {
                const p = t.patient
                const sev = p ? SEVERITY[p.severity] : null
                const glow = !!t.pid && recent.has(t.pid)
                if (t.kind === "empty") {
                  return (
                    <div key={t.num} className="flex h-[62px] items-center gap-2.5 rounded-2xl border border-dashed border-jade/35 bg-white/40 px-2.5 text-sm font-semibold text-jade-deep/70">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-dashed border-jade/35 text-jade/50">
                        <BedDouble className="size-4.5" strokeWidth={1.6} />
                      </span>
                      <span className="flex-1">Empty</span>
                      <span className="tabular self-start pt-1.5 text-[11px] font-bold text-jade-deep/45">{t.num}</span>
                    </div>
                  )
                }
                if (t.kind === "booked") {
                  // A bed being made ready for a patient who is on the way.
                  return (
                    <motion.button
                      key={t.num + (t.pid || "")}
                      layout
                      onClick={() => t.pid && onOpen(t.pid)}
                      className="bed-filling relative flex h-[62px] min-w-0 items-center gap-2.5 overflow-hidden rounded-2xl px-2.5 text-left ring-1 ring-ai/30"
                    >
                      <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-ai text-white">
                        <BedDouble className="size-4.5" />
                        <span className="absolute -right-1 -top-1 size-3 rounded-full bg-ai ring-2 ring-white animate-pulse-dot" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink">Getting ready</span>
                        <span className="block truncate text-xs text-ink-soft">For {p?.name || "a patient"}</span>
                      </span>
                      <span className="tabular self-start pt-1.5 text-[11px] font-bold text-ink-soft">{t.num}</span>
                    </motion.button>
                  )
                }
                const hex = sev?.hex || "#3d625c"
                const soft = sev?.soft || "#eef2f1"
                return (
                  <motion.button
                    key={t.num + (t.pid || "")}
                    layout
                    onClick={() => t.pid && onOpen(t.pid)}
                    disabled={!t.pid}
                    title={sev ? `${sev.label} · bed ${t.num}` : `Bed ${t.num} in use`}
                    className={`relative flex h-[62px] min-w-0 items-center gap-2.5 overflow-hidden rounded-2xl bg-white px-2.5 pl-3 text-left ring-1 transition-transform hover:-translate-y-0.5 ${glow ? "shadow-[0_0_0_2px_#6d5df6,0_0_22px_-2px_rgb(109_93_246/0.6)]" : "shadow-[0_6px_16px_-12px_rgb(14_59_54/0.5)]"} ${t.over ? "ring-critical" : "ring-white"}`}
                  >
                    {/* the occupied tint; on a fresh arrival it sweeps in from the left like the bed filling up */}
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 origin-left"
                      style={{ background: soft }}
                      initial={glow ? { scaleX: 0 } : false}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 1.1, ease: "easeOut" }}
                    />
                    <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full" style={{ background: hex }} />
                    <span className="relative grid size-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: hex }}>
                      <BedDouble className="size-4.5" />
                      {glow && (
                        <motion.span
                          aria-hidden
                          className="absolute inset-0 rounded-xl ring-2"
                          style={{ ["--tw-ring-color" as string]: hex }}
                          initial={{ scale: 1, opacity: 0.9 }}
                          animate={{ scale: 1.6, opacity: 0 }}
                          transition={{ duration: 1.2, repeat: 2 }}
                        />
                      )}
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{p?.name || "In use"}</span>
                      <span className="block truncate text-xs text-ink-soft">
                        {glow ? <span className="font-bold text-ai">Just arrived</span> : cap(p?.complaint) || (sev ? sev.label : "Occupied")}
                      </span>
                    </span>
                    <span className="tabular relative self-start pt-1.5 text-[11px] font-bold text-ink-soft">{t.num}</span>
                  </motion.button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/* ---------- Big decisions ---------- */
export function approvalSentence(a: Approval) {
  if (a.sentence) return a.sentence
  if (a.action === "cancel_elective") return "Postpone tonight's planned surgeries so the recovery room can take intensive care patients?"
  if (a.action === "call_in_staff") return "Call in 2 off-duty nurses? They'd arrive in about 45 minutes."
  if (/divert/.test(a.action)) return "Send new ambulances to other hospitals for now?"
  if (/transfer/.test(a.action)) return "Move stable patients to a partner hospital?"
  return `${a.action.replace(/_/g, " ")}?`
}

export function ApproveButtons({ a, big = false, onDark = false }: { a: Approval; big?: boolean; onDark?: boolean }) {
  const { run } = useHospital()
  const [busy, setBusy] = useState<null | "yes" | "no">(null)
  const act = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no")
    try {
      await run(() => (api as any).resolveApproval(a.approval_id, yes), yes ? "Approved" : "Declined") // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch {
      setBusy(null)
    }
  }
  const size = big ? "px-6 py-2.5 text-base" : "px-4 py-1.5 text-sm"
  return (
    <div className="flex gap-2">
      <button onClick={() => act(true)} disabled={!!busy} className={`rounded-xl font-semibold disabled:opacity-60 ${onDark ? "bg-white text-ink" : "bg-ink text-white"} ${size}`}>
        {busy === "yes" ? "Saving…" : "Yes"}
      </button>
      <button onClick={() => act(false)} disabled={!!busy} className={`rounded-xl font-semibold ring-1 disabled:opacity-60 ${onDark ? "bg-transparent text-white ring-white/30" : "bg-white text-ink ring-ink/15"} ${size}`}>
        {busy === "no" ? "Saving…" : "No"}
      </button>
    </div>
  )
}

export function Decisions({ st }: { st: HState }) {
  const list = st.approvals || []
  if (!list.length) {
    return <p className="rounded-2xl bg-white/50 px-4 py-3 text-sm text-ink-soft">Nothing to decide right now. When the AI wants to call in staff or postpone surgery, it asks you here.</p>
  }
  return (
    <ul className="space-y-2.5">
      <AnimatePresence initial={false}>
        {list.map((a) => (
          <motion.li key={a.approval_id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="card-dark rounded-2xl p-5">
            <p className="text-[17px] leading-snug text-white">{approvalSentence(a)}</p>
            <p className="mt-3 text-sm text-white/60">Suggested by the AI. Only you can say yes.</p>
            <div className="mt-4"><ApproveButtons a={a} onDark /></div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

/* ---------- Arriving now ---------- */
export function Arrivals({ st, recent, onOpen }: { st: HState; recent: Set<string>; onOpen: (pid: string) => void }) {
  const rows = (st.patients || [])
    .filter((p) => p.state === "incoming" || p.state === "waiting" || (p.state === "placed" && recent.has(p.pid)))
    .sort((a, b) => a.severity - b.severity)
    .slice(0, 8)
  if (!rows.length) return <p className="rounded-2xl bg-white/50 px-4 py-3 text-sm text-ink-soft">No one is on the way. Press Bus crash or Busy night to put the hospital under pressure.</p>
  return (
    <ul className="divide-y divide-ink/5">
      {rows.map((p) => {
        const sev = SEVERITY[p.severity]
        const where = p.state === "incoming" ? `Arriving in ${p.eta ?? "?"} min` : p.state === "waiting" ? "Waiting for a bed" : UNIT_NAME[p.unit || ""] || "Placed"
        const tone = p.state === "incoming" ? "bg-ai-soft text-ai" : p.state === "waiting" ? "bg-human-soft text-human" : "bg-mist text-jade-deep"
        return (
          <li key={p.pid}>
            <button onClick={() => onOpen(p.pid)} className="flex w-full items-center gap-3 py-2.5 text-left">
              <span className={`size-2.5 shrink-0 rounded-full ${sev?.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{p.name}</span>
                <span className="block truncate text-xs text-ink-soft">{cap(p.complaint)}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{where}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Patient details ---------- */
export function PatientSheet({ pid, onClose }: { pid: string | null; onClose: () => void }) {
  const { st, names } = useHospital()
  const p: Patient | undefined = (st?.patients || []).find((x) => x.pid === pid)
  const sev = p ? SEVERITY[p.severity] : null
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong rounded-3xl p-6 sm:max-w-md">
        {p && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 font-heading text-2xl font-bold text-ink">
                <span className="grid size-11 place-items-center rounded-xl bg-ink text-white"><UserRound className="size-5" /></span>
                {p.name}
              </DialogTitle>
              <DialogDescription className="text-[15px] text-ink-soft">
                {p.age ? `${p.age} years · ` : ""}{cap(p.complaint)}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              {sev && <span className={`rounded-full bg-white px-3 py-1 text-sm font-bold ring-1 ${sev.ring} ${sev.text}`}>{sev.label}</span>}
              <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-ink ring-1 ring-ink/10">
                {p.state === "incoming" ? `Arriving in ${p.eta} min` : p.state === "waiting" ? "Waiting for a bed" : p.unit ? `In ${PLACE[p.unit] || p.unit}` : p.state}
              </span>
            </div>
            {(p.hr || p.bp || p.spo2) && (
              <div className="grid grid-cols-3 gap-2">
                {[["Heart rate", p.hr ? `${p.hr}` : "–", "bpm"], ["Blood pressure", p.bp || "–", ""], ["Oxygen", p.spo2 ? `${p.spo2}%` : "–", ""]].map(([k, v, u]) => (
                  <div key={k} className="rounded-2xl bg-white/80 p-3">
                    <p className="text-xs font-semibold text-ink-soft">{k}</p>
                    <p className="font-heading tabular text-lg font-bold text-ink">{v} <span className="text-xs font-medium text-ink-soft">{u}</span></p>
                  </div>
                ))}
              </div>
            )}
            {p.need && <p className="flex items-center gap-2 text-sm font-semibold text-ink"><HeartPulse className="size-4 text-critical" /> Needs: {p.need.toLowerCase()}</p>}
            {p.note && (
              <div className="rounded-2xl bg-ai-soft/70 p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold text-ai"><Sparkles className="size-3.5" /> Why, from {p.note_by || "the hospital"}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{plainText(p.note, names)}</p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Speed and scenarios ---------- */
const SPEEDS = [0.25, 0.5, 1, 2, 5]
const SPEED_LABEL: Record<number, string> = { 0.25: "¼×", 0.5: "½×", 1: "1×", 2: "2×", 5: "5×" }

export function SpeedMeter({ st }: { st: HState }) {
  const { control, run } = useHospital()
  const live = st.speed ?? 0.5
  const [idx, setIdx] = useState(Math.max(0, SPEEDS.indexOf(live)))
  useEffect(() => {
    const i = SPEEDS.indexOf(live)
    if (i >= 0) setIdx(i)
  }, [live])
  const pick = (i: number) => {
    setIdx(i)
    if (SPEEDS[i] !== live || st.paused) run(() => control("speed", { speed: SPEEDS[i] }), `Speed ${SPEED_LABEL[SPEEDS[i]]}`).catch(() => {})
  }
  return (
    <div className="glass flex h-11 items-center gap-3 rounded-2xl pl-1.5 pr-3" title="1× = one hospital minute every real second">
      <button
        onClick={() => run(() => control(st.paused ? "resume" : "pause"), st.paused ? "Resumed" : "Paused").catch(() => {})}
        aria-label={st.paused ? "Resume the clock" : "Pause the clock"}
        className={`grid size-8 place-items-center rounded-xl text-white ${st.paused ? "bg-ai" : "bg-ink"}`}
      >
        {st.paused ? <Play className="size-3.5 fill-current" /> : <Pause className="size-3.5 fill-current" />}
      </button>
      <div className="w-24">
        <p className="text-[11px] font-semibold leading-none text-ink-soft">{st.paused ? "Paused" : "Speed"}</p>
        <Slider
          aria-label="Simulation speed"
          min={0}
          max={SPEEDS.length - 1}
          step={1}
          value={[idx]}
          onValueChange={(v) => setIdx(Array.isArray(v) ? v[0] : (v as number))}
          onValueCommitted={(v) => pick(Array.isArray(v) ? v[0] : (v as number))}
          className="mt-1.5"
        />
      </div>
      <span className="tabular w-7 text-right font-heading text-sm font-bold text-ink">{SPEED_LABEL[SPEEDS[idx]]}</span>
    </div>
  )
}

export function ScenarioButtons({ st }: { st: HState }) {
  const { surge, run } = useHospital()
  const [busy, setBusy] = useState<string | null>(null)
  const busyLeft = st.busy_until != null ? st.busy_until - (st.clock ?? 0) : 0
  const go = async (kind: "bus" | "busy") => {
    setBusy(kind)
    try {
      await run(() => surge(kind), (r: any) => (kind === "bus" ? `Bus crash: ${r?.incoming ?? 25} patients on the way` : "Busy night: more everyday patients for the next hour")) // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch {
      /* toast shown */
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <button onClick={() => go("busy")} disabled={!!busy} className={`glass inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-bold ${busyLeft > 0 ? "text-human" : "text-ink"}`}>
        <Flame className="size-4" /> {busyLeft > 0 ? `Busy night · ${busyLeft}m` : "Busy night"}
      </button>
      <button onClick={() => go("bus")} disabled={!!busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-critical px-4 text-sm font-semibold text-white">
        <Bus className="size-4" /> {busy === "bus" ? "Sending…" : "Bus crash"}
      </button>
    </>
  )
}
