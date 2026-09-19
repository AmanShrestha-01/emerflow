"use client";

import { lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import type { Hospital, Incident, LatLon, Simulation, Status } from "../types";

// Leaflet touches `window` when imported, so the map is loaded only in the browser.
const LeafletMap = lazy(() => import("./leaflet-map"));

export interface CapacityMapProps {
  hospitals: Hospital[];
  incidents?: Incident[];
  /** The viewer's location (blue dot) and route start. */
  location?: LatLon | null;
  locationLabel?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Ring and open tooltip on this hospital (e.g. its list row is hovered); pin hovers are reported back. */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  /** Which statuses to show. Omit to show all. */
  visible?: Record<Status, boolean>;
  /** Dashed line from `location` to a recommended hospital. */
  route?: { to: Hospital } | null;
  /** What-if mode: where the incident is, where casualties go, and click-to-place. */
  simulation?: {
    point: LatLon | null;
    assignments?: Simulation["assignments"];
    placing: boolean;
    onPlace: (point: LatLon) => void;
  };
  className?: string;
  /** Overlays drawn on top of the map (legend, controls). */
  children?: ReactNode;
}

const subscribe = () => () => {};

/** Interactive map of hospitals colored by status. Fills its container; give it a height. */
export function CapacityMap({ className = "", children, ...props }: CapacityMapProps) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const placeholder = <div className="size-full animate-pulse bg-slate-100" />;
  return (
    <div className={`relative isolate overflow-hidden ${className}`}>
      {mounted && props.hospitals.length ? (
        <Suspense fallback={placeholder}>
          <LeafletMap {...props} />
        </Suspense>
      ) : (
        placeholder
      )}
      {children}
    </div>
  );
}
