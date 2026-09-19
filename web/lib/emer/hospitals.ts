// EMS map data and time-to-care math. Pure functions, no React.
//
// Hospital locations are real Baltimore addresses. Only Johns Hopkins has live numbers (from the simulation);
// the others are synthetic and drift slowly with the sim clock. Drive times are straight-line estimates,
// not a routing service, so the page works offline.

export type LatLng = [number, number]

export type Hospital = {
  id: string
  name: string
  short: string
  pos: LatLng
  ours?: boolean
  // Synthetic hospitals only: baseline busyness (%) and ED wait (min).
  base?: { busy: number; wait: number }
}

export type HospitalStatus = Hospital & {
  busy: number // ED occupancy, percent
  wait: number // estimated ED wait for a new arrival, minutes
  waitingRoom: number // people in the ER waiting to be seen
  diversion: boolean
  simulated: boolean
}

export type Option = HospitalStatus & { miles: number; drive: number; total: number }

export const HOSPITALS: Hospital[] = [
  { id: "jhh", name: "Johns Hopkins Hospital", short: "Hopkins", pos: [39.2963, -76.5925], ours: true },
  { id: "ummc", name: "University of Maryland Medical Center", short: "UMMC", pos: [39.2887, -76.625], base: { busy: 88, wait: 34 } },
  { id: "mercy", name: "Mercy Medical Center", short: "Mercy", pos: [39.2939, -76.6124], base: { busy: 62, wait: 12 } },
  { id: "union", name: "MedStar Union Memorial", short: "Union Memorial", pos: [39.3296, -76.6127], base: { busy: 71, wait: 18 } },
  { id: "sinai", name: "Sinai Hospital", short: "Sinai", pos: [39.3531, -76.662], base: { busy: 58, wait: 10 } },
  { id: "bayview", name: "Johns Hopkins Bayview", short: "Bayview", pos: [39.2896, -76.5475], base: { busy: 79, wait: 22 } },
  { id: "harbor", name: "MedStar Harbor Hospital", short: "Harbor", pos: [39.2511, -76.6139], base: { busy: 54, wait: 8 } },
]

// About 5 miles north-east of Hopkins.
export const AMBULANCE_START: LatLng = [39.362, -76.535]

const CITY_MPH = 25 // average city driving speed with lights
const ROAD_FACTOR = 1.3 // roads are longer than a straight line

export function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function driveMinutes(miles: number): number {
  return Math.max(1, Math.round(((miles * ROAD_FACTOR) / CITY_MPH) * 60))
}

// Estimated wait for a NEW arrival at our ED: the current average wait, plus 2 minutes for every patient already
// waiting, plus 15 when the ER is full. A rough, labeled estimate, not a promise.
export function ourWait(avgWait: number, waiting: number, erPercent: number): number {
  return Math.round(Math.max(0, avgWait) + 2 * Math.max(0, waiting) + (erPercent >= 100 ? 15 : 0))
}

// Synthetic hospitals drift with the sim clock: busier and slower together, never below zero.
export function syntheticStatus(h: Hospital, clock: number): { busy: number; wait: number; waitingRoom: number } {
  const b = h.base ?? { busy: 60, wait: 10 }
  const seed = h.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0)
  const wave = Math.sin(clock / 25 + seed) // -1..1, slow
  const busy = Math.max(20, Math.min(110, Math.round(b.busy + wave * 8)))
  const wait = Math.max(0, Math.round(b.wait * (1 + wave * 0.35)))
  // A longer wait means a fuller waiting room: roughly one person per 2.5 minutes of wait, plus a few when busy.
  return { busy, wait, waitingRoom: Math.max(0, Math.round(wait / 2.5 + busy / 25)) }
}

export function busyLevel(busy: number): "ok" | "busy" | "full" {
  return busy >= 95 ? "full" : busy >= 80 ? "busy" : "ok"
}

// Every hospital with its drive + wait from the ambulance, fastest first. Hospitals on diversion sort last.
export function rankOptions(from: LatLng, statuses: HospitalStatus[]): Option[] {
  return statuses
    .map((s) => {
      const miles = milesBetween(from, s.pos)
      const drive = driveMinutes(miles)
      return { ...s, miles, drive, total: drive + s.wait }
    })
    .sort((a, b) => Number(a.diversion) - Number(b.diversion) || a.total - b.total || a.miles - b.miles)
}

// The suggestion: the fastest open hospital, plus the closest one when they differ (so the panel can say why).
export function suggest(options: Option[]): { best: Option | null; closest: Option | null; saves: number } {
  const best = options.find((o) => !o.diversion) ?? null
  const closest = [...options].sort((a, b) => a.miles - b.miles)[0] ?? null
  const saves = best && closest && best.id !== closest.id ? closest.total - best.total : 0
  return { best, closest, saves }
}
