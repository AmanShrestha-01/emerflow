// The demo's mass-casualty incidents, in one place: the map marks the spot, the hospital board names it,
// and the patients handed over from the map carry the same name. The name decides the injuries: a shooting
// sends penetrating trauma and needs blood and surgery; a crash sends blunt trauma, scans and fractures.
import type { LatLon } from "@/components/capacity/types"

export type Incident = { id: string; name: string; where: string; point: LatLon; casualties: number }

export const INCIDENTS: Incident[] = [
  {
    id: "crash",
    name: "Orleans St car crash",
    where: "Orleans St, beside the hospital",
    point: [39.2966, -76.5975],
    casualties: 25,
  },
  {
    id: "shooting",
    name: "Lexington Market shooting",
    where: "Lexington Market, downtown",
    point: [39.2919, -76.6216],
    casualties: 18,
  },
]

/** The one the demo runs unless you pick the other. */
export const DEMO_INCIDENT = INCIDENTS[0]

/** What to call an incident the map is playing out, from where it happened. */
export function incidentName(point: LatLon | null | undefined): string {
  if (!point) return "mass casualty incident"
  const near = INCIDENTS.find((i) => Math.abs(i.point[0] - point[0]) < 0.004 && Math.abs(i.point[1] - point[1]) < 0.004)
  return near ? near.name : "mass casualty incident"
}
