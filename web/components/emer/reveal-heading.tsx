"use client"

import { useRef } from "react"
import { useInView } from "motion/react"
import { TextReveal } from "@/components/ui/text-reveal"

/** A heading that blurs in word by word when it scrolls into view. Keeps its space before then, so nothing jumps. */
export function RevealHeading({ children, className = "", as = "h2" }: { children: string; className?: string; as?: "h1" | "h2" | "h3" }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const Tag = as
  return (
    <div ref={ref}>
      {inView ? (
        <TextReveal as={as} per="word" preset="fade-in-blur" speedReveal={1.2} className={className}>
          {children}
        </TextReveal>
      ) : (
        <Tag className={`${className} invisible`}>{children}</Tag>
      )}
    </div>
  )
}
