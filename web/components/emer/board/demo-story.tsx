"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check, X } from "lucide-react"
import { api, useHospital } from "@/lib/emer/hospital"
import { LiveChat } from "../live-chat"
import { ApproveButtons, approvalSentence } from "./parts"

// Guided demo for judges: five captioned steps over the real hospital. The clock pauses at each step and the
// presenter clicks Next. Every number shown is read from the live state. Same logic as the classic board.

const COUNTED = ["RESUS", "ER", "ICU", "STEPDOWN", "WARD"]
const HOME = new Set(["LOUNGE", "HOME", "PARTNER"])
const TITLES = ["A normal evening", "Bus crash", "The AIs meet", "The plan", "A person decides"]
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Mem = {
  crashAt: number | null; crashClock: number; cycles: string[]; cid: string | null; approvalId: string | null
  resolved: { approved?: boolean; detail?: string } | null; maxWaiting: number; waitingAtStart: number
  resumedFor: string | null; step5Clock: number; noneNeeded: boolean
}
const fresh = (): Mem => ({ crashAt: null, crashClock: 0, cycles: [], cid: null, approvalId: null, resolved: null, maxWaiting: 0, waitingAtStart: 0, resumedFor: null, step5Clock: 0, noneNeeded: false })

export function useStory() {
  const { st, ev, control, reset } = useHospital()
  const [step, setStep] = useState(0) // 0 off, 1..5, 6 finished
  const [ready, setReady] = useState(false)
  const mem = useRef<Mem>(fresh())
  const quiet = (action: string, extra?: Record<string, unknown>) => control(action, extra).catch(() => {})

  const go = async (n: number) => {
    const m = mem.current
    setReady(false)
    setStep(n)
    if (n === 1) {
      mem.current = fresh()
      await reset().catch(() => {})
      await quiet("speed", { speed: 1 })
      await quiet("pause")
      setReady(true)
    } else if (n === 2) {
      await (api as any).surge("bus").catch(() => {}) // eslint-disable-line @typescript-eslint/no-explicit-any
      await quiet("resume")
    } else if (n === 4) {
      setReady(true)
    } else if (n === 5) {
      m.approvalId = null
      m.resolved = null
      m.noneNeeded = false
      m.step5Clock = st?.clock ?? 0
      // A big decision may already be waiting from the peak of the crash: show it without restarting the clock.
      if (!(st?.approvals || []).length) await quiet("resume")
    } else if (n === 6) {
      await quiet("speed", { speed: 0.5 })
    }
  }
  const exit = async () => {
    setStep(0)
    setReady(false)
    await quiet("speed", { speed: 0.5 })
  }

  useEffect(() => {
    const m = mem.current
    const feed = ev.feed
    if (!st) return
    if (step === 2) {
      m.maxWaiting = Math.max(m.maxWaiting, st.metrics?.waiting || 0)
      if (m.crashAt == null) {
        const crash = [...feed].reverse().find((e) => e.type === "notice" && /bus crash/i.test(e.data?.text || ""))
        if (crash) {
          m.crashAt = crash.id ?? 0
          m.crashClock = crash.clock ?? 0
        }
        return
      }
      // Wait for a round about patients who are waiting (the ER is full), or 20 hospital-minutes at most.
      const start = feed.find((e) => e.type === "cycle.start" && (e.id ?? 0) > (m.crashAt ?? 0) && !m.cycles.includes(e.cycle_id || "") &&
        (/waiting/.test(e.data?.trigger || "") || (e.clock ?? 0) - m.crashClock >= 20))
      if (start && !ready) {
        m.waitingAtStart = Number((start.data?.trigger || "").match(/(\d+) waiting/)?.[1] || 0)
        m.cid = start.cycle_id || null
        m.cycles.push(start.cycle_id || "")
        quiet("pause")
        setReady(true)
      }
    } else if (step === 3 && !ready && m.cid) {
      const end = feed.find((e) => e.type === "cycle.end" && e.cycle_id === m.cid)
      if (!end) return
      const moved = feed.some((e) => e.type === "move.applied" && e.cycle_id === m.cid && e.data?.source !== "fastlane")
      if (moved) {
        quiet("pause")
        setReady(true)
        return
      }
      // That round changed nothing: let the clock run until the next round starts.
      const next = feed.find((e) => e.type === "cycle.start" && (e.id ?? 0) > (end.id ?? 0) && !m.cycles.includes(e.cycle_id || ""))
      if (next) {
        m.cid = next.cycle_id || null
        m.cycles.push(next.cycle_id || "")
        m.resumedFor = null
      } else if (m.resumedFor !== m.cid) {
        m.resumedFor = m.cid
        quiet("resume")
      }
    } else if (step === 5) {
      if (!m.approvalId) {
        const a = (st.approvals || [])[0]
        if (a) {
          m.approvalId = a.approval_id
          quiet("pause")
          setReady(true)
        } else if ((st.clock ?? 0) - m.step5Clock >= 30) {
          m.noneNeeded = true
          quiet("pause")
          setStep(6)
        }
        return
      }
      if (!m.resolved) {
        const done = feed.find((e) => e.type === "approval.resolved" && e.data?.approval_id === m.approvalId)
        if (done?.data?.expired) {
          m.approvalId = null // the hospital calmed down before anyone answered; wait for the next one
          setReady(false)
        } else if (done) {
          m.resolved = done.data
          setStep(6)
        }
      }
    }
  }, [step, ready, ev.feed, st]) // eslint-disable-line react-hooks/exhaustive-deps

  return { step, ready, go, exit, mem: mem.current }
}
export type Story = ReturnType<typeof useStory>

