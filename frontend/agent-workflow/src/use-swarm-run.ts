"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetaEvent, Snapshot, StepResult, StepStatus, SwarmEvent, WorkflowDefinition } from "./protocol";
import { sseSource, type RunParams, type SwarmSource } from "./sources";
import { hospitalSwarmWorkflow } from "./workflow";

export type SwarmPhase = "idle" | "running" | "complete" | "error";
export type LogEntry = { t: number; stepId: string; text: string; flagged: boolean };

export type SwarmRunSummary = {
  meta: MetaEvent | null;
  workflow: WorkflowDefinition;
  results: Record<string, StepResult>;
  snapshots: Snapshot[];
};

export type UseSwarmRunOptions = {
  /** Where events come from. Default: the simulation server at http://localhost:8000/run. */
  source?: SwarmSource;
  /** Graph drawn before a run starts, until the source sends its own `workflow` event. */
  workflow?: WorkflowDefinition;
  /** Called for every event, e.g. to update other parts of the host page. */
  onEvent?: (event: SwarmEvent) => void;
  /** Called once when a run ends successfully. */
  onComplete?: (summary: SwarmRunSummary) => void;
};

export type SwarmRun = {
  phase: SwarmPhase;
  meta: MetaEvent | null;
  workflow: WorkflowDefinition;
  statuses: Record<string, StepStatus>;
  results: Record<string, StepResult>;
  snapshots: Snapshot[];
  log: LogEntry[];
  error: string | null;
  selectedId: string | null;
  /** Start a new run. `params` are passed to the source (e.g. `{ casualties: 25 }`). */
  start: (params?: RunParams) => void;
  /** Stop and clear. */
  reset: () => void;
  /** Choose which step `StepDetails` shows. */
  select: (stepId: string | null) => void;
};

const defaultSource = sseSource();
const idle = (w: WorkflowDefinition) => Object.fromEntries(w.steps.map((s) => [s.id, "idle"])) as Record<string, StepStatus>;
export const isFinished = (s: StepStatus | undefined) => s === "done" || s === "flagged";

/** Holds the state of one run, fed by a data source. Every component takes its return value. */
export function useSwarmRun({ source, workflow: initialWorkflow = hospitalSwarmWorkflow, onEvent, onComplete }: UseSwarmRunOptions = {}): SwarmRun {
  const [phase, setPhase] = useState<SwarmPhase>("idle");
  const [meta, setMeta] = useState<MetaEvent | null>(null);
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [statuses, setStatuses] = useState(() => idle(initialWorkflow));
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Refs keep `start` stable while the host passes new callbacks or sources.
  const options = useRef({ source, onEvent, onComplete, initialWorkflow });
  useEffect(() => {
    options.current = { source, onEvent, onComplete, initialWorkflow };
  }, [source, onEvent, onComplete, initialWorkflow]);
  const stopSource = useRef<(() => void) | null>(null);
  const runId = useRef(0);
  const latest = useRef<SwarmRunSummary>({ meta: null, workflow: initialWorkflow, results: {}, snapshots: [] });

  const stop = useCallback(() => {
    stopSource.current?.();
    stopSource.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    runId.current++;
    const w = options.current.initialWorkflow;
    latest.current = { meta: null, workflow: w, results: {}, snapshots: [] };
    setPhase("idle");
    setMeta(null);
    setWorkflow(w);
    setStatuses(idle(w));
    setResults({});
    setSnapshots([]);
    setLog([]);
    setError(null);
  }, [stop]);

  const start = useCallback(
    (params: RunParams = {}) => {
      reset();
      const id = runId.current;
      const startedAt = performance.now();
      setPhase("running");

      const handle = (event: SwarmEvent) => {
        if (id !== runId.current) return; // event from an older run
        options.current.onEvent?.(event);
        switch (event.type) {
          case "meta":
            latest.current.meta = event;
            setMeta(event);
            break;
          case "workflow": {
            const w = { steps: event.steps, edges: event.edges };
            latest.current.workflow = w;
            setWorkflow(w);
            setStatuses(idle(w));
            break;
          }
          case "snapshot":
            latest.current.snapshots = [...latest.current.snapshots, event];
            setSnapshots(latest.current.snapshots);
            break;
          case "step":
            setStatuses((prev) => ({ ...prev, [event.id]: event.status }));
            setSelectedId(event.id);
            if (isFinished(event.status)) {
              const result: StepResult = {
                summary: event.summary ?? "",
                input: event.input ?? [],
                output: event.output ?? [],
                reasoning: event.reasoning ?? null,
              };
              latest.current.results = { ...latest.current.results, [event.id]: result };
              setResults(latest.current.results);
              setLog((prev) => [
                { t: performance.now() - startedAt, stepId: event.id, text: result.summary, flagged: event.status === "flagged" },
                ...prev,
              ]);
            }
            break;
          case "error":
            stop();
            setError(event.message);
            setPhase("error");
            break;
          case "end":
            stop();
            setPhase("complete");
            options.current.onComplete?.(latest.current);
            break;
        }
      };

      stopSource.current = (options.current.source ?? defaultSource).start(params, handle);
    },
    [reset, stop],
  );

  return useMemo(
    () => ({ phase, meta, workflow, statuses, results, snapshots, log, error, selectedId, start, reset, select: setSelectedId }),
    [phase, meta, workflow, statuses, results, snapshots, log, error, selectedId, start, reset],
  );
}
