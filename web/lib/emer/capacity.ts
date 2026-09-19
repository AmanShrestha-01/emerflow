// Joins our live hospital (the Hospital Swarm sim) with the Baltimore capacity map (Robert's region data).
// Johns Hopkins shows our live ER; every other hospital keeps its recorded, simulated numbers.
import type { Hospital, Status } from "@/components/capacity/types"
import type { HState } from "./hospital"
import { ourWait } from "./hospitals"

export const OUR_HOSPITAL_ID = "jhh"

/** Status by the capacity map's own rules: red if anyone waits or the ER is ≥97% full, amber at ≥85%. */
function statusOf(pct: number, waiting: number, icuPct: number): Status {
  if (waiting > 0 || pct >= 97) return "critical"
  if (pct >= 85 || icuPct >= 85) return "busy"
  return "open"
}

export function withLiveHopkins(hospitals: Hospital[], st: HState | null): Hospital[] {
  if (!st) return hospitals
  const er = st.units?.find((u) => u.unit === "ER")
  const icu = st.units?.find((u) => u.unit === "ICU")
  if (!er) return hospitals
  const waiting = st.metrics?.waiting ?? 0
  const pct = er.beds ? Math.round((er.occupied / er.beds) * 100) : 0
  const icuPct = icu?.beds ? Math.round((icu.occupied / icu.beds) * 100) : 0
  return hospitals.map((h) =>
    h.id !== OUR_HOSPITAL_ID
      ? h
      : {
          ...h,
          status: statusOf(pct, waiting, icuPct),
          er: { occupied: er.occupied, capacity: er.beds, waiting },
          icu: icu ? { occupied: icu.occupied, capacity: icu.beds, waiting: 0 } : h.icu,
          beds_free: Math.max(0, er.beds - er.occupied) + (icu ? Math.max(0, icu.beds - icu.occupied) : 0),
          er_wait_min: ourWait(st.metrics?.avg_wait ?? 0, waiting, pct),
        },
  )
}
