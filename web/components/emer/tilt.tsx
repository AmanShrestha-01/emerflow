"use client"

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react"
import type { ReactNode } from "react"

/** A card that tilts toward the pointer in 3D. Flat when the viewer prefers reduced motion. */
export function Tilt({ children, className = "", max = 10 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const rx = useSpring(useTransform(y, [0, 1], [max, -max]), { stiffness: 200, damping: 18 })
  const ry = useSpring(useTransform(x, [0, 1], [-max, max]), { stiffness: 200, damping: 18 })
  const glow = useTransform([x, y], ([gx, gy]: number[]) => `radial-gradient(360px circle at ${gx * 100}% ${gy * 100}%, rgb(255 255 255 / 0.55), transparent 60%)`)
  if (reduce) return <div className={className}>{children}</div>
  return (
    <div style={{ perspective: 900 }}>
      <motion.div
        className={`relative ${className}`}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          x.set((e.clientX - r.left) / r.width)
          y.set((e.clientY - r.top) / r.height)
        }}
        onPointerLeave={() => {
          x.set(0.5)
          y.set(0.5)
        }}
      >
        {children}
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glow }} />
      </motion.div>
    </div>
  )
}
