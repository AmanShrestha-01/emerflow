"use client"

import { useEffect, useMemo, useState } from "react"
import SphereImageGrid, { type ImageData } from "@/components/ui/img-sphere"
import { AGENTS, agentOrb } from "@/lib/emer/agents"

// The eleven agents as a 3D swarm: each appears several times so the sphere reads as many voices at once.
export function AgentSphere() {
  const [size, setSize] = useState(520)
  useEffect(() => {
    const fit = () => setSize(Math.max(300, Math.min(560, window.innerWidth - 48)))
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [])
  const images: ImageData[] = useMemo(() => {
    const out: ImageData[] = []
    for (let i = 0; i < 36; i++) {
      const a = AGENTS[i % AGENTS.length]
      out.push({
        id: `${a.id}-${i}`,
        src: agentOrb(a),
        alt: `${a.name} AI (${a.persona})`,
        title: `${a.persona} · ${a.name} AI`,
        description: `${a.role}. Pushes for: ${a.pushesFor.toLowerCase()}.`,
      })
    }
    return out
  }, [])
  return (
    <div className="relative grid place-items-center">
      <div aria-hidden className="absolute rounded-full border border-[#e6e0d2]" style={{ width: size * 0.78, height: size * 0.78 }} />
      <SphereImageGrid
        images={images}
        containerSize={size}
        sphereRadius={size * 0.36}
        dragSensitivity={0.8}
        momentumDecay={0.96}
        maxRotationSpeed={6}
        baseImageScale={0.15}
        hoverScale={1.3}
        perspective={1000}
        autoRotate
        autoRotateSpeed={0.2}
      />
    </div>
  )
}
