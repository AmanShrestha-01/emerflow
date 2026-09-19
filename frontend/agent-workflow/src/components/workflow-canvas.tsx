"use client";

import { useMemo } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { isFinished, type SwarmRun } from "../use-swarm-run";
import { layoutWorkflow, type Orientation } from "../workflow";
import { AgentNode, type AgentNodeType } from "./agent-node";

const nodeTypes = { agent: AgentNode };

/**
 * The step-by-step flowchart, laid out automatically from `swarm.workflow`.
 * It fills its container, so give it a height via `className`.
 * Use `layout="vertical"` in tall, narrow slots such as a sidebar.
 */
export function WorkflowCanvas({
  swarm,
  className = "h-[440px]",
  layout = "horizontal",
}: {
  swarm: SwarmRun;
  className?: string;
  layout?: Orientation;
}) {
  const { workflow, statuses, results, selectedId, select } = swarm;
  const vertical = layout === "vertical";
  const positions = useMemo(() => layoutWorkflow(workflow, layout), [workflow, layout]);

  const nodes: AgentNodeType[] = useMemo(
    () =>
      workflow.steps.map((step) => ({
        id: step.id,
        type: "agent",
        position: positions[step.id],
        data: { step, status: statuses[step.id] ?? "idle", summary: results[step.id]?.summary, selected: step.id === selectedId, vertical },
      })),
    [workflow, positions, statuses, results, selectedId, vertical],
  );

  const edges: Edge[] = useMemo(
    () =>
      workflow.edges.map(({ source, target }) => {
        const from = statuses[source];
        const to = statuses[target];
        const active = isFinished(from) && to === "running";
        const complete = isFinished(from) && isFinished(to);
        const color = active ? "#3b82f6" : complete ? (to === "flagged" ? "#f59e0b" : "#10b981") : "#cbd5e1";
        return {
          id: `${source}-${target}`,
          source,
          target,
          animated: active,
          style: { stroke: color, strokeWidth: active || complete ? 2 : 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        };
      }),
    [workflow, statuses],
  );

  // Re-fit when the graph or orientation changes.
  const graphKey = `${layout}:${workflow.steps.map((s) => s.id).join(",")}`;

  return (
    <section className={`overflow-hidden rounded-md border border-slate-300/70 bg-white shadow-sm ${className}`}>
      <ReactFlow
        key={graphKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => select(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
