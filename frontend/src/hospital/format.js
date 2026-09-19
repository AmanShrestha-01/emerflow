export const LEVELS = ['Normal', 'Making room', 'Stretching', 'Diverting', 'Crisis']

// Sim clock starts at 21:00; clock is simulated minutes since then.
export function simTime(clock = 0) {
  const m = (((21 * 60 + Math.floor(clock)) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function mins(n) {
  if (n == null || Number.isNaN(n)) return '–'
  const v = Math.round(n)
  if (v < 60) return `${v}m`
  return `${Math.floor(v / 60)}h${String(v % 60).padStart(2, '0')}`
}

// ESI-ish target times (minutes) used only to colour the wait timer.
export const WAIT_TARGET = { 1: 0, 2: 10, 3: 30, 4: 60, 5: 120 }

export const UNIT_LABEL = {
  RESUS: 'Resuscitation',
  ER: 'Emergency',
  HALLWAY: 'Hallway overflow',
  ICU: 'ICU',
  STEPDOWN: 'Step-down',
  WARD: 'Ward',
  OR: 'Surgery',
  PACU: 'Recovery (PACU)',
  LOUNGE: 'Discharge lounge',
  HOME: 'home',
  PARTNER: 'a partner hospital',
}
// Which department's wayfinding colour a unit is painted in.
export const UNIT_DEPT = {
  RESUS: 'ER', ER: 'ER', HALLWAY: 'ER', ICU: 'ICU', STEPDOWN: 'STEPDOWN', WARD: 'STEPDOWN', LOUNGE: 'STEPDOWN', OR: 'OR', PACU: 'OR',
}
export const LEVEL_SIGN = [
  { name: 'Normal', meaning: 'Beds are available as usual' },
  { name: 'Making room', meaning: 'Moving recovered patients on' },
  { name: 'Stretching', meaning: 'Hallway beds allowed; big moves need your OK' },
  { name: 'Diverting', meaning: 'Sending ambulances elsewhere needs your OK' },
  { name: 'Crisis', meaning: 'Human only' },
]
export const unitLabel = (u) => UNIT_LABEL[u] || u || '–'

export const FACT_LABEL = {
  anticoagulant: 'blood thinners',
  penicillin_allergy: 'penicillin allergy',
  vitals_stable: 'stable vital signs',
  icu_need: 'needs ICU care',
  on_pressors: 'blood-pressure drip',
  off_pressors: 'off blood-pressure drip',
  blood_type: 'blood type',
}
// how a fact reads inside a sentence: "two records disagree about ..."
export const FACT_PHRASE = {
  anticoagulant: 'blood thinners',
  penicillin_allergy: 'a penicillin allergy',
  vitals_stable: 'whether vital signs are stable',
  icu_need: 'whether ICU care is needed',
  on_pressors: 'a blood-pressure drip',
  blood_type: 'blood type',
}
export const factPhrase = (f) => FACT_PHRASE[f] || String(f).replace(/_/g, ' ')
export const factLabel = (f) => FACT_LABEL[f] || String(f).replace(/_/g, ' ')

export const ACTION_LABEL = {
  cancel_elective: 'Cancel elective surgery',
  call_in_staff: 'Call in off-duty nurses',
  divert_ambulances: 'Divert ambulances',
  divert: 'Divert ambulances',
  transfer_stable: 'Transfer stable patients out',
  transfer: 'Transfer stable patients out',
  open_hallway: 'Open ER hallway beds',
  pacu_overflow: 'Use PACU as ICU overflow',
}
export const actionLabel = (a) => ACTION_LABEL[a] || String(a || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// Agent identity in the feed. AI agents get a hue; rule-keepers are code and look like log lines.
export const AGENTS = {
  ER: { label: 'ER', short: 'ER', kind: 'ai' },
  ICU: { label: 'ICU', short: 'ICU', kind: 'ai' },
  STEPDOWN: { label: 'Step-down', short: 'SD', kind: 'ai' },
  OR: { label: 'Surgery', short: 'OR', kind: 'ai' },
  STAFFING: { label: 'Staffing', short: 'ST', kind: 'ai' },
  IMAGING: { label: 'Imaging', short: 'IM', kind: 'ai' },
  BLOODBANK: { label: 'Blood bank', short: 'BB', kind: 'ai' },
  EMS: { label: 'EMS', short: 'EMS', kind: 'ai' },
  COORDINATOR: { label: 'Coordinator', short: 'CO', kind: 'coord' },
  FASTLANE: { label: 'Fast lane', short: 'FL', kind: 'rule' },
  VALIDATOR: { label: 'Validator', short: 'VA', kind: 'rule' },
  DEEPCHART: { label: 'Records check', short: 'RC', kind: 'rule' },
  ESCALATION: { label: 'Escalation', short: 'ES', kind: 'rule' },
  ALL: { label: 'everyone', short: 'ALL', kind: 'all' },
}
export const DEPARTMENTS = ['ER', 'ICU', 'STEPDOWN', 'OR', 'STAFFING', 'IMAGING', 'BLOODBANK', 'EMS']
export const agentLabel = (a) => AGENTS[a]?.label || a || '?'
export const agentKind = (a) => AGENTS[a]?.kind || 'rule'
