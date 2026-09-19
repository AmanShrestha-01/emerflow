"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
// The live feed and REST helpers are shared with the classic board (copied from frontend/src).
import { useEvents } from "./useEvents.js"
import { api, DEMO_KEY } from "./api.js"

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Unit = { unit: string; beds: number; occupied: number; reserved: number; percent: number; nurses?: number; occupants: string[]; reserved_for?: string[] }
export type Patient = {
  pid: string; name?: string; age?: number; complaint: string; severity: number; state: string; unit?: string | null
  waited?: number; eta?: number | null; need?: string; note?: string; note_by?: string; heading_to?: string | null
  bp?: string; hr?: number; spo2?: number
}
export type Approval = { approval_id: string; action: string; sentence?: string; detail?: string; reason?: string }
export type HState = {
  clock: number; level: number; level_name?: string; paused: boolean; speed: number; mode?: string; clock_start?: number
  units: Unit[]; patients: Patient[]; approvals: Approval[]; holds: any[]; metrics: Record<string, number>
  busy_until?: number | null; bus_crash_at?: number | null; diversion?: boolean
}
export type FeedEvent = { id?: number; type: string; clock?: number; cycle_id?: string | null; round?: string | null; data?: any }
export type Message = { id: number; from: string; to?: string[]; kind?: string; persona?: string; text: string; pids?: string[]; cycle_id?: string | null; how?: string }
export type Ev = {
  state: HState | null; feed: FeedEvent[]; messages: Message[]; typing: Record<string, { cycle_id?: string }>
  source: "live" | "mock" | null; connected: boolean; error: string | null
}

type Toast = { id: number; text: string; bad?: boolean }
type Ctx = {
  st: HState | null
  ev: Ev
  names: Record<string, string>
  run: <T>(fn: () => Promise<T>, ok?: string | ((r: T) => string)) => Promise<T>
  control: (action: string, extra?: Record<string, unknown>) => Promise<unknown>
  surge: (kind: "bus" | "busy") => Promise<unknown>
  reset: () => Promise<unknown>
  toasts: Toast[]
}

const HospitalCtx = createContext<Ctx | null>(null)

export function HospitalProvider({ children }: { children: ReactNode }) {
  const ev = useEvents() as unknown as Ev
  const st = ev.state
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const toast = useCallback((text: string, bad = false) => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, text, bad }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)) => {
    try {
      const r = await fn()
      if (ok) toast(typeof ok === "function" ? ok(r) : ok)
      return r
    } catch (e) {
      toast((e as Error).message, true)
      throw e
    }
  }, [toast])

  const names = useMemo(
    () => Object.fromEntries((st?.patients || []).filter((p) => p.name).map((p) => [p.pid, p.name as string])),
    [st?.patients],
  )

  const value: Ctx = {
    st, ev, names, run, toasts,
    control: (action, extra = {}) => (api as any).control(action, extra),
    surge: (kind) => (api as any).surge(kind),
    reset: () => (api as any).control("reset", { key: DEMO_KEY }),
  }
  return <HospitalCtx.Provider value={value}>{children}</HospitalCtx.Provider>
}

export function useHospital() {
  const c = useContext(HospitalCtx)
  if (!c) throw new Error("useHospital needs <HospitalProvider>")
  return c
}

export { api }
