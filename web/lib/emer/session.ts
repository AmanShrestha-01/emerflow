// The same session the classic app uses: the token rides in X-Session. It lives in localStorage so the map tab
// and the board tab share one login; a server restart still ends it.
export type Session = { token: string; hospital: string; role: "commander" | "doctor"; name?: string } // name: the doctor's
const KEY = "deepchart.session"
export const HOME = "Johns Hopkins Hospital"
// The classic app (DeepChart doctor portal) lives on the FastAPI server: same origin in production, :8000 in dev.
export const CLASSIC = process.env.NODE_ENV === "development" ? "http://localhost:8000" : ""
// Static demo build (Vercel, no backend): login is checked here and the board runs on the in-browser mock.
// DeepChart has no mock, so the doctor role is not offered a session.
export const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1"

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null")
  } catch {
    return null
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
    window.dispatchEvent(new Event("emerflow:session")) // the header re-checks who is signed in
  } catch {
    /* private mode: the session just won't survive a reload */
  }
}
export async function login(hospital: string, role: string, pin: string, doctor?: string): Promise<Session> {
  if (STATIC_DEMO) {
    if (role === "doctor") throw new Error("The doctor portal needs the live server. This demo shows the hospital board.")
    if (pin !== "demo") throw new Error("Wrong PIN (the demo PIN is demo)")
    return { token: "static-demo", hospital, role: "commander" }
  }
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospital, role, pin, doctor }) })
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
  if (STATIC_DEMO) return true
  try {
    const r = await fetch("/api/me", { headers: { "X-Session": s.token } })
    return r.ok
  } catch {
    return false
  }
}
