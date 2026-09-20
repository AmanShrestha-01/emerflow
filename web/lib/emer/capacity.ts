// Our Hospital Swarm simulation stands in for the Johns Hopkins marker on the capacity map, so the demo
// shows one hospital from the inside and the outside. Its beds, waits and diversion are SIMULATED, never
// real Hopkins numbers; every other hospital keeps its own (CMS baseline, live MIEMSS status where we have it).
import type { Hospital, Status } from "@/components/capacity/types"
import type { HState } from "./hospital"
import { ourWait } from "./hospitals"
import { HOME } from "./session"

export const OUR_HOSPITAL_ID = "jhh"
const OUR_SPOT = { lat: 39.2963, lon: -76.5925, address: "1800 Orleans St, Baltimore" }

/** Status by the capacity map's own rules, on the emergency department alone: red if anyone is waiting or it
 * is ≥97% full, amber at ≥85%. A full intensive care unit does not make a half-empty ER look busy; the row
 * says "no intensive care beds" separately, because that is what an ambulance crew needs to know. */
function statusOf(pct: number, waiting: number): Status {
  if (waiting > 0 || pct >= 97) return "critical"
  if (pct >= 85) return "busy"
  return "open"
}

// Fixed on the map: the beds the crews see for us stay put, whatever the simulation is doing inside.
const OUR_ER: [number, number] = [10, 20]
const OUR_ICU: [number, number] = [8, 10]

/** Our hospital as a map marker. The numbers are fixed; only a human's diversion changes what crews are told. */
export function withOurHospital(hospitals: Hospital[], st: HState | null): Hospital[] {
  const rest = hospitals.filter((h) => h.id !== OUR_HOSPITAL_ID)
  if (!st) return rest
  const [erOcc, erCap] = OUR_ER
  const [icuOcc, icuCap] = OUR_ICU
  const waiting = 0
  const pct = Math.round((erOcc / erCap) * 100)
  const ours: Hospital = {
    id: OUR_HOSPITAL_ID,
    name: HOME,
    address: OUR_SPOT.address,
    lat: OUR_SPOT.lat,
    lon: OUR_SPOT.lon,
    trauma: "Level I",
    status: statusOf(pct, waiting),
    er: { occupied: erOcc, capacity: erCap, waiting },
    icu: { occupied: icuOcc, capacity: icuCap, waiting: 0 },
    beds_free: erCap - erOcc + (icuCap - icuOcc),
    er_wait_min: ourWait(0, waiting, pct),
    receiving_incident: false,
  }
  return [ours, ...rest]
}
