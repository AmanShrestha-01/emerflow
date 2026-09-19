import { AGENT } from "@/lib/emer/agents"

export function AgentAvatar({ id, size = 36, typing = false }: { id: string; size?: number; typing?: boolean }) {
  const a = AGENT[id]
  if (!a) {
    return (
      <span className="grid shrink-0 place-items-center rounded-xl bg-mist text-[11px] font-bold text-jade-deep" style={{ width: size, height: size }}>
        RL
      </span>
    )
  }
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {typing && <span aria-hidden className="ai-ring animate-spin-ring absolute -inset-[3px] rounded-[14px]" />}
      <span
        className="relative grid h-full w-full place-items-center rounded-xl font-semibold text-white"
        style={{ background: a.to, fontSize: size * 0.34 }}
      >
        {a.ini}
      </span>
    </span>
  )
}
