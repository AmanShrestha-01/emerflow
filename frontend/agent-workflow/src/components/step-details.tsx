"use client";

import type { ReactNode } from "react";
import { findStep, kindLabel } from "../workflow";
import type { SwarmRun } from "../use-swarm-run";

/** What the selected step received, what it decided, and why. */
export function StepDetails({ swarm, className = "" }: { swarm: SwarmRun; className?: string }) {
  const step = findStep(swarm.workflow, swarm.selectedId);
  const status = (step && swarm.statuses[step.id]) ?? "idle";
  const result = step ? swarm.results[step.id] : undefined;
  const pending = <p className="text-slate-400">{status === "running" ? "Working…" : "Not run yet"}</p>;

  return (
    <aside className={`min-w-0 rounded-md border border-slate-300/70 bg-white shadow-sm ${className}`}>
      {!step ? (
        <p className="p-6 text-center text-[13px] text-slate-500">Click a step to see what it saw and decided.</p>
      ) : (
        <>
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{kindLabel(step.kind)}</p>
            <h2 className="text-base font-semibold text-slate-900">{step.title}</h2>
            {step.role && <p className="mt-0.5 text-[12px] text-slate-600">{step.role}</p>}
          </div>
          <div className="space-y-4 px-4 py-4 text-[13px]">
            <Section title="Received">{result ? <List items={result.input} /> : pending}</Section>
            <Section title="Decided">{result ? <List items={result.output} /> : pending}</Section>
            {(step.kind === "ai" || result?.reasoning) && (
              <Section title="Why">
                {result?.reasoning ? (
                  <p className="rounded border-l-2 border-indigo-400 bg-indigo-50/60 px-3 py-2 leading-relaxed text-slate-700">
                    {result.reasoning}
                  </p>
                ) : (
                  pending
                )}
              </Section>
            )}
            {status === "flagged" && (
              <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900">
                A person must check this. The system never decides which record is right.
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-slate-800">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
          {item}
        </li>
      ))}
    </ul>
  );
}
