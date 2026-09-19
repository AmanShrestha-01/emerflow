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

export interface SimulationFrame {
  /** Minutes since the incident. */
  minute: number;
  hospitals: Hospital[];
  /** Casualties still without a bed, with coordination and if everyone went to the nearest trauma center. */
  without_bed: { coordinated: number; nearest: number };
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
  assignments: { hospital_id: string; casualties: number; severe: number; drive_min: number }[];
  frames: SimulationFrame[];
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
