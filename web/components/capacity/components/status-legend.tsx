"use client";

import { STATUS, STATUSES } from "../geo";
import type { Status } from "../types";

/** Status key with counts. Each entry is a toggle that shows or hides that status on the map. */
export function StatusLegend({
  counts,
  visible,
  onToggle,
  className = "",
}: {
  counts: Record<Status, number>;
  visible: Record<Status, boolean>;
  onToggle: (status: Status) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-0.5 rounded-lg bg-white/95 p-1 text-xs shadow-sm ring-1 ring-slate-900/5 backdrop-blur ${className}`}>
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={visible[s]}
          title={`${visible[s] ? "Hide" : "Show"} hospitals that are ${STATUS[s].label.toLowerCase()}`}
          onClick={() => onToggle(s)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-slate-100 ${visible[s] ? "text-slate-700" : "text-slate-400"}`}
        >
          <span
            className="size-2 rounded-full transition"
            style={visible[s] ? { background: STATUS[s].color } : { boxShadow: `inset 0 0 0 1.5px ${STATUS[s].color}` }}
          />
          {STATUS[s].short}
          <span className={`font-semibold tabular-nums ${visible[s] ? "text-slate-900" : ""}`}>{counts[s]}</span>
        </button>
      ))}
    </div>
  );
}
