"use client";

import { useState, type ReactNode } from "react";
import { isFinished, type SwarmRun } from "../use-swarm-run";

/**
 * Casualty count, Reset and the crisis button. Optional: a host page can call
 * `swarm.start()` from its own button instead. Pass `casualtyOptions={[]}` to hide the picker.
 */
export function SwarmControls({
  swarm,
  casualtyOptions = [15, 25, 40, 60],
  defaultCasualties = 25,
}: {
  swarm: SwarmRun;
  casualtyOptions?: number[];
  defaultCasualties?: number;
}) {
  const [casualties, setCasualties] = useState(defaultCasualties);
  const running = swarm.phase === "running";
  const doneCount = swarm.workflow.steps.filter((s) => isFinished(swarm.statuses[s.id])).length;
  const seed = swarm.meta?.seed;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs tabular-nums text-slate-500">
        {seed !== undefined && <>Seed {seed} · </>}
        {doneCount} / {swarm.workflow.steps.length} steps
      </span>
      {casualtyOptions.length > 0 && (
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          Casualties
          <select
            value={casualties}
            onChange={(e) => setCasualties(Number(e.target.value))}
            disabled={running}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-800"
          >
            {casualtyOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={swarm.reset}
        className="rounded border border-slate-300 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => swarm.start(casualtyOptions.length ? { casualties } : {})}
        disabled={running}
        className="rounded bg-red-700 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-60"
      >
        {running ? "Running…" : swarm.phase === "idle" ? "Trigger Mass Casualty Event" : "Run new scenario"}
      </button>
    </div>
  );
}

/** Shows the source's error message, plus an optional hint on how to fix it. */
export function SwarmError({ swarm, hint }: { swarm: SwarmRun; hint?: ReactNode }) {
  if (!swarm.error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-900">
      {swarm.error} {hint}
    </div>
  );
}
