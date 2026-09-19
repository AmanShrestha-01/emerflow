// Our Hospital Swarm simulation stands in for the Johns Hopkins marker on the capacity map, so the demo
// shows one hospital from the inside and the outside. Its beds, waits and diversion are SIMULATED, never
// real Hopkins numbers; every other hospital keeps its own (CMS baseline, live MIEMSS status where we have it).
import type { Hospital, Status } from "@/components/capacity/types"
import type { HState } from "./hospital"
import { ourWait } from "./hospitals"
import { HOME } from "./session"

export const OUR_HOSPITAL_ID = "jhh"
const OUR_SPOT = { lat: 39.2963, lon: -76.5925, address: "1800 Orleans St, Baltimore" }

/** Status by the capacity map's own rules: red if anyone waits or the ER is ≥97% full, amber at ≥85%. */
function statusOf(pct: number, waiting: number, icuPct: number): Status {
  if (waiting > 0 || pct >= 97) return "critical"
  if (pct >= 85 || icuPct >= 85) return "busy"
  return "open"
}

/** Our hospital as a map marker, live from the Swarm sim. Not shown until the sim has reported. */
export function withOurHospital(hospitals: Hospital[], st: HState | null): Hospital[] {
  const rest = hospitals.filter((h) => h.id !== OUR_HOSPITAL_ID)
  if (!st) return rest
  const er = st.units?.find((u) => u.unit === "ER")
  const icu = st.units?.find((u) => u.unit === "ICU")
  if (!er) return rest
  const waiting = st.metrics?.waiting ?? 0
  const pct = er.beds ? Math.round((er.occupied / er.beds) * 100) : 0
  const icuPct = icu?.beds ? Math.round((icu.occupied / icu.beds) * 100) : 0
  const ours: Hospital = {
    id: OUR_HOSPITAL_ID,
    name: HOME,
    address: OUR_SPOT.address,
    lat: OUR_SPOT.lat,
    lon: OUR_SPOT.lon,
    trauma: "Level I",
    status: statusOf(pct, waiting, icuPct),
    er: { occupied: er.occupied, capacity: er.beds, waiting },
    icu: icu ? { occupied: icu.occupied, capacity: icu.beds, waiting: 0 } : { occupied: 0, capacity: 0, waiting: 0 },
    beds_free: Math.max(0, er.beds - er.occupied) + (icu ? Math.max(0, icu.beds - icu.occupied) : 0),
    er_wait_min: ourWait(st.metrics?.avg_wait ?? 0, waiting, pct),
    receiving_incident: false,
  }
  return [ours, ...rest]
}
