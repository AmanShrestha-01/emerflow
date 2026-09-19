"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { checkSession, loadSession } from "@/lib/emer/session"

/** Staff screens need a login. `?mock=1` (offline practice) skips it. */
export function Gate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get("mock") === "1") return setOk(true)
    checkSession(loadSession()).then((good) => {
      if (good) setOk(true)
      else router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
    })
  }, [router])
  if (!ok) return <div className="grid min-h-screen place-items-center text-ink-soft">Checking your login…</div>
  return <>{children}</>
}
