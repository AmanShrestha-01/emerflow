"use client";

import { useEffect, useState } from "react";
import type { LatLon, WeatherAlert } from "./types";

interface NwsFeature {
  id: string;
  properties: { event: string; headline: string | null; severity: string; areaDesc: string; effective: string | null };
}

/**
 * Active National Weather Service alerts for a point (US only, no key). The location is rounded
 * to ~1 km before it leaves the browser. `null` while loading; `available: false` if NWS failed.
 */
export function useWeatherAlerts(location: LatLon | null): { alerts: WeatherAlert[]; available: boolean } | null {
  const [result, setResult] = useState<{ key: string; alerts: WeatherAlert[]; available: boolean } | null>(null);
  const key = location ? `${location[0].toFixed(2)},${location[1].toFixed(2)}` : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`https://api.weather.gov/alerts/active?point=${key}`, { headers: { Accept: "application/geo+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { features: NwsFeature[] }) => {
        if (cancelled) return;
        const alerts = d.features.map(({ id, properties: p }) => ({
          id,
          event: p.event,
          headline: p.headline ?? p.event,
          severity: p.severity,
          area: p.areaDesc,
          effective: p.effective,
        }));
        setResult({ key, alerts, available: true });
      })
      .catch(() => !cancelled && setResult({ key, alerts: [], available: false }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return result && result.key === key ? { alerts: result.alerts, available: result.available } : null;
}
