"use client";

import { findStep } from "../workflow";
import type { SwarmRun } from "../use-swarm-run";
import { Card } from "./card";

/** Every finished step, newest first. Clicking a line selects that step. */
export function DecisionLog({ swarm, className = "" }: { swarm: SwarmRun; className?: string }) {
  return (
    <Card title="Decision Log" className={className}>
      {swarm.log.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-slate-500">Start a run to see each decision.</p>
      ) : (
        <ol className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {swarm.log.map((entry) => (
            <li key={entry.stepId}>
              <button
                type="button"
                onClick={() => swarm.select(entry.stepId)}
                className="grid w-full grid-cols-[48px_128px_1fr] items-baseline gap-3 px-4 py-2 text-left text-[13px] hover:bg-slate-50"
              >
                <span className="font-mono text-[11px] tabular-nums text-slate-500">+{(entry.t / 1000).toFixed(1)}s</span>
                <span className="truncate font-semibold text-slate-800">{findStep(swarm.workflow, entry.stepId)?.title ?? entry.stepId}</span>
                <span className={entry.flagged ? "font-medium text-amber-800" : "text-slate-600"}>{entry.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
