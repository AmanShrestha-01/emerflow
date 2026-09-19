// Data sources: where hospital capacity and simulations come from.
//
// Components never fetch. They get data from a `RegionSource`, so the same UI runs
// against the live swarm server, a recorded snapshot, or any other backend.

import recordedRegion from "./fixtures/region.json";
import recordedSimulation from "./fixtures/simulation.json";
import type { RegionSnapshot, Simulation } from "./types";

export interface SimulateParams {
  lat: number;
  lon: number;
  casualties: number;
}

export interface RegionSource {
  /** Current state of every hospital in the region. Called on an interval. */
  region(): Promise<RegionSnapshot>;
  /** A what-if incident played forward. Omit if the backend can't simulate. */
  simulate?(params: SimulateParams): Promise<Simulation>;
  /** "live" for a real backend, "recorded" for fixtures. Shown in the UI. */
  kind: "live" | "recorded";
}

export const sampleRegion = recordedRegion as RegionSnapshot;
export const sampleSimulation = recordedSimulation as Simulation;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail, () => null);
    throw new Error(typeof detail === "string" ? detail : `${url} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** The swarm server (agent-workflow/server): GET {url}/region and GET {url}/simulate. */
export function swarmSource({ url = "http://localhost:8000" }: { url?: string } = {}): RegionSource {
  return {
    kind: "live",
    region: () => getJson<RegionSnapshot>(`${url}/region`),
    simulate: ({ lat, lon, casualties }) =>
      getJson<Simulation>(`${url}/simulate?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&casualties=${casualties}`),
  };
}

/**
 * Recorded data, no server. `simulate()` always plays the recorded scenario (a stadium crowd
 * crush downtown), wherever the incident is placed.
 */
export function recordedSource(region: RegionSnapshot = sampleRegion, simulation: Simulation = sampleSimulation): RegionSource {
  return {
    kind: "recorded",
    region: async () => region,
    simulate: async () => simulation,
  };
}

/** Tries `primary`; if it can't be reached, uses `fallback` from then on for that call. */
export function withFallback(primary: RegionSource, fallback: RegionSource = recordedSource()): RegionSource & {
  /** Which source answered the last region() call. */
  lastKind: () => "live" | "recorded";
} {
  let last: "live" | "recorded" = primary.kind;
  return {
    kind: primary.kind,
    lastKind: () => last,
    async region() {
      try {
        const data = await primary.region();
        last = primary.kind;
        return data;
      } catch {
        last = fallback.kind;
        return fallback.region();
      }
    },
    async simulate(params) {
      if (last === "live" && primary.simulate) return primary.simulate(params);
      if (!fallback.simulate) throw new Error("This data source can't simulate incidents.");
      return fallback.simulate(params);
    },
  };
}
