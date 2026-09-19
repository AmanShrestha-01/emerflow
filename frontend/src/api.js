// REST helpers for every route in CONTRACT.md.
// In mock mode, calls are routed to the in-browser mock backend instead.

let mockBackend = null
export function setMockBackend(m) {
  mockBackend = m
}
export function isMock() {
  return mockBackend !== null
}

async function request(method, path, body) {
  if (mockBackend) return mockBackend.handle(method, path, body)
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j.detail || JSON.stringify(j)
    } catch {
      detail = res.statusText
    }
    throw new Error(`${method} ${path} failed (${res.status}): ${detail}`)
  }
  return res.json()
}

export const api = {
  state: () => request('GET', '/api/state'),
  // kind: 'bus' (25 bus-crash patients) or 'busy' (about 3x everyday arrivals for 60 min)
  surge: (kind = 'bus', n) => request('POST', '/api/surge', n ? { kind, n } : { kind }),
  radio: (text) => request('POST', '/api/radio', { text }),
  confirmRadio: (draftId) => request('POST', `/api/radio/${encodeURIComponent(draftId)}/confirm`),
  resolveApproval: (approvalId, approve) =>
    request('POST', `/api/approvals/${encodeURIComponent(approvalId)}`, { approve }),
  resolveHold: (holdId, outcome) =>
    request('POST', `/api/holds/${encodeURIComponent(holdId)}/resolve`, { outcome }),
  control: (action, extra = {}) => request('POST', '/api/control', { action, ...extra }),
  patient: (pid) => request('GET', `/api/patient/${encodeURIComponent(pid)}`),
  compare: () => request('GET', '/api/compare'),
}

// Demo key for protected controls (reset). Override with ?key=... in the URL.
export const DEMO_KEY = new URLSearchParams(window.location.search).get('key') || 'demo'
