"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, Ambulance } from "lucide-react"
import type { SimulationState } from "@/components/capacity/use-simulation"
import { OUR_HOSPITAL_ID } from "@/lib/emer/capacity"
import { HOME } from "@/lib/emer/session"
import { api } from "@/lib/emer/api.js"
import { incidentName } from "@/lib/emer/incident"

// The map's what-if decides where the casualties go; our share goes straight to the hospital board, so the same
// incident carries on inside the hospital. The number is never invented: it is the simulator's own assignment.

export function IncidentHandoff({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = useRef("") // one send per incident, however often this re-renders
  const result = sim.result
  const playing = !!result && (sim.phase === "playing" || sim.phase === "paused")
  const ours = result?.assignments.find((a) => a.hospital_id === OUR_HOSPITAL_ID)
  const mine = ours?.casualties ?? 0
  const total = result?.incident.casualties ?? 0
  const key = result ? `${result.incident.lat},${result.incident.lon},${total}` : ""
  const name = incidentName(result ? [result.incident.lat, result.incident.lon] : null)

  useEffect(() => {
    if (!playing || !mine || done.current === key) return
    done.current = key
    setSent(false)
    setError(null)
    api
      .surge("bus", mine, name)
      .then(() => setSent(true))
      .catch((e: Error) => {
        done.current = "" // let the next run try again
        setError(e.message)
      })
  }, [playing, mine, key, name])

  if (!playing) return null

  return (
    <div className={`card-dark rounded-2xl p-5 ${className}`}>
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/60">
        <Ambulance className="size-4" /> Heading our way
      </p>
      {mine === 0 ? (
        <p className="mt-2 text-[15px] leading-relaxed text-white">
          The dispatch plan is sending none of the {total} casualties from the {name} to {HOME}: we are
          too full or on diversion, so ambulances are going to ERs with room.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[17px] leading-snug text-white">
            <span className="font-bold">{mine}</span> of the {total} casualties from the {name} are on
            their way to {HOME}
            {ours?.drive_min ? `, about ${ours.drive_min} min out` : ""}.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/80">
            <span>{sent ? "The hospital has them: its AI agents are finding beds." : "Telling the hospital…"}</span>
            <Link href="/board" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-1.5 text-sm font-bold text-ink">
              Open the board <ArrowRight className="size-3.5" />
            </Link>
          </p>
          {error && <p className="mt-3 text-sm text-critical-soft">The hospital did not take them: {error}</p>}
        </>
      )}
    </div>
  )
}
