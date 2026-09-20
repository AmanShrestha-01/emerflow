"use client"

import Link from "next/link"
import { motion } from "motion/react"
import {
  Ambulance, ArrowRight, BedDouble, BrainCircuit, CheckCircle2, Clock3, Hand, MessagesSquare, ShieldCheck, Sparkles, Zap,
} from "lucide-react"
import { Nav } from "@/components/emer/nav"
import { AgentSphere } from "@/components/emer/agent-sphere"
import { RevealHeading } from "@/components/emer/reveal-heading"
import { TextReveal } from "@/components/ui/text-reveal"
import { AGENTS, agentOrb } from "@/lib/emer/agents"
import { useHospital } from "@/lib/emer/hospital"

const MAIN = ["RESUS", "ER", "ICU", "STEPDOWN", "WARD"]

const STEPS = [
  { icon: Ambulance, who: "rules", title: "Patients arrive", body: "Walk-ins, ambulances, or a whole bus crash at once." },
  { icon: Zap, who: "rules", title: "Rules place the obvious", body: "A critical patient gets the critical care room instantly. No AI, no waiting." },
  { icon: MessagesSquare, who: "ai", title: "Ten department AIs talk", body: "Each reports its beds, asks the others questions, and offers who could move on." },
  { icon: BrainCircuit, who: "ai", title: "One plan for the hospital", body: "The coordinator chains the moves: ward → home, close-watch → ward, ICU → close-watch." },
  { icon: Hand, who: "human", title: "Rules check, a person decides", body: "Every move is checked. Calling in nurses or postponing surgery waits for a yes." },
]
const WHO = {
  ai: { label: "AI", cls: "bg-ai-soft text-ai" },
  rules: { label: "Hospital rules", cls: "bg-mist text-jade-deep" },
  human: { label: "A person", cls: "bg-human-soft text-human" },
} as const

