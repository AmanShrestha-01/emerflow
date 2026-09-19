"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Ambulance } from "lucide-react"
import type { SimulationState } from "@/components/capacity/use-simulation"
import { OUR_HOSPITAL_ID } from "@/lib/emer/capacity"
import { HOME } from "@/lib/emer/session"
import { api } from "@/lib/emer/api.js"
import { DEMO_INCIDENT } from "@/lib/emer/incident"

// The map's what-if decides where the casualties go. This hands OUR share to the hospital board,
// so the same incident carries on inside the hospital. The map never invents the number: it is the
// simulator's own assignment for our hospital.

export function IncidentHandoff({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  const [sent, setSent] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const result = sim.result
  if (!result || (sim.phase !== "playing" && sim.phase !== "paused")) return null

  const ours = result.assignments.find((a) => a.hospital_id === OUR_HOSPITAL_ID)
  const mine = ours?.casualties ?? 0
  const total = result.incident.casualties
  // The demo tells one story, so every incident carries the demo's name on the map and on the board.
  const name = `the ${DEMO_INCIDENT.name}`
  const sendName = DEMO_INCIDENT.name

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.surge("bus", mine, sendName)
      setSent(mine)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`card-dark rounded-2xl p-5 ${className}`}>
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/60">
        <Ambulance className="size-4" /> Heading our way
      </p>
      {mine === 0 ? (
        <p className="mt-2 text-[15px] leading-relaxed text-white">
          The dispatch plan is sending none of the {total} casualties from {name} to {HOME}: we are too full or on diversion, so
          ambulances are going to ERs with room.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[17px] leading-snug text-white">
            <span className="font-bold">{mine}</span> of the {total} casualties from {name} are assigned to {HOME}
            {ours?.drive_min ? `, about ${ours.drive_min} min out` : ""}.
          </p>
          {sent == null ? (
            <button onClick={send} disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-ink disabled:opacity-60">
              {busy ? "Sending…" : <>Send them to the hospital board <ArrowRight className="size-4" /></>}
            </button>
          ) : (
            <p className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/80">
              <span>{sent} patient{sent === 1 ? "" : "s"} are on their way in.</span>
              <Link href="/board" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-1.5 text-sm font-bold text-ink">
                Open the board <ArrowRight className="size-3.5" />
              </Link>
            </p>
          )}
          {error && <p className="mt-3 text-sm text-critical-soft">{error}</p>}
        </>
      )}
    </div>
  )
}
