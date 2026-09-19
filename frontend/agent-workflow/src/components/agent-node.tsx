import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepDefinition, StepStatus } from "../protocol";
import { kindLabel } from "../workflow";

export type AgentNodeData = { step: StepDefinition; status: StepStatus; summary?: string; selected: boolean; vertical?: boolean };
export type AgentNodeType = Node<AgentNodeData, "agent">;

const kindStyle: Record<string, string> = {
  trigger: "bg-red-50 text-red-800 ring-red-600/20",
  code: "bg-slate-100 text-slate-700 ring-slate-500/20",
  ai: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  human: "bg-amber-50 text-amber-900 ring-amber-600/25",
};

const statusStyle: Record<StepStatus, { border: string; dot: string; label: string }> = {
  idle: { border: "border-slate-300", dot: "bg-slate-300", label: "Waiting" },
  running: { border: "border-blue-500 ring-4 ring-blue-500/15", dot: "bg-blue-500 animate-pulse", label: "Running" },
  done: { border: "border-emerald-500", dot: "bg-emerald-600", label: "Done" },
  flagged: { border: "border-amber-500 ring-4 ring-amber-500/15", dot: "bg-amber-500", label: "Needs review" },
};

export function AgentNode({ data }: NodeProps<AgentNodeType>) {
  const { step, status, summary, selected, vertical } = data;
  const s = statusStyle[status];

  return (
    <div
      className={`w-[210px] rounded-md border-2 bg-white shadow-sm transition-all duration-300 ${s.border} ${
        selected ? "outline-2 outline-offset-2 outline-slate-900" : ""
      } ${status === "idle" ? "opacity-70" : ""}`}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-400" />
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${kindStyle[step.kind] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"}`}>
          {kindLabel(step.kind)}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[13px] font-semibold text-slate-900">{step.title}</p>
        <p className="mt-0.5 min-h-[32px] text-[11px] leading-snug text-slate-600">
          {summary ?? (status === "running" ? "Working…" : step.role ?? "")}
        </p>
      </div>
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-400" />
    </div>
  );
}
