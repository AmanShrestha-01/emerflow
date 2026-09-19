// REST helpers for the DeepChart portal routes in CONTRACT.md ("DeepChart portal").
// Same session as the rest of the site: the token rides in X-Session (lib/emer/session.ts).
import type { Session } from "./session"

export type Version = { source_name: string; recorded_date: string; value: string; status: string; resource_id: string }
export type Conflict = { fact: string; reason: string; versions: Version[] }
export type Fact = Conflict & { kind: "conflict" | "agree" | "gap"; missing_from: string[]; verified_by_human: boolean }
export type Row = {
  pid: string; name: string; age: number; complaint: string; severity: number; state: string; unit: string | null
  conflicts?: number; held?: boolean
}
export type Hold = { hold_id: string; pid: string; to_unit: string; because: string[]; conflicts: Conflict[] }
export type Candidate = {
  record_ref: string; hospital: string; source_name: string; recorded_date: string; name: string; dob: string; sex: string
  match: "strong" | "possible"; differs: string[]; linked: boolean; confirmed: boolean; facts: number
}
export type Chart = {
  patient: Row; hospital: string
  identity: { name: string; dob: string; sex: string; phone4: string; insurance_id: string; address: string }
  sources: { source_name: string; recorded_date: string; hospital: string }[]
  facts: Fact[]; hold: Hold | null; orders: { order_id: string; text: string; status: string }[]; notice: string
}
export type Transfer = { transfer_id: string; pid: string; name: string; from_hospital: string; at: string; conflicts: number }
export type LogEntry = { at: string; hospital: string; role: string; name?: string; action: string; reason: string | null }
export type OrderResult = { order_id: string; status: "saved" | "needs_ack"; warnings: Conflict[] }
export type PatientView = {
  first_name: string; status_line: string
  records: { hospital: string; kind: string; recorded_date: string }[]
  access_log: { at: string; hospital: string; role: string; name?: string; action: string; reason: string | null }[]
}
export type Resolved = { ok: boolean; detail: string; outcome: "proceed" | "cancel"; to_unit: string }

export class PortalError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function request<T>(method: string, path: string, s: Session | null, opts: { body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const qs = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v))}` : ""
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  if (s?.token) headers["X-Session"] = s.token
  const r = await fetch(path + qs, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = (await r.json()).detail || msg
    } catch {}
    throw new PortalError(msg, r.status)
  }
  return r.json()
}

const enc = encodeURIComponent
export const portal = {
  patients: (s: Session) => request<Row[]>("GET", "/api/portal/patients", s),
  inbox: (s: Session) => request<Transfer[]>("GET", "/api/inbox", s),
  lookup: (s: Session, pid: string, reason: string) =>
    request<{ candidates: Candidate[] }>("GET", "/api/lookup", s, { query: { pid, reason } }),
  confirm: (s: Session, pid: string, record_ref: string, same_person: boolean, reason: string) =>
    request<{ ok: boolean; linked: boolean }>("POST", "/api/lookup/confirm", s, { body: { pid, record_ref, same_person, reason } }),
  chart: (s: Session, pid: string, reason: string) => request<Chart>("GET", `/api/chart/${enc(pid)}`, s, { query: { reason } }),
  resolve: (s: Session, pid: string, hold_id: string, outcome: "proceed" | "cancel", reason: string) =>
    request<Resolved>("POST", `/api/chart/${enc(pid)}/resolve`, s, { body: { hold_id, outcome, reason } }),
  addEntry: (s: Session, pid: string, fact: string, value: string, status: string, reason: string) =>
    request<{ ok: boolean; source_name: string; kind: "conflict" | "ok" }>("POST", `/api/chart/${enc(pid)}/entries`, s, { body: { fact, value, status, reason } }),
  patientView: (token: string, dob: string) => request<PatientView>("POST", `/api/p/${enc(token)}`, null, { body: { dob } }),
  order: (s: Session, pid: string, text: string, because: string[]) =>
    request<OrderResult>("POST", "/api/orders", s, { body: { pid, text, because } }),
  ack: (s: Session, orderId: string, reason: string) =>
    request<{ order_id: string; status: "saved" }>("POST", `/api/orders/${enc(orderId)}/ack`, s, { body: { reason } }),
  transfer: (s: Session, pid: string, to_hospital: string) =>
    request<{ transfer_id: string; pid: string }>("POST", "/api/transfers", s, { body: { pid, to_hospital } }),
  accessLog: (s: Session, pid: string) => request<LogEntry[]>("GET", `/api/access-log/${enc(pid)}`, s),
  patientLink: (s: Session, pid: string) => request<{ token: string; path: string }>("POST", "/api/patient-link", s, { body: { pid } }),
}

export const NOTICE = "sources disagree; a human must resolve"
export const REASONS: [string, string][] = [
  ["er", "Treating in the ER"],
  ["admit", "Admitting"],
  ["transfer", "Transfer received"],
  ["consult", "Consult"],
]
// Everyday words first; the clinical term is kept for tooltips.
export const FACT_LABEL: Record<string, string> = {
  anticoagulant: "Blood thinners",
  penicillin_allergy: "Penicillin allergy",
  vitals_stable: "Stable heart rate and breathing",
  icu_need: "Needs intensive care",
  on_pressors: "On blood-pressure support",
  blood_type: "Blood type",
}
export const FACT_TECH: Record<string, string> = {
  anticoagulant: "anticoagulant",
  penicillin_allergy: "penicillin allergy",
  vitals_stable: "vital signs stable",
  icu_need: "ICU need",
  on_pressors: "vasopressors",
  blood_type: "ABO/Rh blood type",
}
export const FACTS = Object.keys(FACT_LABEL)
export const STATUS_WORD: Record<string, string> = { active: "Active", present: "Present", stopped: "Stopped", absent: "None recorded" }
// What a doctor can record about a fact, in everyday words (the API status in brackets).
export const ENTRY_STATUS: [string, string][] = [
  ["active", "Taking it now"],
  ["present", "Has it / confirmed"],
  ["stopped", "Stopped"],
  ["absent", "Doesn't have it"],
]
export const DIFF_LABEL: Record<string, string> = { phone4: "phone", insurance_id: "insurance ID", address: "address" }