function LiveNumbers() {
  const { st } = useHospital()
  const units = (st?.units || []).filter((u) => MAIN.includes(u.unit))
  const total = units.reduce((s, u) => s + u.beds, 0)
  const full = units.reduce((s, u) => s + u.occupied, 0)
  const items = [
    { icon: BedDouble, k: "Beds in use", v: st ? `${full} / ${total}` : "–" },
    { icon: Clock3, k: "Waiting for a bed", v: st ? String(st.metrics?.waiting ?? 0) : "–" },
    { icon: CheckCircle2, k: "Patients placed tonight", v: st ? String(st.metrics?.placed ?? 0) : "–" },
    { icon: Hand, k: "Decisions waiting for a person", v: st ? String((st.approvals || []).length) : "–" },
  ]
  return (
    <div className="glass grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4">
      {items.map(({ icon: I, k, v }) => (
        <div key={k} className="flex items-center gap-4 px-6 py-5">
          <I className="size-5 text-ink-soft" strokeWidth={1.75} />
          <div>
            <p className="font-heading tabular text-2xl font-bold text-ink">{v}</p>
            <p className="text-sm text-ink-soft">{k}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Home() {
  const { st } = useHospital()
  const units = (st?.units || []).filter((u) => MAIN.includes(u.unit))
  const full = units.reduce((s, u) => s + u.occupied, 0)
  const total = units.reduce((s, u) => s + u.beds, 0)
  return (
    <main className="relative">
      {/* Hero */}
      <section className="relative isolate min-h-[100svh] overflow-hidden pb-16">
        <div className="pt-3">
          <Nav />
        </div>
        <div className="mx-auto grid w-[min(1240px,calc(100%-32px))] items-center gap-6 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: "easeOut" }}>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-white">
              <span className="size-2 rounded-full bg-ai animate-pulse-dot" />
              11 AI agents on shift{st ? ` · ${full} of ${total} beds in use` : ""}
            </p>
            <TextReveal
              as="h1"
              per="word"
              preset="fade-in-blur"
              speedReveal={1.2}
              className="mt-6 max-w-[14ch] text-[clamp(2.5rem,5.5vw,4.5rem)] font-bold leading-[1.05] tracking-tight text-ink"
            >
              When the ER fills up, eleven AIs find the beds.
            </TextReveal>
            <TextReveal as="p" per="word" preset="fade" delay={0.45} speedReveal={3} className="mt-6 max-w-[52ch] text-lg leading-relaxed text-ink-soft">
              Every department gets its own AI. They talk to each other, agree one plan to free beds, and the hospital rules check every move. Big calls wait for a person.
            </TextReveal>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/board" className="inline-flex items-center gap-2 rounded-xl bg-ink px-6 py-3.5 text-base font-semibold text-white">
                Open the command board <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-ink-soft">
              <li className="flex items-center gap-2"><Sparkles className="size-4 text-ai" /> Gemini 2.5 Flash on Vertex AI</li>
              <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-jade" /> Every move checked by rules</li>
              <li className="flex items-center gap-2"><Hand className="size-4 text-human" /> A person approves big actions</li>
            </ul>
          </motion.div>
          <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
          >
            <AgentSphere />
            <p className="mt-1 text-center text-sm font-medium text-ink-soft">Drag to spin the swarm. Click an agent to meet it.</p>
          </motion.div>
        </div>
      </section>

      {/* Live numbers */}
      <section className="relative z-10 mx-auto -mt-16 w-[min(1240px,calc(100%-32px))]">
        <LiveNumbers />
      </section>

      {/* How a round works */}
      <section id="how" className="mx-auto w-[min(1240px,calc(100%-32px))] scroll-mt-20 py-24">
        <div className="max-w-2xl">
          <RevealHeading className="font-heading text-4xl font-bold tracking-tight text-ink">What happens every few minutes</RevealHeading>
          <p className="mt-3 text-lg text-ink-soft">
            A real bed manager spends hours on the phone between departments. EmerFlow holds that meeting in about fifteen seconds.
          </p>
        </div>
        <ol className="relative mt-12 grid gap-4 md:grid-cols-5">
          <div aria-hidden className="absolute left-0 right-0 top-7 hidden h-px bg-[#d9d2c1] md:block" />
          {STEPS.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.08, duration: 0.45 }}
              className="relative"
            >
              <span className="relative z-10 grid size-14 place-items-center rounded-2xl card-dark">
                <s.icon className="size-6" />
                <span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-white text-xs font-bold text-ink ring-1 ring-[#e6e0d2]">{i + 1}</span>
              </span>
              <p className={`mt-4 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${WHO[s.who as keyof typeof WHO].cls}`}>
                {WHO[s.who as keyof typeof WHO].label}
              </p>
              <h3 className="mt-2 font-heading text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
            </motion.li>
          ))}
        </ol>
      </section>

      {/* Meet the agents */}
      <section id="agents" className="relative scroll-mt-20 overflow-hidden bg-vanilla-deep py-24">
        <div className="mx-auto w-[min(1240px,calc(100%-32px))]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <RevealHeading className="font-heading text-4xl font-bold tracking-tight text-ink">Meet the swarm</RevealHeading>
              <p className="mt-3 text-lg text-ink-soft">
                Same model, nine different jobs. Each agent only sees its own department, speaks in its own voice, and pushes
                for what its patients need.
              </p>
            </div>
            <Link href="/workflow" className="glass inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold text-ink">
              Watch them work <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((a) => (
              <article key={a.id} className="card-dark flex h-full flex-col justify-between gap-8 rounded-2xl p-7">
                <p className="text-xl leading-relaxed text-white">&ldquo;{a.pushesFor}.&rdquo;</p>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold text-white">{a.persona}</p>
                    <p className="mt-1 text-lg text-white/85">{a.name} AI</p>
                    <p className="mt-1 text-sm text-white/55">{a.role}</p>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={agentOrb(a)} alt="" className="size-24 shrink-0 rounded-2xl" />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Why it helps */}
      <section className="mx-auto w-[min(1240px,calc(100%-32px))] py-24">
        <RevealHeading className="max-w-2xl font-heading text-4xl font-bold tracking-tight text-ink">AI talks. Rules check. A person decides.</RevealHeading>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            { icon: Zap, tone: "text-[#a99bff]", t: "Seconds, not hours", b: "The phone calls between departments happen as one AI meeting, every few minutes, all night." },
            { icon: ShieldCheck, tone: "text-[#3fc3a4]", t: "Safe by design", b: "The AI picks departments, never bed numbers. Plain code checks every move and can't be talked round." },
            { icon: MessagesSquare, tone: "text-[#ffc861]", t: "It explains itself", b: "Every move has a reason in plain words, and every conversation is logged for the morning review." },
          ].map(({ icon: I, tone, t, b }) => (
            <div key={t} className="card-dark rounded-2xl p-7">
              <I className={`size-6 ${tone}`} strokeWidth={1.75} />
              <h3 className="mt-6 text-2xl font-bold text-white">{t}</h3>
              <p className="mt-2 text-lg leading-relaxed text-white/75">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="mx-auto mb-16 w-[min(1240px,calc(100%-32px))]">
        <div className="card-dark relative overflow-hidden rounded-2xl px-8 py-14 sm:px-14">
          <h2 className="relative max-w-[20ch] font-heading text-4xl font-bold tracking-tight">See a bus crash handled in three minutes.</h2>
          <p className="relative mt-3 max-w-[56ch] text-lg text-white/75">
            Press Bus crash on the board and watch the agents find beds. At the end, you make the call.
          </p>
          <Link href="/board" className="relative mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-semibold text-ink">
            Open the command board <ArrowRight className="size-4" />
          </Link>
        </div>
        <p className="mt-8 text-center text-sm text-ink-soft">EmerFlow · HopHacks 2026 · All patient data is synthetic.</p>
      </section>
    </main>
  )
}
