// REST helpers for the DeepChart portal routes in CONTRACT.md ("DeepChart portal").
// The session token rides in the X-Session header and is kept in sessionStorage (per tab).

const KEY = 'deepchart.session'

export function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

export function saveSession(s) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s))
    else sessionStorage.removeItem(KEY)
  } catch {
    // private mode: the session just won't survive a reload
  }
}

async function request(method, path, { body, query, session } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))}` : ''
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (session?.token) headers['X-Session'] = session.token
  const res = await fetch(path + qs, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail || detail
    } catch {
      // keep statusText
    }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return res.json()
}

export const portal = {
  hospitals: () => request('GET', '/api/hospitals'),
  me: (s) => request('GET', '/api/me', { session: s }),
  login: (hospital, role, pin) => request('POST', '/api/login', { body: { hospital, role, pin } }),
  patients: (s) => request('GET', '/api/portal/patients', { session: s }),
  lookup: (s, pid, reason) => request('GET', '/api/lookup', { session: s, query: { pid, reason } }),
  confirm: (s, pid, recordRef, samePerson, reason) =>
    request('POST', '/api/lookup/confirm', {
      session: s,
      body: { pid, record_ref: recordRef, same_person: samePerson, reason },
    }),
  chart: (s, pid, reason) => request('GET', `/api/chart/${encodeURIComponent(pid)}`, { session: s, query: { reason } }),
  order: (s, pid, text, because) => request('POST', '/api/orders', { session: s, body: { pid, text, because } }),
  ack: (s, orderId, reason) =>
    request('POST', `/api/orders/${encodeURIComponent(orderId)}/ack`, { session: s, body: { reason } }),
  transfer: (s, pid, toHospital) =>
    request('POST', '/api/transfers', { session: s, body: { pid, to_hospital: toHospital } }),
  inbox: (s) => request('GET', '/api/inbox', { session: s }),
  accessLog: (s, pid) => request('GET', `/api/access-log/${encodeURIComponent(pid)}`, { session: s }),
  patientLink: (s, pid) => request('POST', '/api/patient-link', { session: s, body: { pid } }),
  patientView: (token) => request('GET', `/api/p/${encodeURIComponent(token)}`),
  resolveHold: (s, pid, holdId, outcome, reason) =>
    request('POST', `/api/chart/${encodeURIComponent(pid)}/resolve`, {
      session: s,
      body: { hold_id: holdId, outcome, reason },
    }),
  score: () => request('GET', '/api/deepchart/score'),
}

export const REASONS = [
  ['er', 'Treating in the ER'],
  ['admit', 'Admitting'],
  ['transfer', 'Transfer received'],
  ['consult', 'Consult'],
]

// Everyday words first; the clinical term is kept for tooltips.
export const FACT_LABEL = {
  anticoagulant: 'Blood thinners',
  penicillin_allergy: 'Penicillin allergy',
  vitals_stable: 'Stable heart rate and breathing',
  icu_need: 'Needs intensive care',
  on_pressors: 'On blood-pressure support',
  blood_type: 'Blood type',
}
export const FACT_TECH = {
  anticoagulant: 'anticoagulant',
  penicillin_allergy: 'penicillin allergy',
  vitals_stable: 'vital signs stable',
  icu_need: 'ICU need',
  on_pressors: 'vasopressors',
  blood_type: 'ABO/Rh blood type',
}
export const UNIT_WORD = {
  RESUS: 'Critical care room',
  ER: 'Emergency bed',
  HALLWAY: 'Hallway bed',
  ICU: 'Intensive care',
  STEPDOWN: 'Close-watch bed',
  WARD: 'Ward bed',
  OR: 'Surgery',
  PACU: 'Recovery room',
  LOUNGE: 'Going-home lounge',
  HOME: 'Home',
  PARTNER: 'Another hospital',
}
export const unitWord = (u) => UNIT_WORD[u] || u
export const FACTS = Object.keys(FACT_LABEL)
