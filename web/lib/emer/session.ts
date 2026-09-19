// The same session the classic app uses: the token rides in X-Session and lives in sessionStorage (per tab).
export type Session = { token: string; hospital: string; role: "commander" | "doctor" }
const KEY = "deepchart.session"
export const HOME = "Emer Flow General"
// The classic app (DeepChart doctor portal) lives on the FastAPI server: same origin in production, :8000 in dev.
export const CLASSIC = process.env.NODE_ENV === "development" ? "http://localhost:8000" : ""

export function loadSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null")
  } catch {
    return null
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* private mode: the session just won't survive a reload */
  }
}
export async function login(hospital: string, role: string, pin: string): Promise<Session> {
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospital, role, pin }) })
  if (!r.ok) {
    let msg = "Login failed"
    try {
      msg = (await r.json()).detail || msg
    } catch {}
    throw new Error(msg)
  }
  return r.json()
}
/** True when the stored session is still valid on the server (a restart logs everyone out). */
export async function checkSession(s: Session | null): Promise<boolean> {
  if (!s) return false
  try {
    const r = await fetch("/api/me", { headers: { "X-Session": s.token } })
    return r.ok
  } catch {
    return false
  }
}
