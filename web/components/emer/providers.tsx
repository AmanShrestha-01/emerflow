"use client"

import type { ReactNode } from "react"
import { HospitalProvider } from "@/lib/emer/hospital"
import { Toasts } from "./toasts"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <HospitalProvider>
      {children}
      <Toasts />
    </HospitalProvider>
  )
}
