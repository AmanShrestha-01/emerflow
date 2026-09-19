import type { Hospital, LatLon, SortBy, Status } from "./types";

export const STATUS: Record<Status, { label: string; short: string; color: string; text: string; dot: string }> = {
  open: { label: "Accepting patients", short: "Open", color: "#10b981", text: "text-emerald-700", dot: "bg-emerald-500" },
  busy: { label: "Busy", short: "Busy", color: "#f59e0b", text: "text-amber-700", dot: "bg-amber-500" },
  critical: { label: "At capacity", short: "Full", color: "#ef4444", text: "text-red-600", dot: "bg-red-500" },
};

export const STATUSES: Status[] = ["open", "busy", "critical"];

/** Great-circle distance in miles. */
export function miles([aLat, aLon]: LatLon, [bLat, bLon]: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/** Rough city driving time: ~22 mph plus a few minutes to get going. */
export function driveMinutes(distanceMiles: number) {
  return Math.round(4 + distanceMiles * 2.7);
}

export type RankedHospital = Hospital & { distance: number; drive: number; total: number };

/** Hospitals with distance, drive time and drive + ER wait from `from`, in the requested order. */
export function rankHospitals(hospitals: Hospital[], from: LatLon, sortBy: SortBy = "nearest"): RankedHospital[] {
  return hospitals
    .map((h) => {
      const distance = miles(from, [h.lat, h.lon]);
      const drive = driveMinutes(distance);
      return { ...h, distance, drive, total: drive + h.er_wait_min };
    })
    .sort((a, b) => (sortBy === "fastest" ? a.total - b.total : a.distance - b.distance));
}

export function formatWait(min: number) {
  if (min <= 15) return "< 15 min";
  if (min < 60) return `~${Math.round(min / 5) * 5} min`;
  const h = min / 60;
  return `~${h < 3 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)} h`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function directionsUrl(h: Pick<Hospital, "lat" | "lon">) {
  return `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
}

export function countByStatus(hospitals: Hospital[]): Record<Status, number> {
  const c: Record<Status, number> = { open: 0, busy: 0, critical: 0 };
  hospitals.forEach((h) => c[h.status]++);
  return c;
}
