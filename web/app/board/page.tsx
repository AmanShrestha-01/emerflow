"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { BedDouble, Sparkles, Workflow } from "lucide-react"
import { LiveBadge, Nav } from "@/components/emer/nav"
import { LiveChat } from "@/components/emer/live-chat"
import { Arrivals, BedWall, Decisions, Kpis, PatientSheet, SpeedMeter, StopButton } from "@/components/emer/board/parts"
import { DemoStory, useStory } from "@/components/emer/board/demo-story"
import { MyUnit } from "@/components/emer/board/my-unit"
import { useBedGroups } from "@/lib/emer/beds"
import { useHospital, type Patient } from "@/lib/emer/hospital"
import { Gate } from "@/components/emer/gate"

const RECENT = 10 // hospital-minutes a move keeps glowing
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function status(st: NonNullable<ReturnType<typeof useHospital>["st"]>) {
  const incoming = (st.patients || []).filter((p) => p.state === "incoming").length
  const busyLeft = st.busy_until != null ? st.busy_until - (st.clock ?? 0) : 0
  const crash = st.bus_crash_at != null && (st.clock ?? 0) - st.bus_crash_at < 120
  const what = cap(st.incident || "bus crash")
  if (crash && incoming) return `${what}: ${incoming} patient${incoming === 1 ? "" : "s"} arriving`
  if (crash) return `${what}: everyone has arrived`
  if (busyLeft > 0) return `Busy night: ${busyLeft} min left`
  return "A normal evening"
}

function clockText(st: { clock?: number; clock_start?: number }) {
  const t = (st.clock_start ?? 1260) + (st.clock ?? 0)
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}


function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-2xl p-6 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function BoardPage() {
  return (
    <Gate>
      <Board />
    </Gate>
  )
}

function Board() {
  const { st, ev } = useHospital()
  const story = useStory()
  const [openPid, setOpenPid] = useState<string | null>(null)
  const byPid = useMemo(() => Object.fromEntries((st?.patients || []).map((p: Patient) => [p.pid, p])), [st?.patients])
  const groups = useBedGroups(st?.units || [], byPid)
  const recent = useMemo(() => {
    const now = st?.clock ?? 0
    const s = new Set<string>()
    for (const e of ev.feed) if (e.type === "move.applied" && e.data?.pid && now - (e.clock ?? 0) <= RECENT) s.add(e.data.pid)
    return s
  }, [ev.feed, st?.clock])

  // /board?demo=1 starts the guided demo as soon as the hospital is loaded.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || !st) return
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      autoStarted.current = true
      window.history.replaceState(null, "", "/board")
      story.go(1)
    }
  }, [st, story])

  return (
    <main className="relative min-h-screen pb-16">
      <div className="pt-3"><Nav /></div>

      <div className="mx-auto mt-6 w-[min(1400px,calc(100%-24px))] space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2.5">
                <span className="h-7 w-1 rounded-full bg-[#1a2e5a]" aria-hidden="true" />
                <span className="font-[Georgia,'Times_New_Roman',serif] text-[19px] leading-none tracking-tight text-[#1a2e5a]">Johns Hopkins Hospital</span>
              </span>
              <p className="tabular text-sm font-medium text-ink-soft">{st ? clockText(st) : "--:--"}</p>
            </div>
            <h1 className="sr-only">Command board</h1>
            <p className="mt-1 text-[15px] font-medium text-ink-soft" aria-live="polite">
              {st ? status(st) : "Connecting to the hospital…"}
              {(st?.level ?? 0) >= 2 && <span className="ml-2 font-bold text-human">The hospital is very full, so extra beds are in use.</span>}
            </p>
          </div>
          {st && (
            <div className="flex flex-wrap items-center gap-2">
              {/* A dead backend used to be invisible here: the board froze and looked perfectly healthy. */}
              <LiveBadge />
              <StopButton st={st} />
              <SpeedMeter st={st} />
            </div>
          )}
        </div>

        <DemoStory story={story} />

        {!st ? (
          <div className="glass grid h-64 place-items-center rounded-3xl text-ink-soft">Loading the hospital…</div>
        ) : (
          <>
              <>
                <Kpis st={st} />
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
                  <Panel
                    title="Beds"
                    action={
                      <div className="hidden flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5 text-xs font-semibold text-ink-soft sm:flex">
                        <span className="flex items-center gap-1.5"><span className="grid size-5 place-items-center rounded-md bg-critical text-white"><BedDouble className="size-3" /></span>Critical</span>
                        <span className="flex items-center gap-1.5"><span className="grid size-5 place-items-center rounded-md bg-human text-white"><BedDouble className="size-3" /></span>Urgent</span>
                        <span className="flex items-center gap-1.5"><span className="grid size-5 place-items-center rounded-md bg-jade text-white"><BedDouble className="size-3" /></span>Stable</span>
                        <span className="flex items-center gap-1.5"><span className="bed-filling size-5 rounded-md ring-1 ring-ai/30" />Getting ready</span>
                        <span className="flex items-center gap-1.5"><span className="grid size-5 place-items-center rounded-md border border-dashed border-jade/50 text-jade/60"><BedDouble className="size-3" strokeWidth={1.6} /></span>Empty</span>
                      </div>
                    }
                  >
                    <BedWall groups={groups} recent={recent} onOpen={setOpenPid} />
                  </Panel>
                  <div className="space-y-5">
                    <Panel title="Big decisions for you">
                      <Decisions st={st} />
                    </Panel>
                    <Panel
                      title="AI meeting, live"
                      action={
                        <Link href="/workflow" className="inline-flex items-center gap-1.5 rounded-xl bg-white/70 px-3 py-1.5 text-xs font-bold text-ink">
                          <Workflow className="size-3.5" /> Workflow
                        </Link>
                      }
                    >
                      <LiveChat limit={14} className="max-h-[420px]" />
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft"><Sparkles className="size-3.5 text-ai" /> Real messages between the department AIs, latest round.</p>
                    </Panel>
                    <Panel title="Arriving now">
                      <Arrivals st={st} recent={recent} onOpen={setOpenPid} />
                    </Panel>
                  </div>
                </div>
                <Panel title="My unit: handoffs" className="mt-5">
                  <MyUnit onOpen={setOpenPid} />
                </Panel>
              </>
          </>
        )}
      </div>
      <p className="mx-auto mt-8 w-[min(1400px,calc(100%-24px))] text-xs leading-relaxed text-ink-soft">
        Demo with synthetic data: every patient, bed and number on this board is simulated, and the patient portraits are
        AI-generated pictures of people who do not exist. Hospital names are used for illustration only; EmerFlow is not
        affiliated with, endorsed by, or connected to these institutions.
      </p>
      <PatientSheet pid={openPid} onClose={() => setOpenPid(null)} />
    </main>
  )
}
