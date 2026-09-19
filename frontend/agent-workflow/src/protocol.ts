// The event format the UI understands (protocol version 1).
// Python mirror: agent-workflow/server/protocol.py. Keep the two in sync.
//
// A run is a sequence of events:  meta → workflow → (step | snapshot)* → end
// Any data source can drive the UI as long as it produces these (see sources.ts).

export const PROTOCOL_VERSION = 1;

/** Built-in kinds have their own badge color. Any other string works and gets a neutral badge. */
export type StepKind = "trigger" | "code" | "ai" | "human" | (string & {});
export type StepStatus = "idle" | "running" | "done" | "flagged";

export type StepDefinition = { id: string; kind: StepKind; title: string; role?: string };
export type EdgeDefinition = { source: string; target: string };
export type WorkflowDefinition = { steps: StepDefinition[]; edges: EdgeDefinition[] };

export type StepResult = {
  summary: string;
  input: string[];
  output: string[];
  reasoning: string | null;
};

export type UnitSnapshot = { code: string; name: string; occupied: number; capacity: number; waiting: number };
export type Snapshot = { label: string; clock: string; units: UnitSnapshot[] };

export type MetaEvent = { type: "meta"; protocol: number; seed?: number; [key: string]: unknown };

export type SwarmEvent =
  /** First event. Anything extra (seed, casualties…) is kept in `swarm.meta`. */
  | MetaEvent
  /** The graph to draw. Optional: without it the UI keeps the graph it already has. */
  | ({ type: "workflow" } & WorkflowDefinition)
  /** A step started (`running`) or finished (`done`, or `flagged` when a person must check it). */
  | ({ type: "step"; id: string; status: Exclude<StepStatus, "idle"> } & Partial<StepResult>)
  /** Bed counts per unit at a point in time. */
  | ({ type: "snapshot" } & Snapshot)
  /** Something went wrong; the run stops. */
  | { type: "error"; message: string }
  /** Last event. */
  | { type: "end" };
