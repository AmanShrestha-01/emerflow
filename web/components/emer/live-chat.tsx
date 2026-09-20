"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
  const list = useMemo(() => {
    const sayable = ev.messages.filter((m: Message) => m.text && (AGENT[m.from] || RULES.has(m.from)))
    const round = sayable.filter((m: Message) => m.cycle_id === cid)
    // A new round starts with nothing said for a few seconds. Hold the last round on screen until then,
    // so the chat never blanks out mid-demo.
    if (round.length || forced) return round.slice(-limit)
    const previous = sayable.length ? sayable[sayable.length - 1].cycle_id : null
    return sayable.filter((m: Message) => m.cycle_id === previous).slice(-limit)
  }, [ev.messages, cid, forced, limit])
  const typing = Object.entries(ev.typing || {}).filter(([a, t]) => AGENT[a] && t?.cycle_id === cid).map(([a]) => a)
  // Between rounds nobody speaks for a few seconds; say so rather than leaving the panel still.
  const ended = !forced && !!cid && ev.feed.some((e: { type: string; cycle_id?: string | null }) => e.type === "cycle.end" && e.cycle_id === cid)
  const waiting = ended && !typing.length
  // Follow the conversation only while the reader is at the bottom. Scroll up to read and it stays put,
  // with a button to come back; otherwise every new message yanks the box away mid-sentence.
  const [following, setFollowing] = useState(true)
  const onScroll = () => {
    const el = box.current
    if (!el) return
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }
  useEffect(() => {
    // Instant, not smooth: a smooth scroll that is still animating when the next message lands leaves a
    // message half-hidden under the top of the box.
    if (following) box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [list.length, typing.length, following])

  return (
    <div className="relative">
    <div ref={box} onScroll={onScroll} className={`space-y-3 overflow-y-auto pr-1 ${className}`} aria-live="polite">
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
      {waiting && (
        <p className="flex items-center gap-2 text-[13px] text-ink-soft">
          <span className="size-2 animate-pulse-dot rounded-full bg-ai" />
          Round finished. The agents meet again in a moment.
        </p>
      )}
      {typing.length > 0 && (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <span className="flex -space-x-1.5">{typing.slice(0, 4).map((t) => <AgentAvatar key={t} id={t} size={22} typing />)}</span>
          {typing.length === 1 ? `${AGENT[typing[0]].name} is typing…` : `${typing.length} agents are typing…`}
        </div>
      )}
    </div>
    {!following && (
      <button
        onClick={() => {
          setFollowing(true)
          box.current?.scrollTo({ top: box.current.scrollHeight })
        }}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-xs font-bold text-white shadow-lg"
      >
        Latest ↓
      </button>
    )}
    </div>
  )
}
