"use client"

import { useState } from "react"
import { Nav } from "@/components/emer/nav"
import { MemoryGraph } from "@/components/emer/memory-graph"
import { AGENTS } from "@/lib/emer/agents"
import { useHospital } from "@/lib/emer/hospital"

const WINDOWS = [30, 60, 180]

export default function MemoryPage() {
  const { st, ev } = useHospital()
  const [win, setWin] = useState(60)
  const moves = (ev.feed || []).filter((e) => e.type?.startsWith("move.")).length

  return (
    <main className="relative min-h-screen pb-16">
      <div className="pt-3"><Nav /></div>
      <div className="mx-auto mt-6 w-[min(1400px,calc(100%-24px))] space-y-5 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">What the swarm is holding in mind</h1>
            <p className="mt-1 text-[15px] text-ink-soft">
              Every line is one decision an agent made about one patient. Lines fade as they age and are gone at the
              end of the window, so a surge fills this in and a quiet spell dissolves it.
            </p>
          </div>
          <div role="radiogroup" aria-label="How far back to show" className="flex rounded-2xl bg-white/70 p-1 ring-1 ring-ink/10">
            {WINDOWS.map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={win === m}
                onClick={() => setWin(m)}
                className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold ${win === m ? "bg-ink text-white" : "text-ink-soft"}`}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>

        <MemoryGraph windowMin={win} className="w-full rounded-3xl" />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Agents</p>
            <p className="mt-1 text-[15px] text-ink">
              {AGENTS.length} of them: ten departments and the coordinator. A bigger dot means more decisions in this window.
            </p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Patients</p>
            <p className="mt-1 text-[15px] text-ink">
              {(st?.patients || []).length} in the hospital, each sitting by the unit holding them. Red is critical.
            </p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Decisions</p>
            <p className="mt-1 text-[15px] text-ink">
              {moves} moves in the live feed. A dashed line is a move the hospital rules refused.
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-soft">
          Drawn from the same live feed as the board: nothing here is stored, and nothing is sent anywhere. All patients
          are synthetic.
        </p>
      </div>
    </main>
  )
}
