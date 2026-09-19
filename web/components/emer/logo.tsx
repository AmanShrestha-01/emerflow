import { Bebas_Neue } from "next/font/google"

// The wordmark's condensed caps are part of the logo artwork; the rest of the site stays Inter.
const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], display: "swap" })

/** The pulse mark: two heartbeat traces that cross into a diamond. */
export function PulseMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 108 96" fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      <path d="M2 48 L20 46 Q23 45.5 24.5 42 L29 30 Q31.5 25 34 30 L38 47 L52 90 Q54 94 56 90 L65.5 49.5 L69 41 Q72 36 74.5 42 L77.5 50 Q79 53.5 81 51 L83.5 48 L106 48" />
      <path d="M2 48 L20 50 Q23 50.5 24.5 54 L27.5 66 Q30 71 32.5 66 L38 47 L51 4 Q53.5 -0.5 56 4 L65.5 49.5" />
    </svg>
  )
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-ink ${className}`}>
      <PulseMark className="h-8 w-auto" />
      <span className={`${bebas.className} text-[30px] leading-none tracking-[0.02em] translate-y-[1px]`}>EmerFlow</span>
    </span>
  )
}
