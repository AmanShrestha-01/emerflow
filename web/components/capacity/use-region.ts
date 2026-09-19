"use client";

import { useEffect, useState } from "react";
import type { RegionSource } from "./sources";
import type { RegionSnapshot } from "./types";

export interface RegionState {
  data: RegionSnapshot | null;
  /** Which kind of source produced `data`: the live swarm or a recording. */
  kind: "live" | "recorded" | null;
  error: string | null;
}

/** Loads the region from `source` and refreshes it every `refreshMs` (0 = once). */
export function useRegion(source: RegionSource, { refreshMs = 30_000 }: { refreshMs?: number } = {}): RegionState {
  const [state, setState] = useState<RegionState>({ data: null, kind: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      source
        .region()
        .then((data) => {
          if (cancelled) return;
          const last = "lastKind" in source && typeof source.lastKind === "function" ? source.lastKind() : source.kind;
          setState({ data, kind: last, error: null });
        })
        .catch((e: Error) => !cancelled && setState((s) => ({ ...s, error: e.message })));
    load();
    const t = refreshMs > 0 ? setInterval(load, refreshMs) : undefined;
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [source, refreshMs]);

  return state;
}
