import { useMemo, useRef } from "react"
import type { Patient, Unit } from "./hospital"
import { UNIT_NAME } from "./agents"

export const GROUPS = ["RESUS", "ER", "ICU", "STEPDOWN", "WARD", "OR", "PACU"]
const ONLY_IF_USED = ["HALLWAY", "LOUNGE"]

export type Tile = { num: number; pid?: string; patient?: Patient; kind: "empty" | "occ" | "booked"; over: boolean }
export type BedGroup = { id: string; name: string; beds: number; free: number; tiles: Tile[] }

/** Every bed as a tile. A patient keeps the same bed number while they stay in that unit. */
export function useBedGroups(units: Unit[], byPid: Record<string, Patient>): BedGroup[] {
  const slotsRef = useRef<Record<string, (string | null)[]>>({})
  return useMemo(() => {
    const byUnit = Object.fromEntries(units.map((u) => [u.unit, u]))
    const order = [...GROUPS, ...ONLY_IF_USED.filter((id) => (byUnit[id]?.occupied || 0) + (byUnit[id]?.reserved || 0) > 0)]
    const out: BedGroup[] = []
    for (const id of order) {
      const u = byUnit[id]
      if (!u) continue
      const reserved = u.reserved_for || []
      const keys = [...(u.occupants || []), ...reserved]
      const present = new Set(keys)
      const slots = (slotsRef.current[id] || []).map((k) => (k && present.has(k) ? k : null))
      const placed = new Set(slots.filter(Boolean))
      for (const k of keys) {
        if (placed.has(k)) continue
        let i = slots.indexOf(null)
        if (i < 0 || i >= Math.max(u.beds, slots.length)) i = slots.length
        slots[i] = k
        placed.add(k)
      }
      while (slots.length > u.beds && slots[slots.length - 1] == null) slots.pop()
      slotsRef.current[id] = slots
      // Occupied beds the API doesn't name fill the highest empty beds.
      let anon = Math.max(0, (u.occupied || 0) - (u.occupants || []).length)
      const total = Math.max(u.beds, slots.length)
      const anonSlots = new Set<number>()
      for (let i = Math.min(total, u.beds) - 1; i >= 0 && anon > 0; i--) {
        if (!slots[i]) {
          anonSlots.add(i)
          anon--
        }
      }
      const tiles: Tile[] = []
      for (let i = 0; i < total; i++) {
        const pid = slots[i] || undefined
        const over = i >= u.beds
        if (!pid) tiles.push({ num: i + 1, kind: anonSlots.has(i) ? "occ" : "empty", over })
        else tiles.push({ num: i + 1, pid, patient: byPid[pid], kind: reserved.includes(pid) ? "booked" : "occ", over })
      }
      out.push({ id, name: UNIT_NAME[id] || id, beds: u.beds, free: Math.max(0, u.beds - u.occupied - u.reserved), tiles })
    }
    return out
  }, [units, byPid])
}

export const SEVERITY = {
  1: { label: "Critical", dot: "bg-critical", ring: "ring-critical/40", text: "text-critical", hex: "#d9442f", soft: "#fde7e2" },
  2: { label: "Serious", dot: "bg-[#ef7d3c]", ring: "ring-[#ef7d3c]/40", text: "text-[#c75a1c]", hex: "#ef7d3c", soft: "#fdeadb" },
  3: { label: "Urgent", dot: "bg-human", ring: "ring-human/40", text: "text-human", hex: "#d99a1f", soft: "#fdf1d6" },
  4: { label: "Stable", dot: "bg-jade", ring: "ring-jade/30", text: "text-jade-deep", hex: "#1f8a70", soft: "#e2f3ec" },
  5: { label: "Minor", dot: "bg-[#5aa6d6]", ring: "ring-[#5aa6d6]/30", text: "text-[#2f7bab]", hex: "#4a98cc", soft: "#e3f0f9" },
} as Record<number, { label: string; dot: string; ring: string; text: string; hex: string; soft: string }>
