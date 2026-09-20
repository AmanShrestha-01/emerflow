"use client"

import { useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import { Nav } from "@/components/emer/nav"
import { TextReveal } from "@/components/ui/text-reveal"
import { LiveChat, latestRound } from "@/components/emer/live-chat"
import { WorkflowStage, useRound } from "@/components/emer/workflow-stage"
import { useHospital } from "@/lib/emer/hospital"

export default function WorkflowPage() {
  const { ev, st } = useHospital()
  const latest = latestRound(ev.feed)
  const [pinned, setPinned] = useState<string | null>(null)
  const cid = pinned ?? latest
  const [selected, setSelected] = useState<string>("COORDINATOR")
  const rounds = useMemo(() => {
    const ids: string[] = []
    for (const e of ev.feed) if (e.type === "cycle.start" && e.cycle_id && !ids.includes(e.cycle_id)) ids.push(e.cycle_id)
    return ids.slice(-8)
  }, [ev.feed])
  const r = useRound(cid)
  const running = !!r.start && !r.end
  const n = cid ? cid.replace(/^cy/, "") : null

  return (
    <main className="relative min-h-screen pb-16">
      <div className="pt-3"><Nav /></div>
      <div className="mx-auto mt-6 w-[min(1400px,calc(100%-24px))]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <TextReveal as="h1" per="char" preset="fade-in-blur" speedReveal={1.5} className="font-heading text-4xl font-bold tracking-tight text-ink">AI workflow</TextReveal>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
              Every few minutes the agents hold a round. Each one lights up while it works, the lines carry its report to the
              coordinator, and the hospital rules check the plan. Click any box to see what it said.
            </p>
          </div>
          <div className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-ink">
            <span className={`size-2.5 rounded-full ${running ? "bg-ai animate-pulse-dot" : "bg-jade"}`} />
            {!n ? "Waiting for the first round" : running ? `Round ${n} in progress` : `Round ${n} finished`}
            {r.trigger && <span className="font-medium text-ink-soft">· {r.trigger}</span>}
          </div>
        </div>

        {rounds.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-ink-soft">Rounds:</span>
            {rounds.map((id) => (
              <button
                key={id}
                onClick={() => setPinned(id === latest ? null : id)}
                className={`rounded-xl px-3 py-1 font-bold ${id === cid ? "bg-ink text-white" : "bg-white/70 text-ink"}`}
              >
                {id.replace(/^cy/, "")}{id === latest ? " · latest" : ""}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="glass rounded-[2rem] p-4 sm:p-6">
            {cid ? (
              <WorkflowStage cid={cid} selected={selected} onSelect={setSelected} />
            ) : (
              <p className="grid h-80 place-items-center text-ink-soft">The agents meet when patients are waiting or beds run low. Press Bus crash on the board to start one.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-4 px-2 text-xs font-semibold text-ink-soft">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ai" /> AI agent (Gemini)</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-jade" /> Hospital rules (plain code)</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-human" /> A person</span>
            </div>
          </section>
          <div className="space-y-5">
            <section className="glass rounded-3xl p-5">
              <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-bold text-ink">
                <Sparkles className="size-4 text-ai" /> The conversation
              </h2>
              <LiveChat cid={pinned ?? undefined} limit={40} className="max-h-[420px]" />
            </section>
            {st?.mode && <p className="px-2 text-xs text-ink-soft">Agents run on {st.mode === "live" ? `${st.model || "Gemini"}, live` : st.mode === "replay" ? "recorded Gemini answers" : "the offline rules"}.</p>}
          </div>
        </div>
      </div>
    </main>
  )
}
