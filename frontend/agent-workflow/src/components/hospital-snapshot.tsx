"use client";

import type { SwarmRun } from "../use-swarm-run";
import { Card } from "./card";

/** Simulated bed counts per unit: at the crisis, then one hour after the plan. */
export function HospitalSnapshot({ swarm, className = "" }: { swarm: SwarmRun; className?: string }) {
  const current = swarm.snapshots.at(-1);
  const before = swarm.snapshots.length > 1 ? swarm.snapshots[0] : null;

  return (
    <Card
      title="Simulated Hospital"
      className={className}
      aside={current && <span className="text-[11px] text-slate-500">{current.label}</span>}
    >
      {!current ? (
        <p className="px-4 py-6 text-center text-[13px] text-slate-500">Bed counts appear when the simulation reaches the crisis.</p>
      ) : (
        <ul className="space-y-3 px-4 py-3">
          {current.units.map((u) => {
            const pct = Math.round((u.occupied / u.capacity) * 100);
            const was = before?.units.find((b) => b.code === u.code);
            const tone = pct >= 95 ? "bg-red-600" : pct >= 85 ? "bg-amber-500" : "bg-emerald-600";
            return (
              <li key={u.code} className="text-[13px]">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-800">{u.name}</span>
                  <span className="tabular-nums text-slate-600">
                    {u.occupied}/{u.capacity}
                    {u.waiting > 0 && <span className="ml-1.5 font-semibold text-red-700">+{u.waiting} waiting</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-sm bg-slate-100">
                    <div className={`h-full rounded-sm transition-all duration-700 ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
                </div>
                {was && <p className="mt-0.5 text-[11px] text-slate-500">was {Math.round((was.occupied / was.capacity) * 100)}% at the crisis</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
