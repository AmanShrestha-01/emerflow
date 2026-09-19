// Data shapes. They mirror the swarm server's responses (agent-workflow/server/region.py):
// GET /region → RegionSnapshot, GET /simulate → Simulation.

export type Status = "open" | "busy" | "critical";
export type LatLon = [number, number];

export interface UnitLoad {
  occupied: number;
  capacity: number;
  waiting: number;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  trauma: string | null;
  status: Status;
  er: UnitLoad;
  icu: UnitLoad;
  beds_free: number;
  er_wait_min: number;
  receiving_incident: boolean;
  /** Reported ER averages from CMS (not live), when known. */
  cms?: CmsEr;
  /** Live status from MIEMSS EDAS, Maryland's ED advisory board, when known. */
  live?: EdasLive;
}

export interface EdasLive {
  /** ED crowding level, 1 (normal) to 4 (most crowded). */
  level: number | null;
  /** Active EDAS alerts (e.g. yellow, red, reroute). */
  alerts: string[];
  note: string | null;
  at_hospital: number;
  en_route: number;
  longest_stay_min: number;
  fetched_at: string;
}

export interface CmsEr {
  cms_id: string;
  /** Median minutes from arriving to leaving the ER (CMS OP-18b). */
  ed_minutes: number | null;
  /** Yearly ER volume band (CMS EDV): low, medium, high, very high. */
  volume: string | null;
  /** Percent who left before being seen (CMS OP-22). */
  left_unseen_pct: number | null;
}

export interface Incident {
  id: string;
  kind: string;
  title: string;
  lat: number;
  lon: number;
  casualties: number;
  started: string;
  receiving: string[];
  summary: string;
}

export interface RegionSnapshot {
  generated_at: string;
  simulated: boolean;
  region: { name: string; center: LatLon };
  hospitals: Hospital[];
  incidents: Incident[];
}

/** Triage: urgent = needs care now (red), delayed = can wait a little (yellow), minor = walking wounded (green). */
export type TriageGroup = "urgent" | "delayed" | "minor";

export interface SimulationFrame {
  /** Minutes since the incident. */
  minute: number;
  hospitals: Hospital[];
  /** Casualties still without a bed, with coordination and if everyone went to the nearest trauma center. */
  without_bed: { coordinated: number; nearest: number };
  /** Ambulances driving to each hospital at this minute. */
  in_transit?: Record<string, number>;
}

export interface SimulationOutcome {
  avg_to_bed_min: number;
  longest_to_bed_min: number;
  without_bed: number;
}

export interface Simulation {
  generated_at: string;
  simulated: boolean;
  incident: { lat: number; lon: number; casualties: number; seed: number; severity_mix: Record<string, number> };
  assignments: { hospital_id: string; casualties: number; severe: number; drive_min: number; groups?: Record<TriageGroup, number> }[];
  frames: SimulationFrame[];
  /** Per triage group: how many, and how long until they had a bed on average. */
  groups?: Record<TriageGroup, { count: number; avg_to_bed_min: number }>;
  /** For one more person arriving from the crash now: minutes until a bed, and wait at the door, per hospital. */
  waits?: { hospital_id: string; to_bed_min: number; door_wait_min: number; trauma: boolean }[];
  /** Who chose the hospitals: the Gemini dispatcher or the rule-based fallback. */
  dispatcher?: {
    how: string;
    briefing: string;
    why: Record<TriageGroup, string>;
    /** People the software sent somewhere other than the plan's hospitals, because those would have been much slower. */
    moved: Record<TriageGroup, number>;
  };
  comparison: {
    coordinated: SimulationOutcome;
    nearest: SimulationOutcome & { hospital_id: string; hospital: string };
  };
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string;
  severity: string;
  area: string;
  effective: string | null;
}

/** Who is looking: the public sees plain language; EMS crews also see unit loads and trauma levels. */
export type Audience = "public" | "ems";
/** How the hospital list is ordered. "fastest" = estimated drive + ER wait. */
export type SortBy = "nearest" | "fastest";
