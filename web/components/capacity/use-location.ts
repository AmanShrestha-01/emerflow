"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatLon } from "./types";

export type LocationState =
  | { state: "idle" | "asking" | "denied" | "unsupported"; coords: null }
  | { state: "granted"; coords: LatLon };

/** Browser location. Asks only when `locate()` is called, unless permission was already granted. */
export function useLocation(): LocationState & { locate: () => void } {
  const [loc, setLoc] = useState<LocationState>({ state: "idle", coords: null });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return setLoc({ state: "unsupported", coords: null });
    setLoc({ state: "asking", coords: null });
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ state: "granted", coords: [p.coords.latitude, p.coords.longitude] }),
      () => setLoc({ state: "denied", coords: null }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => p.state === "granted" && locate())
      .catch(() => {});
  }, [locate]);

  return { ...loc, locate };
}