function Caption({ story }: { story: Story }) {
  const { st, ev } = useHospital()
  const { step, mem } = story
  if (!st) return null
  const units = st.units || []
  let big = ""
  let sub = ""
  if (step === 1) {
    const beds = units.filter((u) => COUNTED.includes(u.unit))
    big = `A normal evening. ${beds.reduce((s, u) => s + u.occupied, 0)} of ${beds.reduce((s, u) => s + u.beds, 0)} beds are full.`
    sub = "Every card below is a real bed. Dashed cards are empty beds."
  } else if (step === 2) {
    const incoming = (st.patients || []).filter((p) => p.state === "incoming").length
    const waiting = st.metrics?.waiting ?? 0
    const er = units.find((u) => u.unit === "ER")
    big = "Bus crash: 25 injured people are on the way."
    sub = `${incoming ? `${plural(incoming, "ambulance patient")} still on the way. ` : "Everyone has arrived. "}${er ? `Emergency: ${er.occupied} of ${er.beds} beds full. ` : ""}${waiting ? `${plural(waiting, "person", "people")} waiting for a bed.` : "Critical patients get a bed straight away."}`
  } else if (step === 3) {
    const waiting = Math.max(mem.waitingAtStart, mem.maxWaiting, st.metrics?.waiting || 0)
    big = `${waiting ? `${plural(waiting, "person is", "people are")} waiting for a bed. ` : "The hospital is filling up. "}The department AIs are meeting now…`
    sub = "Each department has its own AI. They report, ask each other questions, and a coordinator writes one plan."
  } else if (step === 4) {
    const moves = ev.feed.filter((e) => e.type === "move.applied" && e.cycle_id === mem.cid && e.data?.source !== "fastlane")
    const home = moves.filter((e) => HOME.has(e.data.to_unit)).length
    const placed = moves.filter((e) => !e.data.from_unit && !HOME.has(e.data.to_unit)).length
    const on = moves.length - home - placed
    const parts = [on && `move ${plural(on, "patient")} to other floors`, home && `send ${home} home`, placed && `give ${plural(placed, "waiting patient")} a bed`].filter(Boolean)
    big = `Plan: ${parts.join(", ")}.${on + home ? ` That frees ${plural(on + home, "bed")} for the crash victims.` : ""}`
    sub = "The hospital rules checked every move before it happened. The glowing cards just moved."
  } else if (step === 5) {
    const a = (st.approvals || []).find((x) => x.approval_id === mem.approvalId)
    big = a ? `This one needs a person: ${approvalSentence(a)}` : "Some moves are too big for the AI to make alone…"
    sub = a ? "The AI can suggest it, but only a person can say yes." : "The clock is running until the AIs ask for one."
  } else if (step === 6) {
    if (mem.noneNeeded) {
      big = "No big decision was needed this time: the AIs and the hospital rules found room on their own."
      sub = "When one is needed (calling in nurses, postponing surgeries), it waits here for a person to say yes."
    } else {
      big = mem.resolved?.approved ? `Done: ${mem.resolved.detail}.` : "OK, the hospital carries on without it."
      sub = "AI talks, the hospital rules check, a person decides. The hospital keeps running now."
    }
  }
  return (
    <motion.div key={step + big.slice(0, 20)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <p className="max-w-[62ch] text-[22px] font-semibold leading-snug text-white">{big}</p>
      <p className="mt-1.5 max-w-[72ch] text-[15px] leading-relaxed text-white/75">{sub}</p>
    </motion.div>
  )
}

export function DemoStory({ story }: { story: Story }) {
  const { st } = useHospital()
  const { step, ready, go, exit, mem } = story
  if (!step || !st) return null
  const approval = step === 5 ? (st.approvals || []).find((x) => x.approval_id === mem.approvalId) : undefined
  const waitText: Record<number, string> = { 2: "Waiting for the AIs to meet…", 3: "The AIs are still talking…", 5: "Waiting for a big decision…" }
  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-dark relative overflow-hidden rounded-2xl p-6"
        aria-label="Guided demo"
      >
        <ol className="relative flex flex-wrap gap-x-5 gap-y-2">
          {TITLES.map((t, i) => {
            const n = i + 1
            const state = n < step ? "done" : n === step ? "on" : "todo"
            return (
              <li key={t} className={`flex items-center gap-2 text-[13px] font-semibold ${state === "todo" ? "text-white/45" : "text-white"}`} aria-current={state === "on" ? "step" : undefined}>
                <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${state === "on" ? "bg-white text-ink" : state === "done" ? "bg-jade text-white" : "ring-1 ring-white/35"}`}>
                  {state === "done" ? <Check className="size-3.5" /> : n}
                </span>
                <span className="hidden sm:inline">{t}</span>
              </li>
            )
          })}
        </ol>
        <div className="relative mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <Caption story={story} />
          <div className="flex shrink-0 items-center gap-3">
            {approval && <ApproveButtons a={approval} big onDark />}
            {step < 5 && (
              <button
                onClick={() => go(step + 1)}
                disabled={!ready}
                className="h-11 rounded-2xl bg-white px-6 font-bold text-ink transition-opacity disabled:bg-white/10 disabled:font-medium disabled:text-white/70"
              >
                {ready ? "Next" : waitText[step]}
              </button>
            )}
            {step === 6 && <button onClick={exit} className="h-11 rounded-2xl bg-white px-6 font-bold text-ink">Finish</button>}
            <button onClick={exit} className="grid size-11 place-items-center rounded-2xl text-white/70 hover:bg-white/10 hover:text-white" aria-label="Exit demo">
              <X className="size-5" />
            </button>
          </div>
        </div>
      </motion.section>
      <AnimatePresence>
        {(step === 3 || step === 4) && mem.cid && (
          <motion.aside
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            className="glass-strong fixed bottom-5 right-5 z-40 w-[min(400px,calc(100vw-32px))] rounded-3xl p-4"
            aria-label="The AIs talking"
          >
            <p className="mb-3 flex items-center gap-2 font-heading text-[15px] font-bold text-ink">
              <span className="size-2 rounded-full bg-ai animate-pulse-dot" /> The AIs are talking
            </p>
            <LiveChat cid={mem.cid} limit={6} className="max-h-[360px]" />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
