"use client"

import { useState } from "react"
import { Nav } from "@/components/emer/nav"
import { MemoryGraph } from "@/components/emer/memory-graph"

// How far back into each agent's memory to draw. Five hours is everything they hold (WINDOW_S in
// backend/agents/memory.py); the shorter settings show only what is freshest in mind.
const AGES = [5, 30, 300]

export default function MemoryPage() {
  const [age, setAge] = useState(30)

  return (
    <main className="relative min-h-screen pb-16">
      <div className="pt-3"><Nav /></div>
      <div className="mx-auto mt-6 w-[min(1400px,calc(100%-24px))] space-y-5 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">What the swarm is holding in mind</h1>
            <p className="mt-1 text-[15px] text-ink-soft">
              Every line is one note an agent is holding right now, and every agent reads its own notes back before
              it speaks again. Drag the background to turn it, click a node to fly to it. Notes fade with age and
              are gone after five hours, so a surge fills this in and a quiet spell dissolves it.
            </p>
          </div>
          <div role="radiogroup" aria-label="How far back into memory to show" className="flex rounded-2xl bg-white/70 p-1 ring-1 ring-ink/10">
            {AGES.map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={age === m}
                onClick={() => setAge(m)}
                className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold ${age === m ? "bg-ink text-white" : "text-ink-soft"}`}
              >
                {m === 300 ? "All 5 hours" : `Last ${m} min`}
              </button>
            ))}
          </div>
        </div>

        <MemoryGraph ageMin={age} className="w-full" />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Where it lives</p>
            <p className="mt-1 text-[15px] text-ink">
              In the running server, beside the hospital it describes. Each agent holds its last 60 notes for up to
              five real hours; older ones are dropped.
            </p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Who writes it</p>
            <p className="mt-1 text-[15px] text-ink">
              Code, never the models. A note only exists if the hospital actually saw it happen, so an agent cannot
              remember something it invented.
            </p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">What it changes</p>
            <p className="mt-1 text-[15px] text-ink">
              An agent that offered a bed last round is told whether it happened, and says so. Without this, every
              round started from nothing.
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-soft">
          Read live from the same server the board talks to. Nothing is stored anywhere else, and nothing is sent
          anywhere.
        </p>
      </div>
    </main>
  )
}
