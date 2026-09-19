// Public API of @hospital-swarm/agent-workflow. Anything not exported here is internal.

// State
export { useSwarmRun, isFinished } from "./use-swarm-run";
export type { SwarmRun, SwarmPhase, SwarmRunSummary, UseSwarmRunOptions, LogEntry } from "./use-swarm-run";

// Data sources
export { sseSource, replaySource, pushSource } from "./sources";
export type { SwarmSource, RunParams, Emit, EventMapper } from "./sources";

// Components
export { SwarmPanel } from "./components/swarm-panel";
export type { SwarmPanelProps } from "./components/swarm-panel";
export { WorkflowCanvas } from "./components/workflow-canvas";
export { StepDetails } from "./components/step-details";
export { DecisionLog } from "./components/decision-log";
export { HospitalSnapshot } from "./components/hospital-snapshot";
export { SwarmControls, SwarmError } from "./components/swarm-controls";

// Graph and recorded data
export { hospitalSwarmWorkflow, sampleRun, layoutWorkflow, kindLabel, findStep } from "./workflow";
export type { RecordedRun, Orientation } from "./workflow";

// Protocol
export { PROTOCOL_VERSION } from "./protocol";
export type {
  SwarmEvent,
  MetaEvent,
  WorkflowDefinition,
  StepDefinition,
  EdgeDefinition,
  StepKind,
  StepStatus,
  StepResult,
  Snapshot,
  UnitSnapshot,
} from "./protocol";
