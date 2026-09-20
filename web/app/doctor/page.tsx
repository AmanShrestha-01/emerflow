"use client"

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowRightLeft, Check, FilePlus2, CircleSlash, ClipboardCheck, ExternalLink, FileWarning, Fingerprint, Hospital, Inbox, Link2,
  Loader2, LogOut, Search, ShieldAlert, Users, Zap,
} from "lucide-react"
import { LiveBadge, Nav } from "@/components/emer/nav"
import { TextReveal } from "@/components/ui/text-reveal"
import { SEVERITY } from "@/lib/emer/beds"
import { UNIT_NAME, plainText } from "@/lib/emer/agents"
import { HOME, checkSession, loadSession, login, saveSession, type Session } from "@/lib/emer/session"
import {
  DIFF_LABEL, ENTRY_STATUS, FACT_LABEL, FACT_TECH, FACTS, NOTICE, PortalError, REASONS, plainValue, portal, shortValue, sourceLabel,
  type Candidate, type Chart, type Fact, type LogEntry, type OrderResult, type Resolved, type Row, type Transfer, type Version,
} from "@/lib/emer/portal"

const SINAI = "Fells Point Heart Institute"
const STATE_WORD: Record<string, string> = { incoming: "On the way", waiting: "Waiting for a bed", held: "Waiting: records being checked", placed: "In a bed" }
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)
const where = (p: Row) => (p.unit ? UNIT_NAME[p.unit] || p.unit : STATE_WORD[p.state] || p.state)

// Deep link from the board: /doctor?pid=MC-03&hold=H12 (optionally &pin=demo for the demo).
type Deep = { pid: string | null; hold: string | null; pin: string | null }
const LOADING = <div className="grid min-h-[60vh] place-items-center text-ink-soft">Checking your login…</div>

export default function DoctorPage() {
  return (
    <main className="theme-doctor relative min-h-screen pb-16">
      <div className="pt-3"><Nav /></div>
      {/* useSearchParams follows client-side navigation (e.g. back from the login with ?pid=); Suspense lets the page export statically */}
      <Suspense fallback={LOADING}>
        <Portal />
      </Suspense>
    </main>
  )
}

/* ---------- login check: doctors only ---------- */
function Portal() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const q = useSearchParams()
  const deep = useMemo<Deep>(() => ({ pid: q.get("pid"), hold: q.get("hold"), pin: q.get("pin") }), [q])
  useEffect(() => {
    const d = deep
    const away = () => {
      const next = window.location.pathname + window.location.search.replace(/[?&]pin=[^&]*/, "")
      router.replace(`/login?as=doctor&next=${encodeURIComponent(next)}`)
    }
    const use = (s: Session) => (saveSession(s), setSession(s))
    if (d.pin) {
      // demo deep link: always a fresh login, never a token from before a restart
      login(HOME, "doctor", d.pin).then(use).catch(away)
      return
    }
    const stored = loadSession()
    checkSession(stored).then((ok) => (ok && stored?.role === "doctor" ? use(stored) : away()))
  }, [router, deep])
  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof PortalError && e.status === 401) {
        saveSession(null)
        router.replace("/login?as=doctor&next=/doctor")
      }
    },
    [router],
  )
  const logout = () => {
    saveSession(null)
    router.replace("/login")
  }

  if (!session) return LOADING
  return (
    <div className="mx-auto mt-6 w-[min(1400px,calc(100%-24px))] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-ink-soft">{session.name || "Doctor"} · {session.hospital}</p>
            <LiveBadge />
          </div>
          <TextReveal as="h1" per="char" preset="fade-in-blur" speedReveal={1.5} className="mt-1 font-heading text-4xl font-bold tracking-tight text-ink">DeepChart</TextReveal>
          <p className="mt-1 max-w-2xl text-[15px] font-medium text-ink-soft">
            Every hospital&apos;s record for your patient, side by side. Where they disagree, we show both. A person decides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session.hospital === HOME && (
            <Link href="/board" className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink ring-1 ring-[#d0ddf0]">
              Command board
            </Link>
          )}
          <button onClick={logout} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white">
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </div>

      <p className="order-last pt-4 text-center text-xs text-ink-soft">
        Demo with invented patients and doctors. Fells Point Heart Institute and Hampden Family Health are fictional; EmerFlow is not affiliated with or endorsed by any hospital named here.
      </p>
      {session.hospital === HOME && <HomeDesk session={session} deep={deep} onError={onError} />}
      {session.hospital === SINAI && <SenderDesk session={session} onError={onError} />}
      {session.hospital !== HOME && session.hospital !== SINAI && (
        <Panel title={session.hospital}>
          <p className="text-[15px] text-ink-soft">
            {session.hospital} only holds records in this demo. Log in at {HOME} to check patients, or at {SINAI} to send a transfer.
          </p>
        </Panel>
      )}
    </div>
  )
}

