"use client"

import { useEffect, useState } from "react"
import { motion } from "motion/react"
import { Eye, Hospital, Loader2, Lock, ShieldCheck } from "lucide-react"
import { Logo } from "@/components/emer/logo"
import { TextReveal } from "@/components/ui/text-reveal"
import { portal, type PatientView } from "@/lib/emer/portal"

// What a patient sees from their private link (/p/<token>). No staff login: the link plus their date of birth.
// They confirm their date of birth first. Then: their status, which hospitals' records their team is using, and who opened their record.
// Never clinical values, never record conflicts, never anyone else.
function readToken() {
  const m = window.location.pathname.match(/^\/p\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : new URLSearchParams(window.location.search).get("t")
}

// Server messages, in the patient's words
function say(msg: string) {
  if (msg === "this link is not valid") return "This link is not valid. Ask your care team for a new one."
  return msg.charAt(0).toUpperCase() + msg.slice(1) + "."
}

export default function PatientLinkPage() {
  const [view, setView] = useState<PatientView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dob, setDob] = useState("") // kept in memory only: never in the URL or browser storage
  const [checked, setChecked] = useState<string | null>(null) // the date the server accepted
  const [busy, setBusy] = useState(false)

  const check = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      setView(await portal.patientView(readToken() || "-", dob))
      setChecked(dob)
      setError(null)
    } catch (err) {
      setError(say((err as Error).message))
    }
    setBusy(false)
  }

  // once confirmed, keep the page current
  useEffect(() => {
    if (!checked) return
    let alive = true
    const t = setInterval(() => {
      portal
        .patientView(readToken() || "-", checked)
        .then((v) => alive && setView(v))
        .catch((e: Error) => alive && (setView(null), setChecked(null), setError(say(e.message))))
    }, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [checked])

  return (
    <main className="theme-doctor min-h-screen px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-soft ring-1 ring-[#d0ddf0]">Johns Hopkins Hospital</span>
        </div>

        {!view && (
          <form onSubmit={check} className="glass rounded-2xl p-6">
            <h1 className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight text-ink"><Lock className="size-5 text-sapphire" /> Your visit</h1>
            <p className="mt-1 text-[15px] text-ink-soft">To keep this page private, confirm your date of birth.</p>
            <label htmlFor="dob" className="mt-5 block text-sm font-bold text-ink">Date of birth</label>
            <input
              id="dob"
              type="date"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="mt-1.5 h-12 w-full rounded-2xl bg-white px-4 text-[15px] text-ink ring-1 ring-[#d0ddf0] focus:outline-none focus:ring-2 focus:ring-sapphire"
            />
            {error && <p className="mt-3 text-sm font-semibold text-critical" role="alert">{error}</p>}
            <button disabled={busy || !dob} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white disabled:opacity-50">
              {busy && <Loader2 className="size-4 animate-spin" />} Open my page
            </button>
          </form>
        )}

        {view && (
          <>
            <section className="card-dark rounded-2xl p-6">
              <TextReveal as="h1" per="char" preset="fade-in-blur" speedReveal={1.5} className="font-heading text-3xl font-bold tracking-tight">
                {`Hi ${view.first_name}.`}
              </TextReveal>
              <motion.p key={view.status_line} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-lg leading-snug text-white/85">
                {view.status_line}
              </motion.p>
              <p className="mt-4 flex items-center gap-2 text-xs text-white/60">
                <span className="size-2 rounded-full bg-[#7fb2ff] animate-pulse-dot" /> This page updates on its own
              </p>
            </section>

            <section className="glass rounded-2xl p-6">
              <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-ink"><Hospital className="size-5 text-sapphire" /> Records your team is using</h2>
              <p className="mt-1 text-sm text-ink-soft">Your doctors only add a hospital&apos;s record after checking it&apos;s really yours.</p>
              <ul className="mt-3 space-y-2">
                {view.records.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-sapphire-soft/50 px-3.5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{r.hospital}</span>
                      <span className="block text-xs text-ink-soft">{r.kind}</span>
                    </span>
                    <span className="tabular font-mono text-xs text-ink-soft">{r.recorded_date}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="glass rounded-2xl p-6">
              <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-ink"><Eye className="size-5 text-sapphire" /> Who opened your record</h2>
              {view.access_log.length === 0 ? (
                <p className="mt-2 text-sm text-ink-soft">No one yet.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {view.access_log.map((e, i) => (
                    <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
                      <span className="tabular w-16 shrink-0 pt-0.5 font-mono text-xs text-ink-soft">{e.at}</span>
                      <span className="text-sm text-ink">
                        <span className="font-semibold">{e.name || e.role}</span> · {e.hospital}
                        <span className="block text-ink-soft">
                          {e.action}
                          {e.reason ? ` · reason: ${e.reason}` : ""}
                        </span>
                      </span>
                    </motion.li>
                  ))}
                </ol>
              )}
            </section>

            <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-soft">
              <ShieldCheck className="size-4 shrink-0 text-sapphire" />
              Only people with this link can see this page. It never shows test results or medicines. Questions about your care? Ask
              your care team. Demo: the hospital, doctors and data are fictional.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
