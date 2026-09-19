"use client"

import { AnimatePresence, motion } from "motion/react"
import { CheckCircle2, TriangleAlert } from "lucide-react"
import { useHospital } from "@/lib/emer/hospital"

export function Toasts() {
  const { toasts } = useHospital()
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className={`glass-strong flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${t.bad ? "text-critical" : "text-ink"}`}
          >
            {t.bad ? <TriangleAlert className="size-4" /> : <CheckCircle2 className="size-4 text-jade" />}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
