// The eleven AI agents, in plain words. Mirrors backend/agents/departments.py (personas) and the old frontend's labels.
export type AgentId =
  | "ER" | "ICU" | "STEPDOWN" | "OR" | "STAFFING" | "IMAGING" | "XRAY" | "LAB" | "BLOODBANK" | "EMS" | "COORDINATOR"

export interface Agent {
  id: AgentId
  name: string
  persona: string
  ini: string
  role: string
  pushesFor: string
  from: string
  to: string
}

export const AGENTS: Agent[] = [
  { id: "ER", name: "Emergency", persona: "Apex", ini: "ER", role: "Gets waiting patients into beds", pushesFor: "Nobody left on a trolley in the corridor", from: "#ff8a5b", to: "#d9442f" },
  { id: "ICU", name: "Intensive care", persona: "Veil", ini: "IC", role: "Keeps beds for the sickest", pushesFor: "One bed always kept for the next emergency", from: "#8b7bff", to: "#5a46e0" },
  { id: "STEPDOWN", name: "Close-watch", persona: "Forge", ini: "CW", role: "Takes patients leaving intensive care", pushesFor: "Moving improving patients on quickly", from: "#3fc3a4", to: "#1f8a70" },
  { id: "OR", name: "Surgery", persona: "Crux", ini: "SU", role: "Protects urgent operations", pushesFor: "Urgent surgery first, planned cases can wait", from: "#c77dff", to: "#8a3fd1" },
  { id: "STAFFING", name: "Nurses", persona: "Root", ini: "NU", role: "Keeps nurse numbers safe", pushesFor: "No bed opened without a nurse for it", from: "#ffc861", to: "#d98e04" },
  { id: "IMAGING", name: "CT scan", persona: "Trace", ini: "CT", role: "Scans the most urgent first", pushesFor: "CT for head and chest injuries before anything else", from: "#5cc8ff", to: "#1f7fcf" },
  { id: "XRAY", name: "X-ray", persona: "Lumen", ini: "XR", role: "Images broken bones and chest injuries", pushesFor: "The quick image that frees a bed", from: "#7ee0e0", to: "#2a9d9d" },
  { id: "LAB", name: "Lab", persona: "Cipher", ini: "LB", role: "Runs blood tests, sickest first", pushesFor: "Nobody goes upstairs before their results are back", from: "#b8a4ff", to: "#7a5fd6" },
  { id: "BLOODBANK", name: "Blood bank", persona: "Void", ini: "BB", role: "Watches the blood supply", pushesFor: "Never running out of O-negative", from: "#ff7a9c", to: "#c73a5e" },
  { id: "EMS", name: "Ambulances", persona: "Orbit", ini: "AM", role: "Tracks who is on the way", pushesFor: "Warning the hospital before patients arrive", from: "#9ee06d", to: "#4d9a2a" },
  { id: "COORDINATOR", name: "Coordinator", persona: "Prism", ini: "CO", role: "Reads every report and writes one plan", pushesFor: "The best plan for the whole hospital, not one ward", from: "#6d5df6", to: "#1f8a70" },
]

export const AGENT: Record<string, Agent> = Object.fromEntries(AGENTS.map((a) => [a.id, a]))
export const DEPARTMENTS = AGENTS.filter((a) => a.id !== "COORDINATOR")

// Hospital places, in plain words.
export const UNIT_NAME: Record<string, string> = {
  RESUS: "Critical care room", ER: "Emergency", HALLWAY: "Hallway beds", ICU: "Intensive care",
  STEPDOWN: "Close-watch beds", WARD: "Ward", OR: "Surgery", PACU: "Recovery room", LOUNGE: "Going-home lounge",
  HOME: "Home", PARTNER: "Another hospital",
}
export const PLACE: Record<string, string> = {
  RESUS: "the critical care room", ER: "an emergency bed", HALLWAY: "a hallway bed", ICU: "intensive care",
  STEPDOWN: "a close-watch bed", WARD: "a ward bed", OR: "surgery", PACU: "recovery", LOUNGE: "the going-home lounge",
  HOME: "home", PARTNER: "another hospital",
}

const UNIT_WORDS: [RegExp, string][] = [
  [/\bWARD\b/g, "the ward"], [/\bSTEPDOWN\b/g, "close-watch beds"], [/\bstep-?down\b/gi, "close-watch"],
  [/\bPACU\b/g, "recovery"], [/\bRESUS\b/g, "the critical care room"], [/\bLOUNGE\b/g, "the going-home lounge"],
  [/\bHALLWAY\b/g, "a hallway bed"],
]
const CODE_RE = /\b(?:IN|MC|WI|RD|TR|HB|SIM|W|E|A|M)-\d+\b/g

/** Agent text in plain words: unit codes become places, patient codes become names. */
export function plainText(text: string, names: Record<string, string>): string {
  let s = String(text || "")
  for (const [re, w] of UNIT_WORDS) s = s.replace(re, w)
  return s.replace(CODE_RE, (m) => names[m] || "a patient")
}

/** A round avatar for the 3D sphere: the agent's gradient, initials and persona. */
export function agentOrb(a: Agent): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.from}"/><stop offset="1" stop-color="${a.to}"/></linearGradient>
<radialGradient id="h" cx=".3" cy=".25" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="200" height="200" fill="${a.to}"/>
<text x="100" y="112" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="64" fill="#fff">${a.ini}</text>
<text x="100" y="150" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="500" font-size="22" fill="#fff" fill-opacity=".85">${a.persona}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
