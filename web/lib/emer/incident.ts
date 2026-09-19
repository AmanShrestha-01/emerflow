// The demo's mass-casualty incident, in one place: the map marks this spot, the hospital board names it,
// and the patients handed over from the map carry the same name.
import type { LatLon } from "@/components/capacity/types"

export const DEMO_INCIDENT = {
  /** What the map's pin and the board's banner call it. */
  name: "Orleans St bus crash",
  /** Beside the hospital the Swarm runs, so the dispatch plan really does send us a share. */
  point: [39.2966, -76.5975] as LatLon,
  casualties: 40,
}
