"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2, ShieldCheck, Stethoscope } from "lucide-react"
import { HOME, login, saveSession } from "@/lib/emer/session"

const ROLES = [
  { id: "commander", title: "Hospital", sub: "The command board", icon: ShieldCheck },
  { id: "doctor", title: "Doctor", sub: "DeepChart records", icon: Stethoscope },
] as const

const noop = () => () => {}

/** Staff login: hospital → role → PIN. Used by /login and the header's sign-in panel. */
export function LoginForm({ className = "", autoFocus = true }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter()
  const [hospitals, setHospitals] = useState<{ name: string; doctors: string[] }[]>([{ name: HOME, doctors: [] }])
  const [hospital, setHospital] = useState(HOME)
  const [doctor, setDoctor] = useState("") // "" = the hospital's first doctor
  // ?as=doctor preselects Doctor; the person's own click wins after that.
  const asDoctor = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("as") === "doctor", () => false)
  const [picked, setRole] = useState<"commander" | "doctor" | null>(null)
  const role = picked ?? (asDoctor ? "doctor" : "commander")
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch("/api/hospitals").then((r) => r.json()).then((l: { name: string; doctors?: string[] }[]) => l.length && setHospitals(l.map((h) => ({ name: h.name, doctors: h.doctors || [] })))).catch(() => {})
  }, [])

  const doctors = hospitals.find((h) => h.name === hospital)?.doctors || []
  const who = doctors.includes(doctor) ? doctor : doctors[0] || ""

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const s = await login(hospital, role, pin, role === "doctor" && who ? who : undefined)
      saveSession(s)
      const next = new URLSearchParams(window.location.search).get("next")
      const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null
      // Doctors land in DeepChart; everyone else on the board.
      if (s.role === "doctor") router.replace(safe?.startsWith("/doctor") ? safe : "/doctor")
      else router.replace(safe && !safe.startsWith("/doctor") ? safe : "/board")
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
      <form onSubmit={submit} className={className}>

        <label className="mt-6 block text-sm font-bold text-ink" htmlFor="hospital">Hospital</label>
        <select id="hospital" value={hospital} onChange={(e) => setHospital(e.target.value)} className="mt-1.5 h-12 w-full rounded-2xl bg-white/90 px-4 text-[15px] text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-jade">
          {hospitals.map((h) => <option key={h.name}>{h.name}</option>)}
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

        {role === "doctor" && doctors.length > 0 && (
          <>
            <label className="mt-5 block text-sm font-bold text-ink" htmlFor="doctor">Doctor</label>
            <select id="doctor" value={who} onChange={(e) => setDoctor(e.target.value)} className="mt-1.5 h-12 w-full rounded-2xl bg-white/90 px-4 text-[15px] text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-jade">
              {doctors.map((d) => <option key={d}>{d}</option>)}
            </select>
          </>
        )}

        <label className="mt-5 block text-sm font-bold text-ink" htmlFor="pin">PIN</label>
        <div className="relative mt-1.5">
          <KeyRound className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <input id="pin" type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus={autoFocus} className="h-12 w-full rounded-2xl bg-white/90 pl-11 pr-4 text-[15px] text-ink ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-jade" />
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-critical" role="alert">{error}</p>}

        <button disabled={busy || !pin} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white transition-opacity disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />} Log in
        </button>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">Demo only (PIN <code className="font-mono">demo</code>). A real hospital would use its own single sign-on.</p>
      </form>
  )
}
