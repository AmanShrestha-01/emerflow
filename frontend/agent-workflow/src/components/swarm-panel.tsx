"use client";

import type { ReactNode } from "react";
import { useSwarmRun, type SwarmRun, type UseSwarmRunOptions } from "../use-swarm-run";
import { DecisionLog } from "./decision-log";
import { HospitalSnapshot } from "./hospital-snapshot";
import { StepDetails } from "./step-details";
import { SwarmControls, SwarmError } from "./swarm-controls";
import { WorkflowCanvas } from "./workflow-canvas";

export type SwarmPanelProps = UseSwarmRunOptions & {
  /** Pass a run from `useSwarmRun()` to control it from the host page. Otherwise the panel owns one. */
  swarm?: SwarmRun;
  title?: string;
  /** Hide the built-in controls when the host page has its own trigger button. */
  showControls?: boolean;
  casualtyOptions?: number[];
  /** Shown next to connection errors, e.g. how to start the server. */
  errorHint?: ReactNode;
  className?: string;
};

/**
 * Everything in one block. Its layout follows the width of the slot it sits in
 * (container queries), not the screen, so it works full-page or in a section.
 */
export function SwarmPanel({
  swarm: external,
  title = "Agent Workflow",
  showControls = true,
  casualtyOptions,
  errorHint,
  className = "",
  ...options
}: SwarmPanelProps) {
  const own = useSwarmRun(options);
  const swarm = external ?? own;

  return (
    <div className={`@container flex flex-col gap-4 ${className}`}>
      {(title || showControls) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>}
          {showControls && <SwarmControls swarm={swarm} casualtyOptions={casualtyOptions} />}
        </div>
      )}
      <SwarmError swarm={swarm} hint={errorHint} />
      <WorkflowCanvas swarm={swarm} className="h-[380px] @4xl:h-[460px]" />
      <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-[320px_1fr_400px]">
        <HospitalSnapshot swarm={swarm} className="@3xl:self-start" />
        <DecisionLog swarm={swarm} className="@3xl:self-start" />
        <StepDetails swarm={swarm} className="@3xl:col-span-2 @6xl:col-span-1 @6xl:self-start" />
      </div>
    </div>
  );
}
