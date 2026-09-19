"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionSource } from "./sources";
import type { LatLon, Simulation } from "./types";

/**
 * off → placing (waiting for a click on the map) → ready (point chosen) → loading → playing / paused.
 * `exit()` goes back to off from anywhere.
 */
export type SimulationPhase = "off" | "placing" | "ready" | "loading" | "playing" | "paused" | "error";

export interface SimulationState {
  phase: SimulationPhase;
  point: LatLon | null;
  casualties: number;
  result: Simulation | null;
  /** Index into result.frames. */
  frame: number;
  error: string | null;
  begin(): void;
  place(point: LatLon): void;
  /** Place an incident and run it in one step (e.g. a "run the demo" button). */
  start(point: LatLon, casualties: number): void;
  setCasualties(n: number): void;
  run(): void;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  exit(): void;
}

export function useSimulation(source: RegionSource, { frameMs = 650 }: { frameMs?: number } = {}): SimulationState {
  const [phase, setPhase] = useState<SimulationPhase>("off");
  const [point, setPoint] = useState<LatLon | null>(null);
  const [casualties, setCasualties] = useState(40);
  const [result, setResult] = useState<Simulation | null>(null);
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  const exit = useCallback(() => {
    runId.current++;
    setPhase("off");
    setPoint(null);
    setResult(null);
    setFrame(0);
    setError(null);
  }, []);

  const runAt = useCallback((point: LatLon, casualties: number) => {
    if (!source.simulate) {
      setError("This data source can't simulate incidents.");
      setPhase("error");
      return;
    }
    const id = ++runId.current;
    setPhase("loading");
    setError(null);
    source
      .simulate({ lat: point[0], lon: point[1], casualties })
      .then((sim) => {
        if (id !== runId.current) return; // a newer run or exit happened meanwhile
        setResult(sim);
        // A recorded source plays its own scenario; show it where it happened.
        setPoint([sim.incident.lat, sim.incident.lon]);
        setFrame(0);
        setPhase("playing");
      })
      .catch((e: Error) => {
        if (id !== runId.current) return;
        setError(e.message);
        setPhase("error");
      });
  }, [source]);

  // Playback: advance one frame per tick, pause on the last one.
  const frames = result?.frames.length ?? 0;
  useEffect(() => {
    if (phase !== "playing" || frame >= frames - 1) return;
    const t = setTimeout(() => {
      if (frame + 1 >= frames - 1) setPhase("paused");
      setFrame(frame + 1);
    }, frameMs);
    return () => clearTimeout(t);
  }, [phase, frame, frames, frameMs]);

  return {
    phase,
    point,
    casualties,
    result,
    frame,
    error,
    begin: () => {
      exit();
      setPhase("placing");
    },
    place: (p) => {
      setPoint(p);
      setPhase("ready");
    },
    setCasualties,
    run: () => point && runAt(point, casualties),
    start: (p, n) => {
      setPoint(p);
      setCasualties(n);
      setResult(null);
      setFrame(0);
      runAt(p, n);
    },
    play: () => {
      if (!result) return;
      if (frame >= result.frames.length - 1) setFrame(0);
      setPhase("playing");
    },
    pause: () => setPhase("paused"),
    seek: (f) => {
      setFrame(f);
      setPhase((p) => (p === "playing" ? "paused" : p));
    },
    exit,
  };
}
