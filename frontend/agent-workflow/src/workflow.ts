import sample from "./fixtures/sample-run.json";
import type { StepDefinition, StepKind, SwarmEvent, WorkflowDefinition } from "./protocol";

/** A run saved as events with their start times in seconds. See server/record_fixture.py. */
export type RecordedRun = { seed?: number; casualties?: number; events: { at: number; event: SwarmEvent }[] };

/** One real run from the simulation, bundled so the UI works with no server. */
export const sampleRun = sample as unknown as RecordedRun;

/** The Hospital Swarm graph, taken from the recorded run. Drawn before any run starts. */
export const hospitalSwarmWorkflow: WorkflowDefinition = (() => {
  const found = sampleRun.events.find((e) => e.event.type === "workflow")?.event;
  if (!found || found.type !== "workflow") throw new Error("sample-run.json has no workflow event");
  return { steps: found.steps, edges: found.edges };
})();

const kindLabels: Record<string, string> = { trigger: "Event", code: "Code", ai: "AI agent", human: "Human" };

export function kindLabel(kind: StepKind): string {
  return kindLabels[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function findStep(workflow: WorkflowDefinition, id: string | null): StepDefinition | undefined {
  return id ? workflow.steps.find((s) => s.id === id) : undefined;
}

export type Orientation = "horizontal" | "vertical";

/**
 * Places steps automatically: each step goes one column after the furthest step
 * that points to it; steps in the same column are stacked and centered.
 * So any graph the data source sends is laid out without hand-set positions.
 */
export function layoutWorkflow(workflow: WorkflowDefinition, orientation: Orientation = "horizontal") {
  const rank: Record<string, number> = Object.fromEntries(workflow.steps.map((s) => [s.id, 0]));
  // Longest-path ranking; bounded so a cycle in the data can't hang the page.
  for (let i = 0; i < workflow.steps.length; i++) {
    let changed = false;
    for (const { source, target } of workflow.edges) {
      if (source in rank && target in rank && rank[target] < rank[source] + 1) {
        rank[target] = rank[source] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns: string[][] = [];
  for (const step of workflow.steps) (columns[rank[step.id]] ??= []).push(step.id);

  const positions: Record<string, { x: number; y: number }> = {};
  columns.forEach((ids, col) =>
    ids.forEach((id, row) => {
      const offset = row - (ids.length - 1) / 2;
      positions[id] = orientation === "horizontal" ? { x: col * 250, y: offset * 150 } : { x: offset * 235, y: col * 140 };
    }),
  );
  return positions;
}
