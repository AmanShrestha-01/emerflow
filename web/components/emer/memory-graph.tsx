"use client"

// The memory page's centrepiece: a 3D web you can pull around, beside the notes the agents are actually
// holding. The WebGL half lives in memory-canvas.tsx and is loaded only in the browser; this file measures
// the box, feeds it the live state, and keeps the notes panel in step with whatever node you are on.

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import { AGENT, AGENTS, OWNER, UNIT_NAME } from "@/lib/emer/agents"
import { api, useHospital } from "@/lib/emer/hospital"
import type { MemoryFeed } from "./memory-canvas"

const MemoryCanvas = dynamic(() => import("./memory-canvas").then((m) => m.MemoryCanvas), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-3xl bg-[#101d1c]" />,
})

// What each kind of note is, said out loud. The note itself is written to be read by the agent holding
// it ("you offered..."), which is right for a prompt and reads oddly on a screen, so the card drops the
// "you" and the label above says who and what.
const KIND_WORD: Record<string, string> = {
  said: "Told the command board", offered: "Offered to move someone",
  ordered: "The coordinator asked for", happened: "What actually happened",
}

/** The note as a sentence about the agent rather than a sentence to it. */
function asSentence(text: string): string {
  const t = text.replace(/^you /, "")
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function MemoryGraph({ ageMin = 30, className = "" }: { ageMin?: number; className?: string }) {
  const { st } = useHospital()
  const [notes, setNotes] = useState<MemoryFeed | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 620 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    const pull = () => (api as unknown as { memory: () => Promise<MemoryFeed> }).memory()
      .then((m) => alive && setNotes(m))
      .catch(() => {})
    pull()
    const t = setInterval(pull, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const pick = useCallback((id: string | null) => setPicked(id), [])

  const agent = picked && AGENT[picked] ? AGENT[picked] : null
  // a place: the panel shows the department that speaks for it, not notes — places do not remember
  const place = picked?.startsWith("unit:") ? picked.slice(5) : null
  const own = notes?.agents.find((a) => a.unit === picked)?.notes.filter((n) => n.here) || []
  // Both the department freeing the bed and the one receiving keep their own copy of an outcome, which
  // is right for them and reads as duplication here. One line per fact, naming everyone holding it.
  const about = picked && !agent && !place ? groupNotes(notes, picked) : []
  const who = picked ? (st?.patients || []).find((p) => p.pid === picked) : undefined
  const speaker = place ? AGENT[OWNER[place] || "ER"] : null
  const inside = place ? (st?.patients || []).filter((p) => p.unit === place) : []

  return (
    <div className={`grid gap-4 lg:grid-cols-[1fr_300px] ${className}`}>
      <div ref={box} className="relative h-[620px] overflow-hidden rounded-3xl bg-[#101d1c] ring-1 ring-ink/10">
        {size.w > 0 && (
          <MemoryCanvas
            st={st}
            maxAgeS={ageMin * 60}
            notes={notes}
            width={size.w}
            height={size.h}
            onPick={pick}
          />
        )}
      </div>

      <aside className="glass flex max-h-[620px] flex-col overflow-hidden rounded-3xl p-4">
        {!picked && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">What they are holding</p>
            <p className="mt-1 text-[15px] text-ink">
              Hover any node to see it. Every agent keeps its own notes for up to{" "}
              {Math.round((notes?.window_s || 18000) / 3600)} hours, then they fade out of mind.
            </p>
            <ul className="mt-3 space-y-1.5 overflow-y-auto pr-1">
              {AGENTS.map((a) => {
                const n = notes?.agents.find((x) => x.unit === a.id)?.notes.filter((x) => x.here).length || 0
                return (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.to }} />
                    <span className="flex-1 truncate text-ink">{a.name}</span>
                    <span className="tabular-nums text-ink-soft">{a.id === "COORDINATOR" ? "—" : n}</span>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {agent && (
          <>
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: agent.to }} />
              <p className="font-heading text-lg font-bold text-ink">{agent.name}</p>
            </div>
            <p className="text-xs text-ink-soft">{agent.role}</p>
            {agent.id === "COORDINATOR" ? (
              <p className="mt-3 text-[15px] text-ink">
                The coordinator keeps no notes of its own. It reads all ten department reports fresh every
                round and writes one plan from them.
              </p>
            ) : (
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-soft">
                {own.length ? `${own.length} note${own.length === 1 ? "" : "s"} in mind` : "Nothing in mind yet"}
              </p>
            )}
            <ul className="mt-2 space-y-2 overflow-y-auto pr-1">
              {own.map((n, i) => (
                <li key={i} className="rounded-xl bg-white/60 p-2.5 text-[13px] leading-snug text-ink">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{KIND_WORD[n.kind] || n.kind}</span>
                  <p className="mt-0.5">{asSentence(n.text)}</p>
                  <p className="mt-1 text-[11px] text-ink-soft">{fade(n.age_s, notes?.window_s || 18000)}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        {place && speaker && (
          <>
            <p className="font-heading text-lg font-bold text-ink">{UNIT_NAME[place] || place}</p>
            <p className="text-xs text-ink-soft">
              A place in the hospital. {speaker.name} speaks for it.
            </p>
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-soft">
              {inside.length ? `${inside.length} here now` : "Empty right now"}
            </p>
            <ul className="mt-2 space-y-1.5 overflow-y-auto pr-1">
              {inside.map((p) => (
                <li key={p.pid} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.severity <= 2 ? "#e2503a" : p.severity === 3 ? "#d99a2b" : "#3fc3a4" }} />
                  <span className="flex-1 truncate text-ink">{p.name || p.pid}</span>
                  <span className="truncate text-xs text-ink-soft">{p.complaint}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {picked && !agent && !place && (
          <>
            <p className="font-heading text-lg font-bold text-ink">{who?.name || picked}</p>
            <p className="text-xs text-ink-soft">
              {who ? `${who.complaint}${who.age ? `, ${who.age}` : ""} · ${whereIs(who)}` : ""}
            </p>
            {about.length ? (
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-soft">
{about.length} thing{about.length === 1 ? "" : "s"} the swarm remembers about them
              </p>
            ) : (
              <p className="mt-3 text-[15px] text-ink">
                Nobody is holding a note about them. No agent has offered or moved them in this window, so there is
                nothing to remember — the line you can see is where they are lying, not a memory.
              </p>
            )}
            <ul className="mt-2 space-y-2 overflow-y-auto pr-1">
              {about.map((n, i) => (
                <li key={i} className="rounded-xl bg-white/60 p-2.5 text-[13px] leading-snug text-ink">
                  <span className="flex flex-wrap gap-x-2 text-[10px] font-bold uppercase tracking-wide">
                    {n.units.map((u) => (
                      <span key={u} style={{ color: AGENT[u]?.to }}>{AGENT[u]?.name || u}</span>
                    ))}
                  </span>
                  <p className="mt-0.5">{asSentence(n.text)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}

type Held = { text: string; kind: string; units: string[] }

function groupNotes(notes: MemoryFeed | null, pid: string): Held[] {
  const by = new Map<string, Held>()
  for (const a of notes?.agents || []) {
    for (const n of a.notes) {
      if (n.pid !== pid) continue
      const had = by.get(n.text)
      if (had) { if (!had.units.includes(a.unit)) had.units.push(a.unit) }
      else by.set(n.text, { text: n.text, kind: n.kind, units: [a.unit] })
    }
  }
  return [...by.values()]
}

/** Where a patient is, in plain words. */
function whereIs(p: { state: string; unit?: string | null }): string {
  if (p.state === "waiting") return "still waiting"
  if (p.state === "held") return "held for a records check"
  return p.unit ? `in ${(UNIT_NAME[p.unit] || p.unit).toLowerCase()}` : "in the hospital"
}

/** How much life a note has left, in plain words. */
function fade(age: number, window: number): string {
  const left = Math.max(0, window - age)
  if (left < 60) return "being forgotten now"
  const ago = age < 90 ? "just now" : `${Math.round(age / 60)} min ago`
  const h = Math.floor(left / 3600)
  const m = Math.round((left % 3600) / 60)
  return `${ago} · forgotten in ${h ? `${h}h ${m}m` : `${m} min`}`
}
