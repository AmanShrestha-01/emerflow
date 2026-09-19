// Asks the backend's Gemini dispatcher (POST /api/ems/dispatch) which hospitals each triage group should go to.
// The backend checks the picks against the rules; the browser then counts beds and waits (simulate-local.ts).
// No backend (static preview, offline): the same rule-based plan, computed here.
import { driveMinutes, miles } from "@/components/capacity/geo"
import { rulePlan, triage, type DispatchPlan } from "@/components/capacity/simulate-local"
import type { Hospital, LatLon } from "@/components/capacity/types"

export async function dispatchPlan(point: LatLon, casualties: number, hospitals: Hospital[], place = ""): Promise<DispatchPlan> {
  const t = triage(casualties)
  // Nearby hospitals only: nobody drives a crash victim 40 minutes past closer ERs.
  const near = hospitals
    .map((h) => ({ h, drive: driveMinutes(miles(point, [h.lat, h.lon])) }))
    .sort((a, b) => a.drive - b.drive)
    .slice(0, 10)
  try {
    const r = await fetch("/api/ems/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        casualties, ...t, place,
        hospitals: near.map(({ h, drive }) => ({
          id: h.id, name: h.name, trauma: h.trauma, status: h.status, drive_min: drive,
          beds_free: Math.max(0, h.er.capacity - h.er.occupied), level: h.live?.level ?? null,
        })),
      }),
    })
    if (!r.ok) throw new Error(String(r.status))
    return (await r.json()) as DispatchPlan
  } catch {
    return rulePlan(point, hospitals, casualties)
  }
}
