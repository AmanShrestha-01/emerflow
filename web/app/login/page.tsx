"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2, ShieldCheck, Stethoscope } from "lucide-react"
import { Logo } from "@/components/emer/logo"
import { CLASSIC, HOME, login, saveSession } from "@/lib/emer/session"

const ROLES = [
  { id: "commander", title: "Commander", sub: "The command board", icon: ShieldCheck },
  { id: "doctor", title: "Doctor", sub: "DeepChart records", icon: Stethoscope },
] as const

export default function LoginPage() {
  const router = useRouter()
  const [hospitals, setHospitals] = useState<string[]>([HOME])
  const [hospital, setHospital] = useState(HOME)
  const [role, setRole] = useState<"commander" | "doctor">("commander")
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch("/api/hospitals").then((r) => r.json()).then((l: { name: string }[]) => l.length && setHospitals(l.map((h) => h.name))).catch(() => {})
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const s = await login(hospital, role, pin)
      saveSession(s)
      if (s.role === "doctor") {
        window.location.assign(`${CLASSIC}/doctor`)
        return
      }
      const next = new URLSearchParams(window.location.search).get("next")
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/board")
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-10">
      <form onSubmit={submit} className="glass-strong w-full max-w-md rounded-[2rem] p-8">
        <Logo />
        <h1 className="mt-6 font-heading text-3xl font-bold tracking-tight text-ink">Staff login</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Your role decides which screen opens.</p>

        <label className="mt-6 block text-sm font-bold text-ink" htmlFor="hospital">Hospital</label>
        <select id="hospital" value={hospital} onChange={(e) => setHospital(e.target.value)} className="mt-1.5 h-12 w-full rounded-2xl bg-white/90 px-4 text-[15px] text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-jade">
          {hospitals.map((h) => <option key={h}>{h}</option>)}
        </select>

        <fieldset className="mt-5">
          <legend className="text-sm font-bold text-ink">Role</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl p-3.5 ring-1 transition ${role === r.id ? "bg-white ring-2 ring-jade" : "bg-white/60 ring-ink/10"}`}>
                <input type="radio" name="role" className="sr-only" checked={role === r.id} onChange={() => setRole(r.id)} />
                <r.icon className={`size-5 ${role === r.id ? "text-jade" : "text-ink-soft"}`} />
                <span>
                  <span className="block text-[15px] font-bold text-ink">{r.title}</span>
                  <span className="block text-xs text-ink-soft">{r.sub}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-5 block text-sm font-bold text-ink" htmlFor="pin">PIN</label>
        <div className="relative mt-1.5">
          <KeyRound className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <input id="pin" type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus className="h-12 w-full rounded-2xl bg-white/90 pl-11 pr-4 text-[15px] text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-jade" />
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-critical" role="alert">{error}</p>}

        <button disabled={busy || !pin} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white transition-opacity disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />} Log in
        </button>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">Demo only (PIN <code className="font-mono">demo</code>). A real hospital would use its own single sign-on.</p>
      </form>
    </main>
  )
}
