// The EMS map's hospital list, from CMS (tools/cms_er.py writes cms-er.json): every emergency department
// within 25 miles of downtown Baltimore, with its reported ER averages.
// CMS numbers are real but not live (yearly averages, updated quarterly). Each hospital's "right now"
// numbers are simulated from that baseline: a longer typical ER stay means a fuller ER.
import type { Hospital, RegionSnapshot, Status } from "@/components/capacity/types"
import cms from "./cms-er.json"

export const CMS_PERIOD = cms.periods.OP_18b

type CmsHospital = (typeof cms.hospitals)[number]

// Rough ER bed counts by CMS yearly volume band (CMS doesn't publish bed counts).
const BEDS: Record<string, number> = { low: 12, medium: 20, high: 32, "very high": 44 }

/** A steady number in [0, 1) per hospital, so the simulated numbers don't jump on every load. */
function seeded(id: string) {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

function simulate(c: CmsHospital): Hospital {
  const capacity = BEDS[c.volume ?? ""] ?? 24
  // 3.5 h typical ER stay ≈ 65% full; 6 h ≈ 90%. Plus up to ±10% for "today".
  const base = 0.65 + ((c.ed_minutes ?? 240) - 210) / 600
  const pct = Math.min(1.02, Math.max(0.4, base + (seeded(c.id) - 0.5) * 0.2))
  const occupied = Math.min(capacity, Math.round(capacity * pct))
  const waiting = pct > 1 ? Math.ceil((pct - 1) * capacity) + 1 : 0
  const status: Status = waiting > 0 || occupied >= capacity ? "critical" : occupied / capacity >= 0.85 ? "busy" : "open"
  const icuCap = Math.round(capacity * 1.1)
  const icuOcc = Math.round(icuCap * (0.7 + seeded(c.id + "icu") * 0.2))
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    lat: c.lat,
    lon: c.lon,
    trauma: c.trauma,
    status,
    er: { occupied, capacity, waiting },
    icu: { occupied: icuOcc, capacity: icuCap, waiting: 0 },
    beds_free: capacity - occupied + icuCap - icuOcc,
    er_wait_min: status === "critical" ? 40 + waiting * 5 : status === "busy" ? 25 : 10,
    receiving_incident: false,
    cms: { cms_id: c.cms_id, ed_minutes: c.ed_minutes, volume: c.volume, left_unseen_pct: c.left_unseen_pct },
  }
}

/** Every CMS emergency department on the map. Recorded hospitals keep their numbers, gaining the CMS facts. */
export function withCmsHospitals(region: RegionSnapshot): RegionSnapshot {
  const recorded = Object.fromEntries(region.hospitals.map((h) => [h.id, h]))
  const hospitals = cms.hospitals.map((c) => {
    const sim = simulate(c)
    const r = recorded[c.id]
    return r ? { ...r, name: c.name, lat: c.lat, lon: c.lon, trauma: c.trauma ?? r.trauma, cms: sim.cms } : sim
  })
  return { ...region, hospitals }
}

/* ---------- Live status from MIEMSS EDAS (backend /api/edas) ---------- */

export type EdasFeed = {
  available: boolean
  fetched_at?: string
  hospitals?: { code: string; level: number | null; alerts: string[]; note: string | null; at_hospital: number; en_route: number; longest_stay_min: number }[]
}

const EDAS_CODE: Record<string, string> = Object.fromEntries(cms.hospitals.filter((c) => c.edas_code).map((c) => [c.id, c.edas_code as string]))
// Share of ER beds in use that each EDAS level stands for on the map (EDAS gives a level, not bed counts).
const LEVEL_FULL = [0, 0.6, 0.8, 0.9, 1]

/** Replaces simulated status with the live EDAS level where we have one: 1–2 open, 3 busy, 4 or any alert full. */
export function withEdas(hospitals: Hospital[], feed: EdasFeed | null): Hospital[] {
  if (!feed?.available || !feed.hospitals) return hospitals
  const byCode = Object.fromEntries(feed.hospitals.map((h) => [h.code, h]))
  return hospitals.map((h) => {
    const e = byCode[EDAS_CODE[h.id]]
    if (!e || e.level == null) return h
    const status: Status = e.alerts.length || e.level >= 4 ? "critical" : e.level === 3 ? "busy" : "open"
    const occupied = Math.round(h.er.capacity * LEVEL_FULL[Math.min(4, Math.max(1, e.level))])
    return {
      ...h,
      status,
      er: { ...h.er, occupied, waiting: 0 },
      er_wait_min: status === "critical" ? 40 : status === "busy" ? 25 : e.level === 2 ? 15 : 10,
      live: { ...e, fetched_at: feed.fetched_at ?? "" },
    }
  })
}