/* ---------- shared bits (same look as the command board) ---------- */
function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-2xl p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function usePoll(fn: (alive: () => boolean) => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    let on = true
    const run = () => fn(() => on)
    run()
    const t = setInterval(run, ms)
    return () => {
      on = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function SevDot({ n }: { n: number }) {
  const s = SEVERITY[n]
  return <span title={s?.label} className={`size-2.5 shrink-0 rounded-full ${s?.dot || "bg-ink-soft"}`} />
}
function Code({ id }: { id: string }) {
  return <span title="Record number" className="tabular rounded-md bg-sapphire-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-sapphire-deep">{id}</span>
}
function FactName({ f }: { f: string }) {
  return <strong className="text-ink" title={FACT_TECH[f] ? `Clinical term: ${FACT_TECH[f]}` : undefined}>{FACT_LABEL[f] || f}</strong>
}
const btn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-opacity disabled:opacity-40"
const btnDark = `${btn} bg-ink text-white`
const btnBlue = `${btn} bg-sapphire text-white`
const btnLight = `${btn} bg-white text-ink ring-1 ring-[#d0ddf0] hover:bg-sapphire-soft/50`
const field = "h-11 w-full rounded-xl bg-white px-4 text-[15px] text-ink ring-1 ring-[#d0ddf0] focus:outline-none focus:ring-2 focus:ring-sapphire"

/* ---------- Johns Hopkins Hospital: the doctor's desk ---------- */
function HomeDesk({ session, deep, onError }: { session: Session; deep: Deep; onError: (e: unknown) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [inbox, setInbox] = useState<Transfer[]>([])
  const [filter, setFilter] = useState("")
  const [onlyFlags, setOnlyFlags] = useState(true)
  const [pid, setPid] = useState<string | null>(deep.pid)

  usePoll(
    (alive) => {
      portal.patients(session).then((r) => alive() && setRows(r)).catch(onError)
      portal.inbox(session).then((r) => alive() && setInbox(r)).catch(onError)
    },
    3000,
    [session.token],
  )

  const list = rows || []
  const q = filter.trim().toLowerCase()
  const shown = list.filter(
    (p) =>
      (!onlyFlags || p.held || (p.conflicts ?? 0) > 0 || p.pid === pid || inbox.some((t) => t.pid === p.pid)) &&
      (!q || p.name.toLowerCase().includes(q) || p.pid.toLowerCase().includes(q)),
  )
  const held = list.filter((p) => p.held).length
  const conflicting = list.filter((p) => (p.conflicts ?? 0) > 0).length

  return (
    <>
      <Kpis
        tiles={[
          { k: "Moves waiting on records", v: held, cap: held ? "The board is holding these for you" : "Nothing is held", icon: ShieldAlert, dot: "bg-[#ffc861]" },
          { k: "Patients with conflicts", v: conflicting, cap: conflicting ? "Their hospitals' records disagree" : "Every record agrees", icon: FileWarning, dot: "bg-[#ff7a6b]" },
          { k: "Transfers in", v: inbox.length, cap: inbox.length ? `Latest from ${inbox[inbox.length - 1].from_hospital}` : "None sent yet", icon: Inbox, dot: "bg-[#7fb2ff]" },
          { k: "Patients here", v: list.length, cap: "At Johns Hopkins Hospital now", icon: Users, dot: "bg-[#3fc3a4]" },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-5">
          {inbox.length > 0 && (
            <Panel title="Incoming transfers">
              <ul className="space-y-2">
                {inbox.map((t) => (
                  <li key={t.transfer_id}>
                    <PickRow on={pid === t.pid} onClick={() => setPid(t.pid)}>
                      <ArrowRightLeft className="size-4 shrink-0 text-sapphire" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink">{t.name}</span>
                        <span className="block truncate text-xs text-ink-soft">from {t.from_hospital} · {t.at}</span>
                      </span>
                      {t.conflicts > 0 ? <Chip tone="amber">{t.conflicts} conflict</Chip> : <Chip tone="ok">clear</Chip>}
                    </PickRow>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Patients">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
              <input className={`${field} pl-11`} placeholder="Search by name or record number" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="mt-3 flex gap-1.5 rounded-xl bg-sapphire-soft/60 p-1 text-sm font-semibold">
              {[
                [true, "Held or conflicting"],
                [false, "Everyone"],
              ].map(([v, label]) => (
                <button
                  key={String(v)}
                  onClick={() => setOnlyFlags(v as boolean)}
                  className={`flex-1 rounded-lg py-1.5 transition ${onlyFlags === v ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
                >
                  {label as string}
                </button>
              ))}
            </div>
            <ul className="mt-3 max-h-[640px] space-y-2 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {shown.map((p) => (
                  <motion.li key={p.pid} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <PickRow on={pid === p.pid} onClick={() => setPid(p.pid)}>
                      <SevDot n={p.severity} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink">{p.name}</span>
                        <span className="block truncate text-xs text-ink-soft">{p.complaint} · {where(p)}</span>
                      </span>
                      {p.held ? <Chip tone="amber">Held</Chip> : (p.conflicts ?? 0) > 0 ? <Chip tone="soft">{p.conflicts} conflict</Chip> : null}
                    </PickRow>
                  </motion.li>
                ))}
              </AnimatePresence>
              {rows && shown.length === 0 && (
                <li className="rounded-2xl border border-dashed border-[#c3d3ea] p-5 text-center text-sm text-ink-soft">
                  No held or conflicting patients. Start a bus crash on the command board, or show everyone.
                </li>
              )}
              {!rows && <li className="p-5 text-center text-sm text-ink-soft">Loading patients…</li>}
            </ul>
          </Panel>
        </div>
        <div>
          {pid ? (
            <Workspace key={pid} pid={pid} session={session} onError={onError} initialReason={pid === deep.pid ? "er" : ""} />
          ) : (
            <div className="glass grid min-h-80 place-items-center rounded-2xl p-8 text-center">
              <div>
                <Fingerprint className="mx-auto size-8 text-sapphire" strokeWidth={1.5} />
                <p className="mt-3 font-heading text-lg font-bold text-ink">Pick a patient</p>
                <p className="mt-1 text-[15px] text-ink-soft">Patients the board is holding, and patients whose records disagree, are listed first.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Kpis({ tiles }: { tiles: { k: string; v: number; cap: string; icon: typeof Users; dot: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map(({ k, v, cap, icon: I, dot }) => (
        <div key={k} className="card-dark rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[15px] text-white/80"><span className={`size-2 rounded-full ${dot}`} />{k}</p>
            <I className="size-5 text-white/40" strokeWidth={1.75} />
          </div>
          <motion.p key={v} initial={{ y: 6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} className="tabular mt-4 text-5xl font-bold leading-none">{v}</motion.p>
          <p className="mt-3 text-[15px] text-white/70">{cap}</p>
        </div>
      ))}
    </div>
  )
}

function PickRow({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left ring-1 transition hover:-translate-y-0.5 ${on ? "bg-white ring-2 ring-sapphire" : "bg-white/70 ring-[#d0ddf0]"}`}
    >
      {children}
    </button>
  )
}

function Chip({ tone, children }: { tone: "amber" | "soft" | "ok" | "blue"; children: ReactNode }) {
  const c = {
    amber: "bg-human text-white",
    soft: "bg-human-soft text-[#8a5a0f]",
    ok: "bg-mist text-jade-deep",
    blue: "bg-sapphire-soft text-sapphire-deep",
  }[tone]
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${c}`}>{children}</span>
}

/* ---------- one patient ---------- */
function Workspace({ pid, session, onError, initialReason }: { pid: string; session: Session; onError: (e: unknown) => void; initialReason: string }) {
  const [reason, setReason] = useState(initialReason)
  const [chart, setChart] = useState<Chart | null>(null)
  const [matches, setMatches] = useState<Candidate[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [link, setLink] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = (e: unknown) => {
    setError((e as Error).message)
    onError(e)
  }
  const load = useCallback(
    async (r: string) => {
      if (!r) return
      try {
        setChart(await portal.chart(session, pid, r))
        setLog(await portal.accessLog(session, pid))
        setError(null)
      } catch (e) {
        fail(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, session],
  )
  // opened from the board's deep link: the reason is preset, so the chart opens straight away
  useEffect(() => {
    if (!initialReason) return
    let alive = true
    Promise.all([portal.chart(session, pid, initialReason), portal.accessLog(session, pid)])
      .then(([c, l]) => alive && (setChart(c), setLog(l)))
      .catch((e) => alive && fail(e))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = (r: string) => {
    setReason(r)
    load(r)
  }
  const lookup = async () => {
    setLooking(true)
    try {
      setMatches((await portal.lookup(session, pid, reason)).candidates)
      setLog(await portal.accessLog(session, pid))
    } catch (e) {
      fail(e)
    }
    setLooking(false)
  }
  const decide = async (ref: string, same: boolean) => {
    try {
      await portal.confirm(session, pid, ref, same, reason)
      await lookup()
      await load(reason)
    } catch (e) {
      fail(e)
    }
  }
  const resolve = async (outcome: "proceed" | "cancel") => {
    if (!chart?.hold) return
    try {
      setResolved(await portal.resolve(session, pid, chart.hold.hold_id, outcome, reason))
      await load(reason)
    } catch (e) {
      fail(e)
    }
  }
  const makeLink = async () => {
    try {
      setLink((await portal.patientLink(session, pid)).path)
    } catch (e) {
      fail(e)
    }
  }

  const p = chart?.patient
  return (
    <div className="space-y-5">
      <section className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Code id={pid} />
              {p && <span className={`text-xs font-bold ${SEVERITY[p.severity]?.text || ""}`}>{SEVERITY[p.severity]?.label}</span>}
            </div>
            <h2 className="mt-1.5 font-heading text-2xl font-bold tracking-tight text-ink">
              {p ? `${p.name}, ${p.age}` : reason ? "Loading…" : "Patient record"}
            </h2>
            {p && <p className="text-[15px] text-ink-soft">{p.complaint} · {where(p)}</p>}
            {chart && (
              <p className="mt-1 text-xs text-ink-soft">
                Born {chart.identity.dob} · {chart.identity.sex} · phone ending {chart.identity.phone4}
              </p>
            )}
          </div>
          {chart && (
            <div className="flex flex-wrap gap-1.5">
              {chart.sources.map((s) => (
                <span key={s.source_name} className="inline-flex items-center gap-1.5 rounded-full bg-sapphire-soft px-3 py-1 text-xs font-semibold text-sapphire-deep">
                  <Hospital className="size-3.5" /> {s.source_name} <span className="tabular font-normal opacity-70">{s.recorded_date}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5">
          <p className="text-sm font-bold text-ink">Reason for access</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {REASONS.map(([k, v]) => (
              <button
                key={k}
                onClick={() => pick(k)}
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 transition ${reason === k ? "bg-sapphire text-white ring-sapphire" : "bg-white text-ink ring-[#d0ddf0] hover:bg-sapphire-soft/50"}`}
              >
                {v}
              </button>
            ))}
          </div>
          {!reason && (
            <p className="mt-2 text-sm text-ink-soft">
              Records open only after you pick a reason. Every lookup is logged, and the patient can see the log.
            </p>
          )}
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-critical" role="alert">{error}</p>}
      </section>

      <AnimatePresence>
        {reason && chart && (
          <motion.div key="ws" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            {resolved && (
              <section className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5 ring-1 ${resolved.outcome === "proceed" ? "bg-mist ring-jade/30" : "bg-white ring-[#d0ddf0]"}`}>
                <p className="text-[15px] text-ink">
                  <strong>{resolved.outcome === "proceed" ? "Move released." : "Move stopped."}</strong> {cap(plainText(resolved.detail, chart?.patient ? { [pid]: chart.patient.name } : {}))}.
                </p>
                <Link href="/board" className={btnDark}>Back to the board</Link>
              </section>
            )}

            {chart.hold && (
              <section className="rounded-2xl bg-human-soft p-6 ring-2 ring-human/50">
                <p className="flex items-center gap-2 text-sm font-black tracking-wide text-[#8a5a0f]"><ShieldAlert className="size-4" /> VERIFICATION REQUIRED</p>
                <p className="mt-2 text-[15px] text-ink">
                  The board is holding a move to <strong>{UNIT_NAME[chart.hold.to_unit] || chart.hold.to_unit}</strong>. It relies on{" "}
                  {chart.hold.because.map((f) => (FACT_LABEL[f] || f).toLowerCase()).join(", ")}.
                </p>
                <div className="mt-4 space-y-3">
                  {chart.hold.conflicts.map((c) => (
                    <div key={c.fact} className="rounded-xl bg-white p-4 ring-1 ring-human/30">
                      <Clash fact={c.fact} versions={c.versions} />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm font-bold text-[#8a5a0f]">{NOTICE}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={btnDark} onClick={() => resolve("proceed")}>
                    <Check className="size-4" /> Records checked: move to {UNIT_NAME[chart.hold.to_unit] || chart.hold.to_unit}
                  </button>
                  <button className={btnLight} onClick={() => resolve("cancel")}>
                    <CircleSlash className="size-4" /> Don&apos;t move
                  </button>
                </div>
              </section>
            )}

            <Panel
              title="Records at other hospitals"
              action={
                <button className={btnBlue} onClick={lookup} disabled={looking}>
                  {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Look up other hospitals
                </button>
              }
            >
              {matches ? (
                <Matches matches={matches} onDecide={decide} />
              ) : (
                <p className="text-[15px] text-ink-soft">
                  Search Baltimore hospitals for this patient by name, birth date and sex. Nothing is added to the chart until you confirm it&apos;s the same person.
                </p>
              )}
            </Panel>

            <Panel title="Merged chart">
              <FactList facts={chart.facts} sources={chart.sources.length} holdFacts={chart.hold?.because || []} />
            </Panel>

            <EntryBox session={session} pid={pid} reason={reason} onDone={() => load(reason)} onError={fail} />

            <OrderBox session={session} pid={pid} onDone={() => load(reason)} onError={fail} />

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Who opened this record">
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {log.map((e, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="tabular shrink-0 font-mono text-xs text-ink-soft">{e.at}</span>
                      <span className="text-ink">
                        {e.name || e.role} · {e.hospital}: {e.action}
                        {e.reason && <span className="text-ink-soft"> ({e.reason})</span>}
                      </span>
                    </li>
                  ))}
                  {log.length === 0 && <li className="text-sm text-ink-soft">No one yet.</li>}
                </ul>
              </Panel>
              <Panel title="Patient link">
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 break-all rounded-xl bg-sapphire-soft px-3 py-2 font-mono text-sm text-sapphire-deep">
                    <ExternalLink className="size-4 shrink-0" /> {link}
                  </a>
                ) : (
                  <button className={btnLight} onClick={makeLink}><Link2 className="size-4" /> Make a private link for the patient</button>
                )}
                <p className="mt-3 text-sm text-ink-soft">
                  They confirm their date of birth to open it. It shows their status and who opened their record. Never clinical details.
                </p>
              </Panel>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Matches({ matches, onDecide }: { matches: Candidate[]; onDecide: (ref: string, same: boolean) => void }) {
  if (matches.length === 0) return <p className="text-[15px] text-ink-soft">No other hospital has a matching record.</p>
  return (
    <ul className="space-y-3">
      {matches.map((m) => (
        <motion.li
          key={m.record_ref}
          layout
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-4 ring-1 ${m.match === "possible" ? "bg-human-soft/60 ring-human/40" : "bg-white ring-[#d0ddf0]"}`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong className="text-[15px] text-ink">{m.hospital}</strong>
            <span className="text-sm text-ink-soft">{m.source_name} · {m.recorded_date}</span>
            <span className="ml-auto">{m.match === "strong" ? <Chip tone="ok">Strong match</Chip> : <Chip tone="amber">Possible match</Chip>}</span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">{m.name} · born {m.dob} · {m.sex} · {m.facts} facts on file</p>
          {m.match === "possible" && (
            <p className="mt-2 text-sm text-ink">
              Same name, birth date and sex. Different {m.differs.map((d) => DIFF_LABEL[d] || d).join(", ")}.{" "}
              <strong>Is this the same person? A human must decide.</strong>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {m.linked && <span className="text-sm font-semibold text-jade-deep">{m.confirmed ? "Linked and confirmed by you" : "Already on this chart"}</span>}
            {!(m.linked && m.confirmed) && (
              <button className={btnDark} onClick={() => onDecide(m.record_ref, true)}><Check className="size-4" /> Same person</button>
            )}
            <button className={btnLight} onClick={() => onDecide(m.record_ref, false)}>Not this patient</button>
          </div>
        </motion.li>
      ))}
    </ul>
  )
}

/** One source's version, as a card: who said it, when, and what they said in everyday words. */
function VersionCard({ fact, v, tone }: { fact: string; v: Version; tone: "clash" | "calm" }) {
  const [open, setOpen] = useState(false)
  const { who, when } = sourceLabel(v.source_name, v.recorded_date)
  return (
    <div className={`flex-1 rounded-2xl p-4 ring-1 ${tone === "clash" ? "bg-white ring-human/40" : "bg-white ring-[#d0ddf0]"}`}>
      <p className="text-[11px] font-black tracking-wider text-ink-soft">{who}</p>
      <p className="tabular text-[11px] text-ink-soft">{when}</p>
      <p className="mt-2 text-lg font-bold leading-tight text-ink">{plainValue(fact, v.value, v.status)}</p>
      <button onClick={() => setOpen((o) => !o)} className="mt-2 text-[11px] font-semibold text-sapphire underline decoration-dotted underline-offset-2">
        {open ? v.resource_id : "where's this from?"}
      </button>
    </div>
  )
}

/** A disagreement: the sources face to face, with the exact safety wording underneath. */
export function Clash({ fact, versions, missing = [] }: { fact: string; versions: Version[]; missing?: string[] }) {
  return (
    <div data-clash data-fact={fact} data-fact-label={FACT_LABEL[fact] || fact} className="rounded-2xl bg-human-soft/60 p-4 ring-2 ring-human/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FactName f={fact} />
        <Chip tone="amber">These don&apos;t match</Chip>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {versions.map((v, i) => (
          <Fragment key={v.resource_id}>
            {i > 0 && <span aria-hidden className="grid shrink-0 place-items-center self-center text-human"><Zap className="size-5" /></span>}
            <VersionCard fact={fact} v={v} tone="clash" />
          </Fragment>
        ))}
      </div>
      {missing.length > 0 && <p className="mt-2 text-xs text-ink-soft">Not mentioned by: {missing.join(", ")}.</p>}
      <p className="mt-3 text-sm font-bold text-[#8a5a0f]">A person must decide which is right. We won&apos;t.</p>
      <p className="text-xs text-[#8a5a0f]/80">{NOTICE}</p>
    </div>
  )
}

/** The merged chart: what doesn't match, then the rest behind a click. */
function FactList({ facts, sources, holdFacts }: { facts: Fact[]; sources: number; holdFacts: string[] }) {
  const [showRest, setShowRest] = useState(false)
  const clashes = facts.filter((f) => f.kind === "conflict")
  const rest = facts.filter((f) => f.kind !== "conflict")
  const waiting = clashes.filter((f) => holdFacts.includes(f.fact)).length
  const n = clashes.length
  const verdict =
    n === 0
      ? `Everything matches across ${sources} record${sources === 1 ? "" : "s"}.`
      : `${n} thing${n === 1 ? "" : "s"} ${n === 1 ? "doesn't" : "don't"} match across ${sources} records.` +
        (waiting ? ` ${waiting === n && n === 1 ? "It is" : `${waiting} of them ${waiting === 1 ? "is" : "are"}`} what the paused move depends on.` : "")
  return (
    <div className="space-y-3">
      <p className={`text-[17px] font-bold ${n ? "text-ink" : "text-jade-deep"}`}>{verdict}</p>
      {clashes.map((f) => (
        <Clash key={f.fact} fact={f.fact} versions={f.versions} missing={f.missing_from} />
      ))}
      <button onClick={() => setShowRest((v) => !v)} className="text-sm font-semibold text-sapphire underline decoration-dotted underline-offset-4">
        {showRest ? "Hide" : `${rest.length} other thing${rest.length === 1 ? "" : "s"} the records agree on. Show ${rest.length === 1 ? "it" : "them"}.`}
      </button>
      {showRest && (
        <ul className="space-y-2">
          {rest.map((f) => (
            <li key={f.fact} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/70 px-4 py-2.5 text-sm ring-1 ring-[#d0ddf0]">
              <FactName f={f.fact} />
              <span className="font-semibold text-ink">{f.versions.length ? shortValue(f.fact, f.versions[0].value, f.versions[0].status) : "not recorded anywhere"}</span>
              <span className="ml-auto flex items-center gap-2">
                {f.kind === "gap" && <span className="text-xs text-ink-soft">only {f.versions.length} of {sources} records mention it</span>}
                {f.kind === "agree" ? <Chip tone="ok">{f.verified_by_human ? "Checked by a person" : "All agree"}</Chip> : <Chip tone="blue">Partly recorded</Chip>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The doctor writes what they found (asked the patient, called the pharmacy, read the bottle...).
// It is saved as one more source next to the others, never over them, so the gate still compares everything.
function EntryBox({ session, pid, reason, onDone, onError }: { session: Session; pid: string; reason: string; onDone: () => void; onError: (e: unknown) => void }) {
  const [fact, setFact] = useState(FACTS[0])
  const [status, setStatus] = useState("active")
  const [value, setValue] = useState("")
  const [done, setDone] = useState<{ fact: string; kind: string; source: string } | null>(null)
  const needsValue = status !== "absent"
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await portal.addEntry(session, pid, fact, value, status, reason)
      setDone({ fact, kind: r.kind, source: r.source_name })
      setValue("")
      onDone()
    } catch (err) {
      onError(err)
    }
  }
  return (
    <Panel title="Add to the record" action={<Chip tone="blue">Saved as {session.hospital} - Doctor&apos;s entry</Chip>}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <p className="text-sm font-bold text-ink">What did you check?</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {FACTS.map((f) => (
              <button type="button" key={f} title={FACT_TECH[f]} onClick={() => setFact(f)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition ${fact === f ? "bg-sapphire text-white ring-sapphire" : "bg-white text-ink ring-[#d0ddf0]"}`}>
                {FACT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="What you found">
            {ENTRY_STATUS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className={field} disabled={!needsValue} value={needsValue ? value : "none recorded"} onChange={(e) => setValue(e.target.value)}
            placeholder={fact === "blood_type" ? "e.g. O+" : fact === "anticoagulant" ? "e.g. warfarin 5mg" : "What you found"} aria-label="Value" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className={btnDark} type="submit" disabled={needsValue && !value.trim()}><FilePlus2 className="size-4" /> Add entry</button>
          <p className="text-sm text-ink-soft">It sits next to the other hospitals&apos; versions. It doesn&apos;t replace or hide them.</p>
        </div>
      </form>
      <AnimatePresence>
        {done && (
          <motion.p key={done.fact + done.kind} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${done.kind === "conflict" ? "bg-human-soft text-[#8a5a0f]" : "bg-mist text-jade-deep"}`}>
            {done.kind === "conflict"
              ? `Added to ${done.source}. ${FACT_LABEL[done.fact]}: the records still don't match; a person must decide.`
              : `Added to ${done.source}. ${FACT_LABEL[done.fact]} now shows your entry beside the others.`}
          </motion.p>
        )}
      </AnimatePresence>
    </Panel>
  )
}

function OrderBox({ session, pid, onDone, onError }: { session: Session; pid: string; onDone: () => void; onError: (e: unknown) => void }) {
  const [text, setText] = useState("")
  const [because, setBecause] = useState<string[]>([])
  const [result, setResult] = useState<OrderResult | null>(null)
  const [why, setWhy] = useState("")
  const toggle = (f: string) => setBecause((b) => (b.includes(f) ? b.filter((x) => x !== f) : [...b, f]))

  const check = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await portal.order(session, pid, text, because)
      setResult(r)
      if (r.status === "saved") onDone()
    } catch (err) {
      onError(err)
    }
  }
  const ack = async () => {
    if (!result) return
    try {
      const r = await portal.ack(session, result.order_id, why)
      setResult({ ...result, status: r.status })
      setWhy("")
      onDone()
    } catch (err) {
      onError(err)
    }
  }

  return (
    <Panel title="New order">
      <form onSubmit={check} className="space-y-3">
        <input className={field} placeholder="e.g. start heparin drip" value={text} onChange={(e) => setText(e.target.value)} />
        <div>
          <p className="text-sm font-bold text-ink">This order relies on</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {FACTS.map((f) => (
              <button
                type="button"
                key={f}
                title={FACT_TECH[f]}
                onClick={() => toggle(f)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition ${because.includes(f) ? "bg-sapphire text-white ring-sapphire" : "bg-white text-ink ring-[#d0ddf0]"}`}
              >
                {FACT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <button className={btnDark} type="submit" disabled={!text.trim()}><ClipboardCheck className="size-4" /> Check order</button>
      </form>
      <AnimatePresence mode="wait">
        {result?.status === "saved" && (
          <motion.p key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm font-semibold text-jade-deep">
            Order {result.order_id} saved.
          </motion.p>
        )}
        {result?.status === "needs_ack" && (
          <motion.div key="ack" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-human-soft p-5 ring-2 ring-human/50">
            <p className="flex items-center gap-2 text-sm font-black tracking-wide text-[#8a5a0f]"><ShieldAlert className="size-4" /> VERIFICATION REQUIRED</p>
            {result.warnings.map((w) => (
              <div key={w.fact} className="mt-3 rounded-xl bg-white p-4 ring-1 ring-human/30">
                <p className="mb-2 text-sm">This order relies on <FactName f={w.fact} />:</p>
                <Clash fact={w.fact} versions={w.versions} />
              </div>
            ))}
            <p className="mt-3 text-sm font-bold text-[#8a5a0f]">{NOTICE}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input className={`${field} flex-1 min-w-56`} placeholder="What did you check?" value={why} onChange={(e) => setWhy(e.target.value)} />
              <button className={btnDark} disabled={!why.trim()} onClick={ack}>I have reviewed</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}

/* ---------- Fells Point Heart Institute: send a transfer ---------- */
function SenderDesk({ session, onError }: { session: Session; onError: (e: unknown) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  usePoll((alive) => portal.patients(session).then((r) => alive() && setRows(r)).catch(onError), 4000, [session.token])
  const sent = useMemo(() => rows.filter((r) => r.state === "transferred").length, [rows])
  const send = async (p: Row) => {
    try {
      await portal.transfer(session, p.pid, HOME)
      setMsg(`Sent ${p.name} to ${HOME}, with this hospital's record attached.`)
      setRows(await portal.patients(session))
    } catch (e) {
      setMsg((e as Error).message)
      onError(e)
    }
  }
  return (
    <>
      <Kpis
        tiles={[
          { k: "Your patients", v: rows.length, cap: `At ${SINAI}`, icon: Users, dot: "bg-[#3fc3a4]" },
          { k: "Sent to Hopkins", v: sent, cap: sent ? "Their records went with them" : "None sent yet", icon: ArrowRightLeft, dot: "bg-[#7fb2ff]" },
        ]}
      />
      <Panel title={`Your patients at ${SINAI}`}>
        {msg && <p className="mb-3 rounded-xl bg-mist px-4 py-3 text-sm font-semibold text-jade-deep">{msg}</p>}
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.pid} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-[#d0ddf0]">
              <SevDot n={p.severity} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">{p.name}, {p.age}</span>
                <span className="block text-xs text-ink-soft">{p.complaint}</span>
              </span>
              <Code id={p.pid} />
              {p.state === "transferred" ? (
                <Chip tone="ok">Sent</Chip>
              ) : (
                <button className={btnBlue} onClick={() => send(p)}><ArrowRightLeft className="size-4" /> Transfer to {HOME}</button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  )
}
