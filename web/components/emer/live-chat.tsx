"use client"

import { useEffect, useMemo, useRef } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ShieldCheck } from "lucide-react"
import { AGENT, plainText } from "@/lib/emer/agents"
import { useHospital, type Message } from "@/lib/emer/hospital"
import { AgentAvatar } from "./avatar"

const RULES = new Set(["VALIDATOR", "FASTLANE", "ESCALATION", "DEEPCHART"])
const KIND: Record<string, { label: string; cls: string }> = {
  ask: { label: "asks", cls: "bg-ai-soft text-ai" },
  reply: { label: "answers", cls: "bg-mist text-jade-deep" },
  plan: { label: "plan", cls: "bg-ink text-white" },
  object: { label: "objects", cls: "bg-critical-soft text-critical" },
  ack: { label: "agrees", cls: "bg-mist text-jade-deep" },
}

export function latestRound(feed: { type: string; cycle_id?: string | null }[]) {
  for (let i = feed.length - 1; i >= 0; i--) if (feed[i].type === "cycle.start" && feed[i].cycle_id) return feed[i].cycle_id as string
  return null
}

/** One round of the AI meeting as a group chat. `cid` defaults to the latest round. */
export function LiveChat({ cid: forced, limit = 30, className = "" }: { cid?: string | null; limit?: number; className?: string }) {
  const { ev, names } = useHospital()
  const cid = forced ?? latestRound(ev.feed)
  const box = useRef<HTMLDivElement>(null)
  const list = useMemo(
    () => ev.messages.filter((m: Message) => m.cycle_id === cid && m.text && (AGENT[m.from] || RULES.has(m.from))).slice(-limit),
    [ev.messages, cid, limit],
  )
  const typing = Object.entries(ev.typing || {}).filter(([a, t]) => AGENT[a] && t?.cycle_id === cid).map(([a]) => a)
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" })
  }, [list.length, typing.length])

  return (
    <div ref={box} className={`space-y-3 overflow-y-auto pr-1 ${className}`} aria-live="polite">
      {!cid && <p className="text-sm text-ink-soft">The agents meet when patients are waiting or beds run low.</p>}
      <AnimatePresence initial={false}>
        {list.map((m) => {
          if (RULES.has(m.from)) {
            return (
              <motion.p key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2 rounded-2xl bg-mist/80 px-3 py-2 text-[13px] leading-snug text-jade-deep">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span><b>Hospital rules:</b> {plainText(m.text, names)}</span>
              </motion.p>
            )
          }
          const a = AGENT[m.from]
          const k = KIND[m.kind || ""]
          const to = (m.to || []).filter((t) => AGENT[t]).map((t) => AGENT[t].name)
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex gap-2.5">
              <AgentAvatar id={m.from} size={34} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-1.5 text-[13px]">
                  <b className="text-ink">{a.name}</b>
                  <span className="font-semibold" style={{ color: a.to }}>{m.persona || a.persona}</span>
                  {to.length > 0 && <span className="text-ink-soft">→ {to.join(", ")}</span>}
                  {k && <span className={`rounded-full px-2 py-px text-[11px] font-bold ${k.cls}`}>{k.label}</span>}
                </p>
                <p className={`mt-1 rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[14px] leading-relaxed text-ink ${m.from === "COORDINATOR" ? "bg-ink text-white" : "bg-[#f4f0e6]"}`}>
                  {plainText(m.text, names)}
                </p>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
      {typing.length > 0 && (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <span className="flex -space-x-1.5">{typing.slice(0, 4).map((t) => <AgentAvatar key={t} id={t} size={22} typing />)}</span>
          {typing.length === 1 ? `${AGENT[typing[0]].name} is typing…` : `${typing.length} agents are typing…`}
        </div>
      )}
    </div>
  )
}
