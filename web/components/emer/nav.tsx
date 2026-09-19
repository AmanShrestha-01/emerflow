"use client"

import { useHospital } from "@/lib/emer/hospital"
import { Header1 } from "@/components/ui/header"

export function LiveBadge() {
  const { st, ev } = useHospital()
  const mock = ev.source === "mock"
  const live = st?.mode === "live"
  const label = mock ? "Practice data" : !ev.connected ? "Connecting…" : live ? "Live on Gemini" : st?.mode === "replay" ? "Gemini replay" : "Offline rules"
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-white">
      <span className={`size-2 rounded-full animate-pulse-dot ${ev.connected ? (live ? "bg-ai" : "bg-jade") : "bg-human"}`} />
      {label}
    </span>
  )
}

/** The site header (components/ui/header.tsx) plus a spacer, since the header is fixed. */
export function Nav() {
  return (
    <>
      <Header1 />
      <div aria-hidden className="h-[68px]" />
    </>
  )
}
