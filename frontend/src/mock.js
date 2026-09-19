// In-browser mock of the Emer Flow backend.
// Emits contract-shaped events (see CONTRACT.md) from a tiny hospital simulation
// and answers every REST route, so the board can be exercised without the server.
// Nothing here is clinical logic; it only exists to drive the UI.

const DEPTS = ['ER', 'ICU', 'STEPDOWN', 'OR', 'STAFFING', 'IMAGING', 'BLOODBANK', 'EMS']

// Facts code attaches to every move, by destination (mirrors the plan's rules table).
const REQUIRED = {
  RESUS: ['icu_need', 'on_pressors'],
  ER: ['vitals_stable', 'penicillin_allergy'],
  HALLWAY: ['vitals_stable', 'anticoagulant'],
  ICU: ['icu_need', 'anticoagulant'],
  STEPDOWN: ['anticoagulant', 'vitals_stable', 'icu_need'],
  WARD: ['vitals_stable', 'penicillin_allergy'],
  OR: ['anticoagulant', 'penicillin_allergy', 'blood_type'],
  PACU: ['vitals_stable', 'on_pressors', 'icu_need'],
  LOUNGE: ['vitals_stable', 'anticoagulant'],
  HOME: ['vitals_stable', 'anticoagulant'],
  PARTNER: ['vitals_stable', 'blood_type'],
}

const UNIT_SPEC = [
  // unit, beds, initial occupied, nurses
  ['RESUS', 4, 2, 2],
  ['ER', 16, 14, 6],
  ['HALLWAY', 6, 0, 1],
  ['ICU', 10, 9, 5],
  ['STEPDOWN', 12, 11, 3],
  ['WARD', 24, 22, 5],
  ['OR', 4, 2, 4],
  ['PACU', 6, 4, 2],
  ['LOUNGE', 6, 1, 1],
]

const FIRST = ['Lena', 'Marcus', 'Aisha', 'Tomás', 'Grace', 'Dev', 'Ruth', 'Omar', 'Hana', 'Victor', 'Imani', 'Paul',
  'Mei', 'Jorge', 'Nadia', 'Sam', 'Beatriz', 'Kofi', 'Ivy', 'Elijah', 'Rosa', 'Theo', 'Farah', 'Luis', 'June', 'Andre',
  'Priya', 'Walt', 'Noor', 'Caleb', 'Esther', 'Rahul', 'Dana', 'Yusuf', 'Clara', 'Ben']
const LAST = ['Cho', 'Bell', 'Okafor', 'Reyes', 'Lindqvist', 'Patel', 'Adeyemi', 'Haddad', 'Kim', 'Novak', 'Brooks',
  'Nguyen', 'Silva', 'Mensah', 'Ortiz', 'Walsh', 'Ferreira', 'Asante', 'Moreau', 'Hughes', 'Park', 'Duarte', 'Stein']

const INPATIENT_COMPLAINTS = {
  RESUS: ['GI bleed', 'septic shock', 'STEMI'],
  ER: ['chest pain, rule-out', 'abdominal pain', 'syncope', 'asthma exacerbation', 'kidney stone', 'cellulitis',
    'COPD flare', 'dehydration', 'back pain', 'migraine', 'allergic reaction', 'wrist fracture', 'pneumonia', 'fall, hip pain'],
  ICU: ['sepsis', 'DKA', 'respiratory failure', 'post-arrest', 'stroke', 'pancreatitis', 'trauma, chest', 'GI bleed', 'overdose'],
  STEPDOWN: ['CHF exacerbation', 'afib, rapid rate', 'post-op monitoring', 'pneumonia', 'COPD', 'chest pain obs'],
  WARD: ['cellulitis', 'pneumonia', 'post-op day 2', 'UTI, confusion', 'hip fracture', 'CHF', 'pyelonephritis', 'fall'],
  OR: ['appendectomy (urgent)', 'hip ORIF (urgent)'],
  PACU: ['post-op recovery'],
  LOUNGE: ['awaiting ride home'],
}

const MC_COMPLAINTS = [
  [1, 'open femur fracture, hemorrhage', { blood: true, surgery: true }],
  [1, 'blunt chest trauma, hypotensive', { blood: true, ct: true }],
  [1, 'head injury, unresponsive', { ct: true }],
  [2, 'head injury, confused', { ct: true }],
  [2, 'abdominal trauma, guarding', { ct: true, blood: true, surgery: true }],
  [2, 'pelvic pain after impact', { ct: true }],
  [2, 'chest wall injury, short of breath', {}],
  [2, 'neck pain, tingling hands', { ct: true }],
  [2, 'amputation, finger, bleeding controlled', {}],
  [3, 'forearm fracture', {}],
  [3, 'scalp laceration, alert', { ct: true }],
  [3, 'ankle deformity', {}],
  [3, 'rib pain, stable', {}],
  [3, 'back pain after impact', {}],
  [3, 'facial lacerations', {}],
  [3, 'knee injury', {}],
  [3, 'shoulder dislocation', {}],
  [3, 'seatbelt bruising, abdominal', { ct: true }],
  [4, 'wrist sprain', {}],
  [4, 'minor lacerations', {}],
  [4, 'bruised shin', {}],
  [4, 'neck strain, walking', {}],
  [4, 'glass abrasions', {}],
  [5, 'anxiety, no injury', {}],
  [5, 'minor abrasion', {}],
]

const OTHER_SOURCES = [
  ['Hospital B - Cardiology', '2026-03-02'],
  ['Mercy General ED', '2025-11-14'],
  ['CVS pharmacy fill history', '2026-08-27'],
  ['Urgent Care North', '2026-06-09'],
  ['St. Agnes inpatient', '2025-12-30'],
]
const LOCAL_SOURCE = ['Local intake', '2026-09-18']

const FACT_RES = {
  anticoagulant: ['MedicationStatement', 'ac'],
  penicillin_allergy: ['AllergyIntolerance', 'pcn'],
  vitals_stable: ['Observation', 'vitals'],
  icu_need: ['Condition', 'icu'],
  on_pressors: ['MedicationAdministration', 'press'],
  blood_type: ['Observation', 'abo'],
}
const CONFLICT_REASON = {
  anticoagulant: 'one source records it, the other explicitly records none',
  penicillin_allergy: 'one source lists an allergy, the other records no known allergies',
  vitals_stable: 'the sources record different vital-sign status',
  icu_need: 'the sources differ on ICU criteria',
  on_pressors: 'one source records an active infusion, the other records none',
  blood_type: 'the two sources record different blood types',
}

const FACT_WORDS = { anticoagulant: 'blood thinners', penicillin_allergy: 'a penicillin allergy', vitals_stable: 'vital signs', icu_need: 'ICU need', on_pressors: 'a blood-pressure drip', blood_type: 'blood type' }
const factWords = (f) => FACT_WORDS[f] || f
const APPROVAL_SENTENCE = {
  cancel_elective: "Cancel tonight's planned operations so the recovery room can take intensive care patients?",
  call_in_staff: "Call in 2 off-duty nurses? They'd arrive in about 45 minutes.",
}
const RETRIAGE_AFTER = { 1: 5, 2: 15, 3: 45, 4: 90, 5: 120 }

// Everyday arrivals: [severity, complaint, extras]
const EVERYDAY = [
  [1, 'gunshot wound to the abdomen', { surgery: true, blood: true }],
  [1, 'stab wound to the chest', { surgery: true }],
  [1, 'car crash, internal bleeding', { surgery: true, blood: true }],
  [2, 'severe chest pain, sweaty', {}],
  [2, 'short of breath, lips blue', {}],
  [3, 'abdominal pain', {}],
  [3, 'fall, hip pain', {}],
  [3, 'high fever, confused', {}],
  [4, 'broken wrist', {}],
  [4, 'cut hand, needs stitches', {}],
  [4, 'ankle injury', {}],
  [5, 'flu, fever and aches', {}],
  [5, 'sore throat', {}],
]
const NOTE_BY = { fastlane: 'Hospital rules', swarm: 'AI agents', fallback: 'Hospital rules' }
const TO_WORDS = { RESUS: 'the resuscitation room', ER: 'an emergency bed', HALLWAY: 'a hallway bed', ICU: 'an intensive care (ICU) bed', STEPDOWN: 'a close-watch bed', WARD: 'a ward bed', OR: 'surgery', PACU: 'the recovery room', LOUNGE: 'the discharge lounge', HOME: 'home', PARTNER: 'another hospital' }
const FACT_ABOUT = { anticoagulant: 'whether they take blood thinners', penicillin_allergy: 'whether they are allergic to penicillin', vitals_stable: 'whether their heart rate and breathing are stable', icu_need: 'whether they need intensive care', on_pressors: 'whether they are on a blood-pressure drip', blood_type: 'their blood type' }
const UNIT_NEED = {
  ICU: 'Intensive care',
  STEPDOWN: 'Close-watch bed',
  WARD: 'A ward bed to recover',
  OR: 'Surgery',
  PACU: 'Waking up after surgery',
  LOUNGE: 'Waiting for a ride home',
  ER: 'Tests and treatment in the ER',
  RESUS: 'Resuscitation',
}
// simulated vital signs, steady per patient, worse for more urgent patients
function vitalsFor(p) {
  let h = 0
  for (const c of p.pid) h = (h * 31 + c.charCodeAt(0)) % 997
  const sev = p.severity || 3
  const sys = [0, 86, 150, 132, 124, 118][sev] + (h % 18)
  const dia = Math.round(sys * 0.62) + (h % 7)
  const hr = [0, 124, 104, 92, 82, 76][sev] + (h % 14)
  const spo2 = [0, 88, 93, 96, 97, 98][sev] + (h % 3)
  return { bp: `${sys}/${dia}`, hr, spo2: Math.min(100, spo2) }
}

function needFor(p) {
  if (p.needs_surgery) return 'Emergency surgery'
  if (p.pid.startsWith('IN')) return UNIT_NEED[p.unit] || 'Ongoing care'
  if (p.severity === 1) return 'Resuscitation now, then intensive care'
  if (p.severity === 2) return /chest|breath|heart|blue/.test(p.complaint) ? 'Heart and lung monitoring (ICU)' : 'Close watching (close-watch bed)'
  if (p.severity === 3) return 'Tests and treatment in the ER'
  if (p.severity === 4) return 'Treat in the ER, then home'
  return 'Quick check, then home'
}

let rngSeed = 7
function rnd() {
  // deterministic-ish PRNG so demos look the same run to run
  rngSeed = (rngSeed * 16807) % 2147483647
  return (rngSeed - 1) / 2147483646
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
const pad2 = (n) => String(n).padStart(2, '0')

export function createMock() {
  const MODE = new URLSearchParams(window.location.search).get('mode') || 'mock'
  const answers = { live: 0, replay: 0, fallback: 0, stub: 0 }
  const cycleMs = []
  let resolvedHolds = 0
  let S
  let seq = 0
  let feed = []
  const listeners = new Set()
  let steps = [] // pending cycle steps [{delay, fn}]
  let stepAcc = 0
  let minuteAcc = 0
  let cycleRunning = false
  let interval = null

  function resetWorld() {
    rngSeed = 7
    seq = 0
    feed = []
    steps = []
    cycleRunning = false
    S = {
      clock: 0,
      version: 1,
      level: 1,
      diversion: false,
      paused: false,
      speed: 1,
      units: {},
      patients: {},
      order: [],
      ct_queue: [],
      blood: { 'O-': 8, 'O+': 22, 'A+': 14, 'B+': 6 },
      or_cases: [
        { case_id: 'C1', kind: 'urgent', procedure: 'appendectomy', pid: null, start: -40, status: 'in progress' },
        { case_id: 'C2', kind: 'urgent', procedure: 'hip ORIF', pid: null, start: -15, status: 'in progress' },
        { case_id: 'C3', kind: 'elective', procedure: 'knee replacement', pid: null, start: 90, status: 'scheduled' },
        { case_id: 'C4', kind: 'elective', procedure: 'hernia repair', pid: null, start: 135, status: 'scheduled' },
      ],
      partners: { 'Mercy General': 4, 'St. Agnes': 2 },
      off_duty_nurses: 6,
      holds: [],
      approvals: [],
      diverted: 0,
      pacuOverflow: false,
      calledIn: false,
      nurseArrivals: [],
      drafts: {},
      counters: { IN: 0, W: 0, A: 0, MC: 0, RD: 0, H: 0, APR: 0, M: 0, D: 0, CY: 0, MSG: 0 },
      lastCycle: -8,
      namesUsed: 0,
      census: [],
    }
    for (const [unit, beds, , nurses] of UNIT_SPEC) {
      S.units[unit] = { unit, beds, nurses, occupants: [], reserved_for: [] }
    }
    for (const [unit, , occ] of UNIT_SPEC) {
      for (let i = 0; i < occ; i++) {
        const sev = unit === 'RESUS' ? 1 : unit === 'ICU' ? pick([1, 2, 2]) : unit === 'STEPDOWN' ? 2 : unit === 'ER' ? pick([2, 3, 3, 4]) : 3
        const p = mkPatient('IN', { severity: sev, complaint: pick(INPATIENT_COMPLAINTS[unit]), state: 'placed', unit })
        S.units[unit].occupants.push(p.pid)
        if (unit === 'OR') S.or_cases[i].pid = p.pid
      }
    }
    // readiness: who could move on if a bed opened
    const icu = S.units.ICU.occupants
    markReady(icu[1], 'improving', ['anticoagulant'])
    markReady(icu[4], 'improving')
    markReady(icu[6], 'improving')
    S.units.STEPDOWN.occupants.slice(0, 2).forEach((pid) => markReady(pid, 'ready'))
    S.units.WARD.occupants.slice(0, 3).forEach((pid) => markReady(pid, 'ready'))
    S.units.ER.occupants.slice(0, 3).forEach((pid) => markReady(pid, 'ready'))

    // waiting room
    mkPatient('W', { severity: 2, complaint: 'chest pain, sweaty', state: 'waiting', waited: 6, target: 'STEPDOWN', conflicts: ['anticoagulant'] })
    mkPatient('W', { severity: 2, complaint: 'short of breath, low oxygen', state: 'waiting', waited: 8, target: 'ICU', needs_ct: false })
    mkPatient('W', { severity: 3, complaint: 'fall, hip pain', state: 'waiting', waited: 22, needs_ct: true })
    mkPatient('W', { severity: 3, complaint: 'abdominal pain', state: 'waiting', waited: 14 })
    mkPatient('W', { severity: 4, complaint: 'hand laceration', state: 'waiting', waited: 84 })
    // ambulances already on the way
    mkPatient('A', { severity: 1, complaint: 'unresponsive, found down', state: 'incoming', eta: 4, conflicts: ['on_pressors'], needs_ct: true })
    mkPatient('A', { severity: 3, complaint: 'dizzy, fall at home', state: 'incoming', eta: 9 })
    S.ct_queue = allPatients().filter((p) => p.needs_ct && p.state !== 'incoming').map((p) => p.pid)
    S.level = computeLevel()
    // start with one move waiting on a person (records disagree) and one big action to approve
    tryMove({ pid: 'W-01', to_unit: 'STEPDOWN', reason: 'Chest pain needs close monitoring' }, 'swarm', {})
    S.approvals.push({
      approval_id: `A${++S.counters.APR}`, action: 'call_in_staff', level: S.level, reason: 'ICU and close-watch beds above nurse ratio',
      params: { count: 2 }, detail: '2 off-duty nurses', created_at: 0, sentence: APPROVAL_SENTENCE.call_in_staff,
    })
  }

  function markReady(pid, flag, conflicts) {
    const p = S.patients[pid]
    if (!p) return
    p[flag] = true
    if (conflicts) {
      p.conflicts = conflicts
      p.records = mkRecords(p)
    }
  }

  function mkPatient(prefix, opts) {
    const n = ++S.counters[prefix]
    const pid = `${prefix}-${pad2(n)}`
    const name = `${FIRST[S.namesUsed % FIRST.length]} ${LAST[(S.namesUsed * 7 + 3) % LAST.length]}`
    S.namesUsed++
    const p = {
      pid,
      name,
      age: 18 + Math.floor(rnd() * 70),
      complaint: opts.complaint,
      severity: opts.severity,
      state: opts.state,
      unit: opts.unit || null,
      waited: opts.waited || 0,
      eta: opts.eta ?? null,
      needs_ct: !!opts.needs_ct,
      needs_blood: !!opts.needs_blood,
      needs_surgery: !!opts.needs_surgery,
      retriage: false,
      records_flag: false,
      locked: false,
      // internal
      target: opts.target || null,
      conflicts: opts.conflicts || [],
      other: pick(OTHER_SOURCES),
      last_move: null,
      ambulance: opts.state === 'incoming' ? `Medic ${4 + ((S.namesUsed * 7) % 17)}` : '',
    }
    p.records = mkRecords(p)
    S.patients[pid] = p
    S.order.push(pid)
    return p
  }

  function mkRecords(p) {
    const loc = {}
    const oth = {}
    const id = (src, fact) => `${FACT_RES[fact][0]}/${src}-${p.pid}-${FACT_RES[fact][1]}`
    const icuVal = p.severity <= 2 ? 'meets ICU criteria' : 'no ICU criteria'
    const base = {
      anticoagulant: ['none recorded', 'absent'],
      penicillin_allergy: ['no known drug allergy', 'absent'],
      vitals_stable: ['stable at triage', 'final'],
      icu_need: [icuVal, 'final'],
      on_pressors: ['no infusion recorded', 'absent'],
      blood_type: [pick(['O+', 'A+', 'B+', 'O-']), 'final'],
    }
    const alt = {
      anticoagulant: [pick(['warfarin 5mg daily', 'apixaban 5mg twice daily']), 'active'],
      penicillin_allergy: ['penicillin: hives (2019)', 'active'],
      vitals_stable: ['hypotensive episode, 84/50', 'final'],
      icu_need: [p.severity <= 2 ? 'no ICU criteria' : 'meets ICU criteria', 'final'],
      on_pressors: ['norepinephrine infusion', 'active'],
      blood_type: [base.blood_type[0] === 'A+' ? 'O+' : 'A+', 'final'],
    }
    for (const fact of Object.keys(base)) {
      loc[fact] = { value: base[fact][0], status: base[fact][1], resource_id: id('loc', fact) }
      const v = p.conflicts.includes(fact) ? alt[fact] : base[fact]
      oth[fact] = { value: v[0], status: v[1], resource_id: id('ext', fact) }
    }
    return [
      { source_name: LOCAL_SOURCE[0], recorded_date: LOCAL_SOURCE[1], claims: loc },
      { source_name: p.other[0], recorded_date: p.other[1], claims: oth },
    ]
  }

  function conflictObjs(p, facts) {
    return facts.map((fact) => ({
      fact,
      reason: CONFLICT_REASON[fact],
      versions: p.records.map((src) => ({
        source_name: src.source_name,
        recorded_date: src.recorded_date,
        ...src.claims[fact],
      })),
    }))
  }

  const allPatients = () => S.order.map((pid) => S.patients[pid])
  const waitingList = () =>
    allPatients()
      .filter((p) => p.state === 'waiting' && !p.locked)
      .sort((a, b) => a.severity - b.severity || b.waited - a.waited)
  const occ = (u) => S.units[u].occupants.length
  const free = (u) => S.units[u].beds - S.units[u].occupants.length - S.units[u].reserved_for.length
  const pct = (u) => Math.round((occ(u) / S.units[u].beds) * 100)

  // ---------- public state ----------
  function publicPatient(p) {
    const { pid, name, age, complaint, severity, state, unit, waited, eta, needs_ct, needs_blood, retriage, records_flag, locked, needs_surgery, note, note_by, heading_to } = p
    return { pid, name, age, complaint, severity, state, unit, waited, eta, needs_ct, needs_blood, retriage, records_flag, locked, need: needFor(p), needs_surgery: !!needs_surgery, note: note || null, note_by: note_by || null, heading_to: heading_to || null, ...vitalsFor(p), ambulance: p.ambulance || '' }
  }
  function metrics() {
    const w = allPatients().filter((p) => p.state === 'waiting' || (p.state === 'held' && !p.unit))
    const waitingOnly = allPatients().filter((p) => p.state === 'waiting')
    const avg = w.length ? w.reduce((a, p) => a + p.waited, 0) / w.length : 0
    return {
      avg_wait: Math.round(avg * 10) / 10,
      longest_wait: w.reduce((m, p) => Math.max(m, p.waited), 0),
      critical_waiting: waitingOnly.filter((p) => p.severity <= 2).length,
      hallway: occ('HALLWAY'),
      held: S.holds.length,
      diverted: S.diverted,
      placed: allPatients().filter((p) => p.state === 'placed').length,
      waiting: waitingOnly.length,
    }
  }
  function snapshot() {
    return {
      clock: S.clock,
      clock_start: 21 * 60,
      census: S.census.slice(-96),
      version: S.version,
      level: S.level,
      level_name: LEVEL_NAMES[S.level],
      diversion: S.diversion,
      paused: S.paused,
      speed: S.speed,
      mode: MODE,
      busy_until: S.busy_until ?? null,
      units: Object.values(S.units).map((u) => ({
        unit: u.unit,
        beds: u.beds,
        occupied: u.occupants.length,
        reserved: u.reserved_for.length,
        percent: pct(u.unit),
        nurses: u.nurses,
        occupants: [...u.occupants],
        reserved_for: [...u.reserved_for],
      })),
      patients: allPatients()
        .filter((p) => p.state !== 'discharged' && p.state !== 'transferred')
        .map(publicPatient),
      ct_queue: [...S.ct_queue],
      blood: { ...S.blood },
      or_cases: S.or_cases.map((c) => ({ ...c })),
      partners: { ...S.partners },
      off_duty_nurses: S.off_duty_nurses,
      holds: S.holds.map((h) => ({ ...h })),
      approvals: S.approvals.map((a) => ({ ...a })),
      metrics: metrics(),
      feed: feed.slice(-200),
    }
  }

  function emit(type, data, ctx = {}) {
    S.version++
    const ev = { id: ++seq, type, clock: S.clock, cycle_id: ctx.cycle_id ?? null, round: ctx.round ?? null, data }
    if (type !== 'snapshot' && type !== 'tick' && type !== 'agent.thinking') {
      feed.push(ev)
      if (feed.length > 300) feed = feed.slice(-300)
    }
    listeners.forEach((l) => l(ev))
    return ev
  }
  const emitSnapshot = () => emit('snapshot', snapshot())

  // ---------- level / escalation meter ----------
  function computeLevel() {
    const erBeds = S.units.ER.beds + S.units.RESUS.beds
    const erOcc = occ('ER') + occ('RESUS')
    const waiting = allPatients().filter((p) => p.state === 'waiting')
    const critLong = waiting.some((p) => p.severity <= 2 && p.waited > 10)
    const high = ['ER', 'ICU', 'STEPDOWN', 'WARD'].some((u) => pct(u) >= 90)
    const low = ['ER', 'ICU', 'STEPDOWN', 'WARD'].every((u) => pct(u) < 80) && waiting.length < 3
    let target = erOcc >= erBeds || critLong ? 2 : high || waiting.length >= 5 ? 1 : 0
    const cur = S.level ?? 0
    if (target > cur) return target
    if (target < cur) {
      // hysteresis: step down one level at a time, only once pressure has clearly eased
      if (cur === 2 && erOcc / erBeds < 0.8 && !waiting.some((p) => p.severity <= 2 && p.waited > 5)) return 1
      if (cur === 1 && low) return 0
    }
    return cur
  }
  function updateLevel() {
    const nl = computeLevel()
    if (nl !== S.level) {
      const old = S.level
      S.level = nl
      emit('level.changed', { old, new: nl, name: LEVEL_NAMES[nl] })
      // pending approvals expire when the level drops below theirs
      if (nl < old) {
        for (const a of [...S.approvals]) {
          if (a.level > nl) {
            S.approvals = S.approvals.filter((x) => x !== a)
            emit('approval.resolved', { approval_id: a.approval_id, approved: false })
            emit('notice', { text: `Approval ${a.approval_id} (${a.action}) expired: level dropped to ${LEVEL_NAMES[nl]}` })
          }
        }
      }
    }
  }

  // ---------- moves ----------
  function place(p, to, source, because, ctx) {
    const from = p.unit
    p.note = p.nextNote || defaultNote(p, to, source)
    p.note_by = NOTE_BY[source] || 'Rules (code)'
    p.nextNote = null
    p.heading_to = null
    if (to === 'OR') p.orMin = 0
    if (to === 'PACU' && from === 'OR') {
      p.fromSurgery = true
      p.pacuMin = 0
      p.needs_surgery = false
    }
    if (p.bedWait == null && from == null && p.state !== 'placed') p.bedWait = p.waited || 0
    for (const u of Object.values(S.units)) {
      u.occupants = u.occupants.filter((x) => x !== p.pid)
      u.reserved_for = u.reserved_for.filter((x) => x !== p.pid)
    }
    if (to === 'HOME') p.state = 'discharged'
    else if (to === 'PARTNER') p.state = 'transferred'
    else {
      S.units[to].occupants.push(p.pid)
      p.state = 'placed'
    }
    p.unit = to === 'HOME' || to === 'PARTNER' ? null : to
    p.locked = false
    p.improving = false
    p.ready = false
    p.last_move = { to_unit: to, because, source }
    S.ct_queue = p.state === 'placed' ? S.ct_queue : S.ct_queue.filter((x) => x !== p.pid)
    emit('move.applied', { move_id: `M${++S.counters.M}`, pid: p.pid, from_unit: from, to_unit: to, source, because }, ctx)
  }

  // Validator + DeepChart gate + apply. Returns 'applied' | 'held' | 'dropped'.
  function tryMove(m, source, ctx) {
    const p = S.patients[m.pid]
    const to = m.to_unit
    const drop = (reason) => {
      emit('move.dropped', { pid: m.pid, to_unit: to, reason }, ctx)
      say('VALIDATOR', ['COORDINATOR'], 'system', `Stopped the move of ${m.pid} to ${UNIT_NAME[to] || to}: ${reason}.`, [m.pid], 'code', ctx)
      return 'dropped'
    }
    if (!p || (p.state !== 'placed' && p.state !== 'waiting')) return drop(`${m.pid} is no longer eligible to move`)
    if (p.locked) return drop(`${m.pid} is locked while held for verification`)
    if (p.unit === to) return drop(`${m.pid} is already in ${to}`)
    if (to === 'PACU' && !S.pacuOverflow && p.unit !== 'OR') return drop('recovery beds are kept for planned surgery until staff approve cancelling it')
    if (to === 'HALLWAY' && S.level < 2) return drop('hallway beds are only allowed from level 2')
    if (to !== 'HOME' && to !== 'PARTNER' && free(to) <= 0) return drop(`${UNIT_NAME[to] || to} has no free bed any more`)
    const because = [...new Set([...(REQUIRED[to] || []), ...(m.extra_because || [])])]
    if (m.reason) p.nextNote = m.reason.charAt(0).toUpperCase() + m.reason.slice(1)
    const hits = because.filter((f) => p.conflicts.includes(f))
    if (hits.length) {
      const lifeSaving = to === 'RESUS' || p.severity === 1
      if (lifeSaving) {
        p.records_flag = true
        emit('move.flagged', { pid: p.pid, to_unit: to, conflicts: conflictObjs(p, hits) }, ctx)
        say('DEEPCHART', ['COORDINATOR', agentFor(to)], 'system', `${p.pid} went to ${UNIT_NAME[to] || to} because it is life-saving, but two records disagree about ${hits.map(factWords).join(' and ')}.`, [p.pid], 'code', ctx)
        place(p, to, source, because, ctx)
        return 'applied'
      }
      const hold = {
        hold_id: `H${++S.counters.H}`,
        pid: p.pid,
        to_unit: to,
        because,
        created_at: S.clock,
        conflicts: conflictObjs(p, hits),
      }
      S.holds.push(hold)
      S.units[to].reserved_for.push(p.pid)
      p.prevState = p.state
      p.state = 'held'
      p.locked = true
      p.records_flag = true
      p.heading_to = to
      p.note = `Can't move ${p.name.split(' ')[0]} to ${TO_WORDS[to] || to} yet: two hospitals' records disagree about ${hits.map((f) => FACT_ABOUT[f] || f).join(' and ')}. A person needs to check.`
      p.note_by = 'Records check'
      hold.name = p.name
      hold.sentence = `${p.name} can't be moved to ${TO_WORDS[to] || to} yet: two hospitals' records disagree about ${hits.map((f) => FACT_ABOUT[f] || f).join(' and ')}.`
      p.last_move = { to_unit: to, because, source }
      emit('move.held', { hold_id: hold.hold_id, pid: p.pid, to_unit: to, because, conflicts: hold.conflicts }, ctx)
      say('DEEPCHART', ['COORDINATOR', agentFor(to)], 'system', `Paused the move of ${p.pid} to ${UNIT_NAME[to] || to}. VERIFICATION REQUIRED: sources disagree; a human must resolve (${hits.map(factWords).join(' and ')}). The bed is held back.`, [p.pid], 'code', ctx)
      return 'held'
    }
    place(p, to, source, because, ctx)
    return 'applied'
  }

  function targetFor(p) {
    if (p.target) return p.target
    if (p.severity === 1) return 'RESUS'
    if (p.severity === 2) return p.complaint.match(/head|chest|trauma|O2|hypotens|breath|blue/) ? 'ICU' : 'STEPDOWN'
    return 'ER'
  }

  // ---------- arrivals ----------
  function arrive(p) {
    p.state = 'waiting'
    p.eta = null
    p.waited = 0
    emit('patient.arrived', { pid: p.pid, severity: p.severity, complaint: p.complaint })
    if (p.needs_ct && !S.ct_queue.includes(p.pid)) S.ct_queue.push(p.pid)
    if (p.needs_blood) S.blood['O-'] = Math.max(0, S.blood['O-'] - 1)
    // fast lane: severity 1 is never left unplaced
    if (p.severity === 1) {
      const to = free('RESUS') > 0 ? 'RESUS' : free('HALLWAY') > 0 ? 'HALLWAY' : null
      if (to) {
        const because = REQUIRED[to]
        const hits = because.filter((f) => p.conflicts.includes(f))
        if (hits.length) {
          p.records_flag = true
          emit('move.flagged', { pid: p.pid, to_unit: to, conflicts: conflictObjs(p, hits) })
          say('DEEPCHART', ['FASTLANE', 'ER'], 'system', `${p.pid} went straight to ${UNIT_NAME[to] || to} because it is life-saving, but two records disagree about ${hits.map(factWords).join(' and ')}.`, [p.pid], 'code', {})
        }
        place(p, to, 'fastlane', because, {})
      }
    } else if (S.level === 0 && free(targetFor(p)) > 0) {
      tryMove({ pid: p.pid, to_unit: targetFor(p) }, 'fastlane', {})
    }
  }

  function surge(n = 25) {
    const list = []
    for (let i = 0; i < n; i++) {
      const [sev, complaint, f] = MC_COMPLAINTS[i % MC_COMPLAINTS.length]
      const p = mkPatient('MC', {
        severity: sev,
        complaint,
        state: 'incoming',
        eta: 3 + Math.floor(i / 3) + Math.floor(rnd() * 3),
        needs_ct: !!f.ct,
        needs_blood: !!f.blood,
        needs_surgery: !!f.surgery,
      })
      list.push(p)
    }
    // plant record conflicts on a handful, each on a fact its likely move will rest on
    const plant = [0, 3, 4, 7, 10, 14]
    for (const i of plant) {
      const p = list[i]
      if (!p) continue
      const facts = REQUIRED[targetFor(p)]
      p.conflicts = [i === 0 ? 'on_pressors' : facts[i % facts.length]]
      p.records = mkRecords(p)
    }
    emit('notice', { text: `EMS: mass casualty, bus crash. ${n} patients inbound, first ETA ${Math.min(...list.map((p) => p.eta))} min` })
    scheduleCycleSoon('mass casualty: incoming surge')
    return { incoming: n }
  }

  function defaultNote(p, to, source) {
    if (to === 'RESUS') return 'Life-threatening: straight to the resuscitation room'
    if (to === 'HALLWAY' && p.severity === 1) return 'Life-threatening, but the resuscitation room was full: a hallway bed for now'
    if (source === 'fastlane') return 'A matching bed was free on arrival'
    if (to === 'HOME') return 'Treated and well enough to go home'
    return `A bed was free in ${UNIT_NAME[to] || to}`
  }

  function busyNight() {
    S.busy_until = Math.max(S.busy_until || 0, S.clock) + 60
    emit('notice', { text: `Busy night: about three times the usual walk-ins for the next ${S.busy_until - S.clock} minutes` })
    return { busy_until: S.busy_until }
  }

  // ---------- one simulated minute ----------
  function advanceMinute() {
    S.clock++
    for (const p of allPatients()) {
      if (p.state === 'waiting' || (p.state === 'held' && !p.unit)) p.waited++
      if (p.state === 'incoming') {
        p.eta = Math.max(0, (p.eta ?? 1) - 1)
        if (p.eta === 0) arrive(p)
      }
      if (p.state === 'waiting' && !p.retriage && p.waited >= RETRIAGE_AFTER[p.severity]) {
        p.retriage = true
        emit('retriage.flag', { pid: p.pid, waited: p.waited })
      }
    }
    // walk-ins and ambulances keep coming
    const busy = S.busy_until != null && S.clock < S.busy_until
    if (S.clock % 4 === 2 || (busy && S.clock % 4 !== 0)) {
      const [sev, complaint, extra] = pick(EVERYDAY)
      const p = mkPatient('W', { severity: sev, complaint, state: 'waiting', needs_surgery: !!extra?.surgery, needs_blood: !!extra?.blood })
      if (sev === 1) arrive(p)
      else emit('patient.arrived', { pid: p.pid, severity: p.severity, complaint: p.complaint })
    }
    if (S.clock % 11 === 5) {
      mkPatient('A', { severity: pick([2, 3, 3, 4]), complaint: pick(['fall, elderly', 'MVC, restrained driver', 'seizure', 'chest pain']), state: 'incoming', eta: 6 + Math.floor(rnd() * 6) })
    }
    // people get better
    // the surgical journey: operating room, then recovery, then the ward
    for (const pid of S.units.OR.occupants) {
      const p = S.patients[pid]
      if (p.needs_surgery && ++p.orMin >= 6) p.orDone = true
    }
    for (const pid of S.units.PACU.occupants) {
      const p = S.patients[pid]
      if (p.fromSurgery && ++p.pacuMin >= 6) p.ready = true
    }
    for (const [u, flag, prob] of [['ICU', 'improving', 0.03], ['STEPDOWN', 'ready', 0.04], ['WARD', 'ready', 0.03], ['ER', 'ready', 0.05], ['RESUS', 'improving', 0.06]]) {
      for (const pid of S.units[u].occupants) {
        const p = S.patients[pid]
        if (!p.locked && !p[flag] && chance(prob)) p[flag] = true
      }
    }
    // CT scanner: one scan every 4 minutes
    if (S.clock % 4 === 0 && S.ct_queue.length) {
      const pid = S.ct_queue.shift()
      if (S.patients[pid]) S.patients[pid].needs_ct = false
    }
    // OR: electives start on schedule unless cancelled
    for (const c of S.or_cases) if (c.status === 'scheduled' && S.clock >= c.start) c.status = 'in progress'
    // nurses called in arrive after 45 sim-min
    for (const a of [...S.nurseArrivals]) {
      if (S.clock >= a.at) {
        S.units.ICU.nurses += 1
        S.units.STEPDOWN.nurses += 1
        S.nurseArrivals = S.nurseArrivals.filter((x) => x !== a)
        emit('notice', { text: '2 called-in nurses arrived: +1 ICU, +1 close-watch' })
      }
    }
    if (S.clock % 17 === 0) {
      S.blood['O-'] += 2
      emit('notice', { text: 'Blood bank: courier delivered 2 units O-neg' })
    }
    if (S.clock % 5 === 0) {
      const c = { clock: S.clock }
      for (const u of ['ER', 'ICU', 'STEPDOWN', 'WARD']) c[u] = pct(u)
      S.census.push(c)
      if (S.census.length > 96) S.census.shift()
    }
    emit('tick', { clock: S.clock, level: S.level })
    updateLevel()

    if (!cycleRunning) {
      const waitingN = waitingList().length
      const since = S.clock - S.lastCycle
      const full = ['ER', 'ICU', 'STEPDOWN'].some((u) => pct(u) >= 90)
      if (waitingN > 0 && since >= 5) startCycle(`${waitingN} unplaced patient${waitingN > 1 ? 's' : ''}`)
      else if (full && since >= 8) startCycle('unit at or above 90%')
      else if (since >= 10) startCycle('10-minute check')
    }
  }

  function scheduleCycleSoon(trigger) {
    if (!cycleRunning) S.lastCycle = Math.min(S.lastCycle, S.clock - 3)
    S.pendingTrigger = trigger
  }

  // ---------- the swarm cycle ----------
  function deptStatus(unit) {
    const u = S.units[unit]
    const base = { unit, free_now: 0, can_free: [], needs: [], blockers: [], stale: false }
    const waiting = waitingList()
    switch (unit) {
      case 'ER': {
        const serious = waiting.filter((p) => p.severity <= 2).length
        const ready = S.units.ER.occupants.map((pid) => S.patients[pid]).filter((p) => p.ready && !p.locked)
        return {
          ...base,
          free_now: Math.max(0, free('ER')) + Math.max(0, free('RESUS')),
          line: `${waiting.length} waiting, ${serious} serious. Hallway ${occ('HALLWAY')}/${S.units.HALLWAY.beds}${free('ER') <= 0 ? ', every bay full' : ''}`,
          can_free: ready.slice(0, 3).map((p) => ({ pid: p.pid, to_unit: p.severity <= 3 ? 'WARD' : 'HOME', ready_in_min: 0, why: 'workup done' })),
          needs: waiting.length > 4 ? ['hallway beds'] : [],
          blockers: free('ICU') <= 0 ? ['ICU full, admits boarding in ER'] : [],
        }
      }
      case 'ICU': {
        const f = free('ICU')
        const improving = u.occupants.map((pid) => S.patients[pid]).filter((p) => p.improving && !p.locked)
        return {
          ...base,
          free_now: Math.max(0, f),
          line: f <= 0 ? `Full. ${improving.length} improving could step down if step-down has room` : f === 1 ? '1 bed left, holding it for critical patients' : `${f} beds open`,
          can_free: improving.slice(0, 2).map((p, i) => ({ pid: p.pid, to_unit: 'STEPDOWN', ready_in_min: i * 12, why: 'improving' })),
          needs: u.nurses * 2 < occ('ICU') ? ['1 nurse'] : [],
        }
      }
      case 'STEPDOWN': {
        const ready = u.occupants.map((pid) => S.patients[pid]).filter((p) => p.ready && !p.locked)
        return {
          ...base,
          free_now: Math.max(0, free('STEPDOWN')),
          line: `${free('STEPDOWN')} open. ${ready.length} ready for the ward, can take ICU transfers once they go`,
          can_free: ready.slice(0, 2).map((p) => ({ pid: p.pid, to_unit: 'WARD', ready_in_min: 5, why: 'ready for ward' })),
          needs: u.nurses * 4 < occ('STEPDOWN') ? ['1 nurse'] : [],
        }
      }
      case 'OR': {
        const el = S.or_cases.filter((c) => c.kind === 'elective' && c.status === 'scheduled')
        return {
          ...base,
          free_now: Math.max(0, free('OR')),
          line: `${S.or_cases.filter((c) => c.status === 'in progress').length} in theatre, ${el.length} elective${el.length === 1 ? '' : 's'} booked. PACU ${occ('PACU')}/${S.units.PACU.beds}`,
          blockers: el.length ? ['PACU beds held for electives'] : [],
        }
      }
      case 'STAFFING': {
        const ratio = (occ('ICU') / Math.max(1, S.units.ICU.nurses)).toFixed(1)
        return {
          ...base,
          line: `${S.off_duty_nurses} nurses off duty. ICU running 1:${ratio}${S.nurseArrivals.length ? `, ${S.nurseArrivals.length * 2} on the way` : ''}`,
          needs: Number(ratio) > 2 ? ['call in 2 nurses'] : [],
        }
      }
      case 'IMAGING':
        return {
          ...base,
          line: S.ct_queue.length ? `CT queue ${S.ct_queue.length}, scanning ${S.ct_queue[0]} now` : 'CT idle',
          blockers: S.ct_queue.length > 3 ? ['CT backlog delaying moves that wait on a scan'] : [],
        }
      case 'BLOODBANK':
        return {
          ...base,
          line: S.blood['O-'] < 6 ? `O-neg down to ${S.blood['O-']} units, holding for trauma` : `O-neg ${S.blood['O-']} units, supply fine`,
          needs: S.blood['O-'] < 6 ? ['O-neg resupply'] : [],
        }
      case 'EMS': {
        const inbound = allPatients().filter((p) => p.state === 'incoming').length
        return {
          ...base,
          line: `${inbound} inbound. Mercy General can take ${S.partners['Mercy General']} stable transfers`,
        }
      }
      default:
        return { ...base, line: '' }
    }
  }

  function buildPlan() {
    const moves = []
    const plannedFree = {}
    const bump = (u, d) => (plannedFree[u] = (plannedFree[u] ?? free(u)) + d)
    const avail = (u) => plannedFree[u] ?? free(u)
    const push = (p, to, kind, reason) => {
      if (p.unit) bump(p.unit, 1)
      if (to !== 'HOME' && to !== 'PARTNER') bump(to, -1)
      moves.push({ pid: p.pid, to_unit: to, kind, reason })
    }
    const inUnit = (u, flag) => S.units[u].occupants.map((pid) => S.patients[pid]).filter((p) => p[flag] && !p.locked)
    // the surgical journey first: resuscitation -> operating room -> recovery -> ward
    S.units.PACU.occupants.map((pid) => S.patients[pid]).filter((p) => p.fromSurgery && p.ready && !p.locked).slice(0, 1).forEach((p) => avail('WARD') > 0 && push(p, 'WARD', 'transfer', 'Awake after surgery: to a ward bed'))
    S.units.OR.occupants.map((pid) => S.patients[pid]).filter((p) => p.orDone && !p.locked).forEach((p) => avail('PACU') > 0 && push(p, 'PACU', 'recovery', 'Surgery done: to recovery'))
    S.units.RESUS.occupants.map((pid) => S.patients[pid]).filter((p) => p.needs_surgery && !p.locked).forEach((p) => avail('OR') > 0 && push(p, 'OR', 'surgery', 'Emergency surgery: operating room free'))
    S.units.RESUS.occupants.map((pid) => S.patients[pid]).filter((p) => !p.needs_surgery && p.improving && !p.locked).slice(0, 1).forEach((p) => avail('ICU') > 0 && push(p, 'ICU', 'step_down', 'Stable enough to leave resuscitation: to an ICU bed'))
    // free beds upstream first (the dependency order)
    inUnit('WARD', 'ready').slice(0, 2).forEach((p, i) => push(p, i === 0 && free('LOUNGE') > 0 ? 'LOUNGE' : 'HOME', 'discharge', 'Well enough to go home'))
    inUnit('STEPDOWN', 'ready').slice(0, 2).forEach((p) => avail('WARD') > 0 && push(p, 'WARD', 'transfer', 'Ready to leave the close-watch beds for a ward bed'))
    inUnit('ICU', 'improving').slice(0, 2).forEach((p) => avail('STEPDOWN') > 0 && push(p, 'STEPDOWN', 'step_down', 'Getting better, which frees an intensive care bed'))
    inUnit('ER', 'ready').slice(0, 2).forEach((p) => push(p, p.severity <= 3 && avail('WARD') > 0 ? 'WARD' : 'HOME', p.severity <= 3 ? 'admit' : 'discharge', 'Finished treatment in the ER'))
    // then place the waiting, sickest first
    let optimistic = false
    for (const p of waitingList().slice(0, 6)) {
      let to = targetFor(p)
      if (to === 'RESUS' && avail('RESUS') <= 0) to = 'ICU'
      if (avail(to) > 0) push(p, to, 'admit', `Waited ${p.waited} min; a bed that fits what they need was free`)
      else if (to === 'ICU' && !optimistic) {
        optimistic = true
        push(p, 'PACU', 'overflow', 'Intensive care is full, so the recovery room is used instead')
      } else if (S.level >= 2 && avail('HALLWAY') > 0 && p.severity >= 3) push(p, 'HALLWAY', 'hallway', 'The ER is full, so a hallway bed is used')
    }
    const escalations = []
    const pending = (a) => S.approvals.some((x) => x.action === a)
    if (S.level >= 2) {
      if (!S.pacuOverflow && !pending('cancel_elective') && S.or_cases.some((c) => c.kind === 'elective' && c.status === 'scheduled'))
        escalations.push({ action: 'cancel_elective', reason: 'PACU needed as ICU overflow' })
      if (!S.calledIn && !pending('call_in_staff') && S.off_duty_nurses >= 2)
        escalations.push({ action: 'call_in_staff', reason: 'ICU and close-watch beds above nurse ratio' })
    }
    const nFree = moves.filter((m) => m.kind !== 'admit' && m.kind !== 'overflow' && m.kind !== 'hallway').length
    const nAdmit = moves.length - nFree
    const summary =
      moves.length === 0 && escalations.length === 0
        ? 'Nothing safe to move this cycle; hold steady.'
        : `Free ${nFree} bed${nFree === 1 ? '' : 's'} upstream, then place ${nAdmit} waiting patient${nAdmit === 1 ? '' : 's'}` +
          (escalations.length ? `. Ask staff: ${escalations.map((e) => e.action.replace(/_/g, ' ')).join(', ')}` : '')
    return { summary, moves, escalations }
  }

  const APPROVAL_DETAIL = {
    cancel_elective: () => {
      const el = S.or_cases.filter((c) => c.kind === 'elective' && c.status === 'scheduled')
      return { params: { case_ids: el.map((c) => c.case_id) }, detail: `frees ${el.length} PACU beds as ICU overflow` }
    },
    call_in_staff: () => ({ params: { count: 2 }, detail: '2 off-duty nurses; they arrive 45 min after approval' }),
  }

  // ---------- the conversation ----------
  const UNIT_AGENT = { RESUS: 'ER', ER: 'ER', HALLWAY: 'ER', ICU: 'ICU', PACU: 'OR', OR: 'OR', STEPDOWN: 'STEPDOWN', WARD: 'STEPDOWN', LOUNGE: 'STEPDOWN' }
  const UNIT_NAME = { RESUS: 'resuscitation', ER: 'the ER', HALLWAY: 'an ER hallway bed', ICU: 'ICU', PACU: 'the recovery room', OR: 'the OR', STEPDOWN: 'a close-watch bed', WARD: 'the ward', LOUNGE: 'the discharge lounge', HOME: 'home', PARTNER: 'a partner hospital' }
  const agentFor = (u) => UNIT_AGENT[u] || 'ER'
  const think = (from, to, ctx) => emit('agent.thinking', { from, to }, ctx)
  const PERSONA = { ER: 'Apex', ICU: 'Veil', STEPDOWN: 'Forge', OR: 'Crux', STAFFING: 'Root', IMAGING: 'Trace', BLOODBANK: 'Void', EMS: 'Orbit', COORDINATOR: 'Prism' }
  const say = (from, to, kind, text, pids = [], how = 'live', ctx = {}) => {
    if (how === 'live' && MODE === 'replay') how = 'replay'
    if (how in answers && from in PERSONA) answers[how]++
    return emit('agent.message', { msg_id: `m${++S.counters.MSG}`, from, to, kind, text, pids, how, persona: PERSONA[from] || null }, ctx)
  }

  function statusText(d, st) {
    const bits = [st.line]
    if (st.can_free?.length) bits.push(`I can free ${st.can_free.map((c) => c.pid).join(', ')}.`)
    if (st.needs?.length) bits.push(`Need: ${st.needs.join(', ')}.`)
    if (st.blockers?.length) bits.push(`Blocked: ${st.blockers.join('; ')}.`)
    return bits.join(' ').replace(/\.\./g, '.')
  }

  function startCycle(trigger) {
    cycleRunning = true
    S.lastCycle = S.clock
    const cycle_id = `cy${++S.counters.CY}`
    const t0 = performance.now()
    const tally = { applied: 0, held: 0, dropped: 0 }
    const C = (round) => ({ cycle_id, round })
    const q = []
    const add = (delay, fn) => q.push({ delay, fn })
    const front = (...items) => q.unshift(...items)
    const step = (delay, fn) => ({ delay, fn })

    add(250, () => emit('cycle.start', { cycle_id, trigger: S.pendingTrigger || trigger }, C('status')))
    S.pendingTrigger = null
    // round 1: all 8 departments compose their status in parallel
    add(200, () => DEPTS.forEach((d) => think(d, ['COORDINATOR'], C('status'))))
    const staleOne = chance(0.2) ? pick(DEPTS) : null
    const order = [...DEPTS].sort(() => rnd() - 0.5)
    for (const d of order) {
      add(350 + Math.floor(rnd() * 550), () => {
        const st = deptStatus(d)
        if (d === staleOne) st.stale = true
        emit('agent.status', st, C('status'))
        say(d, ['COORDINATOR'], 'status', statusText(d, st), (st.can_free || []).map((c) => c.pid), st.stale ? 'fallback' : 'live', C('status'))
      })
    }

    // round 1b: questions, including department-to-department
    add(300, () => {
      const icuNeed = waitingList().find((p) => targetFor(p) === 'ICU')
      const imp = S.units.ICU.occupants.map((pid) => S.patients[pid]).find((p) => p.improving && !p.locked)
      const Q = C('question')
      if (imp) {
        const ask1 = icuNeed ? `${icuNeed.pid} needs an ICU bed and you're at ${occ('ICU')}/${S.units.ICU.beds}. Can ${imp.pid} step down now?` : `Can ${imp.pid} step down to free an ICU bed for the next critical arrival?`
        front(
          step(250, () => think('COORDINATOR', ['ICU'], Q)),
          step(900, () => {
            emit('coordinator.question', { unit: 'ICU', question: ask1 }, Q)
            say('COORDINATOR', ['ICU'], 'ask', ask1, [icuNeed?.pid, imp.pid].filter(Boolean), 'live', Q)
          }),
          step(200, () => think('ICU', ['COORDINATOR'], Q)),
          step(1000, () => {
            const ans = `Yes. ${imp.pid} has been improving for 6h. I'll check step-down has a bed.`
            emit('agent.answer', { unit: 'ICU', answer: ans }, Q)
            say('ICU', ['COORDINATOR'], 'reply', ans, [imp.pid], 'live', Q)
          }),
          step(200, () => think('ICU', ['STEPDOWN'], Q)),
          step(900, () => say('ICU', ['STEPDOWN'], 'ask', `Can you take ${imp.pid} in the next 15 min?`, [imp.pid], 'live', Q)),
          step(200, () => think('STEPDOWN', ['ICU'], Q)),
          step(1000, () => {
            const ready = S.units.STEPDOWN.occupants.map((pid) => S.patients[pid]).find((p) => p.ready && !p.locked)
            const f = free('STEPDOWN')
            const txt = f > 0
              ? `Yes, ${f} bed${f > 1 ? 's' : ''} open now. Send ${imp.pid} over.`
              : ready
                ? `Full right now. Once ${ready.pid} goes to the ward, yes.`
                : 'Full, and nobody is ready for the ward yet. Not in 15 min.'
            say('STEPDOWN', ['ICU'], 'reply', txt, [imp.pid, ready?.pid].filter(Boolean), 'live', Q)
          }),
        )
      } else if (S.off_duty_nurses > 0) {
        front(
          step(250, () => think('COORDINATOR', ['STAFFING'], Q)),
          step(900, () => {
            const t = 'How fast can extra nurses reach the ICU?'
            emit('coordinator.question', { unit: 'STAFFING', question: t }, Q)
            say('COORDINATOR', ['STAFFING'], 'ask', t, [], 'live', Q)
          }),
          step(200, () => think('STAFFING', ['COORDINATOR'], Q)),
          step(900, () => {
            const t = `${S.off_duty_nurses} off duty. A call-in takes 45 min and needs staff approval.`
            emit('agent.answer', { unit: 'STAFFING', answer: t }, Q)
            say('STAFFING', ['COORDINATOR'], 'reply', t, [], 'live', Q)
          }),
        )
      }
    })

    // round 2: the plan, then per-department instructions, acks and objections
    add(250, () => think('COORDINATOR', ['ALL'], C('plan')))
    add(1300, () => {
      const P = C('plan')
      const plan = buildPlan()
      emit('coordinator.plan', plan, P)
      say('COORDINATOR', ['ALL'], 'plan', plan.summary, plan.moves.map((m) => m.pid), 'live', P)
      // what each department is told
      const told = {}
      const line = (d, txt, pid) => {
        told[d] = told[d] || { lines: [], pids: [] }
        told[d].lines.push(txt)
        if (pid) told[d].pids.push(pid)
      }
      for (const m of plan.moves) {
        const p = S.patients[m.pid]
        const fromA = p?.unit ? agentFor(p.unit) : null
        const toA = m.to_unit === 'HOME' || m.to_unit === 'PARTNER' ? null : agentFor(m.to_unit)
        if (fromA && fromA !== toA) line(fromA, `send ${m.pid} to ${UNIT_NAME[m.to_unit] || m.to_unit}`, m.pid)
        if (toA) line(toA, fromA === toA ? `move ${m.pid} to ${UNIT_NAME[m.to_unit]}` : `take ${m.pid}${p?.unit ? ` from ${UNIT_NAME[p.unit]}` : ' from the waiting room'}`, m.pid)
        if (p?.needs_ct && !fromA) line('IMAGING', `scan ${m.pid} before the move if you can`, m.pid)
      }
      for (const e of plan.escalations) {
        if (e.action === 'cancel_elective') line('OR', 'I am asking staff to cancel tonight\'s electives so PACU can take ICU overflow')
        if (e.action === 'call_in_staff') line('STAFFING', 'I am asking staff to approve calling in 2 nurses')
      }
      const depts = Object.keys(told)
      const objector = told.OR && plan.escalations.some((e) => e.action === 'cancel_elective') ? 'OR' : (told.STEPDOWN?.pids.length || 0) >= 3 ? 'STEPDOWN' : null
      const steps2 = depts.map((d) =>
        step(380, () => {
          const t = told[d]
          const txt = t.lines.join('; ')
          say('COORDINATOR', [d], 'plan', txt.charAt(0).toUpperCase() + txt.slice(1) + '.', t.pids, 'live', P)
        }),
      )
      steps2.push(step(200, () => depts.forEach((d) => think(d, ['COORDINATOR'], P))))
      for (const d of depts) {
        steps2.push(
          step(400 + Math.floor(rnd() * 450), () => {
            const t = told[d]
            if (d === objector) {
              const txt = d === 'OR'
                ? 'Objection: the first elective patient is already prepped. I would cancel only the later case. Staff decide.'
                : `Objection: taking ${t.pids.length} transfers at once puts us at 1:${Math.ceil((occ('STEPDOWN') + t.pids.length) / Math.max(1, S.units.STEPDOWN.nurses))} nursing until the call-in lands.`
              say(d, ['COORDINATOR'], 'object', txt, t.pids, 'live', P)
            } else {
              const txt = t.pids.length
                ? pick([`Got it. Bed ready for ${t.pids[0]} in about 5 min.`, `On it: ${t.pids.join(', ')}.`, `Confirmed. Porter called for ${t.pids[0]}.`])
                : 'Understood.'
              say(d, ['COORDINATOR'], 'ack', txt, t.pids, chance(0.8) ? 'live' : 'stub', P)
            }
          }),
        )
      }
      // then the rule-keepers apply it
      const A = C('apply')
      const applySteps = plan.moves.map((m) => step(420, () => { tally[tryMove(m, 'swarm', A)]++ }))
      const escSteps = plan.escalations.map((e) =>
        step(380, () => {
          const extra = APPROVAL_DETAIL[e.action]?.() || { params: {}, detail: '' }
          const a = { approval_id: `A${++S.counters.APR}`, action: e.action, level: S.level, reason: e.reason, params: extra.params, detail: extra.detail, created_at: S.clock, sentence: APPROVAL_SENTENCE[e.action] || null }
          S.approvals.push(a)
          emit('approval.requested', { approval_id: a.approval_id, action: a.action, reason: a.reason, detail: a.detail, sentence: a.sentence }, A)
          say('ESCALATION', ['COORDINATOR'], 'system', `Asked staff to approve: ${e.action === 'cancel_elective' ? 'cancel planned surgery' : e.action === 'call_in_staff' ? 'call in 2 nurses' : e.action.replace(/_/g, ' ')}. ${e.reason}.`, [], 'code', A)
        }),
      )
      const fallback = step(350, () => {
        for (const p of waitingList().slice(0, 2)) {
          const to = targetFor(p)
          if (free(to) > 0) tally[tryMove({ pid: p.pid, to_unit: to }, 'fallback', A)]++
        }
      })
      const end = step(300, () => {
        cycleMs.push(performance.now() - t0)
        emit('cycle.end', { cycle_id, ...tally, ms: Math.round(performance.now() - t0) }, { cycle_id, round: null })
        cycleRunning = false
        updateLevel()
      })
      q.push(...steps2, ...applySteps, ...escSteps, fallback, end)
    })
    steps = q
    stepAcc = 0
  }

  // ---------- scheduler ----------
  function loop() {
    if (S.paused) return
    const dt = 100
    minuteAcc += dt
    const msPerMin = 1000 / S.speed
    while (minuteAcc >= msPerMin) {
      minuteAcc -= msPerMin
      advanceMinute()
    }
    if (steps.length) {
      stepAcc += dt * S.speed
      while (steps.length && stepAcc >= steps[0].delay) {
        stepAcc -= steps[0].delay
        const s = steps.shift()
        s.fn()
      }
    }
  }

  // ---------- REST ----------
  async function handle(method, path, body = {}) {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180)) // feel like a network
    const m = (re) => path.match(re)
    let mm
    if (method === 'GET' && path === '/api/state') return snapshot()
    if (method === 'POST' && path === '/api/surge') return body?.kind === 'busy' ? busyNight() : surge(body?.n || 25)
    if (method === 'POST' && path === '/api/radio') return parseRadio(body?.text || '')
    if (method === 'POST' && (mm = m(/^\/api\/radio\/([^/]+)\/confirm$/))) return confirmDraft(decodeURIComponent(mm[1]))
    if (method === 'POST' && (mm = m(/^\/api\/approvals\/([^/]+)$/))) return resolveApproval(decodeURIComponent(mm[1]), !!body?.approve)
    if (method === 'POST' && (mm = m(/^\/api\/holds\/([^/]+)\/resolve$/))) return resolveHold(decodeURIComponent(mm[1]), body?.outcome)
    if (method === 'POST' && path === '/api/control') return control(body || {})
    if (method === 'GET' && (mm = m(/^\/api\/patient\/([^/]+)$/))) return patientDetail(decodeURIComponent(mm[1]))
    if (method === 'GET' && path === '/api/compare') return COMPARE
    if (method === 'GET' && path === '/api/results') return results()
    throw new Error(`mock: no route for ${method} ${path}`)
  }

  function parseRadio(text) {
    const t = text.toLowerCase()
    if (!t.trim()) throw new Error('Radio text is empty. Type what EMS reported, e.g. "bus crash, 12 patients, 3 critical, 10 min out".')
    const num = (re) => {
      const x = t.match(re)
      return x ? parseInt(x[1], 10) : null
    }
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1 }
    const wnum = (re) => {
      const x = t.match(re)
      return x ? words[x[1]] ?? null : null
    }
    let count = num(/(\d+)\s*(?:patients|pts|victims|casualties|people|injured)/) ?? wnum(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a)\s+(?:patients?|victims?|casualt)/) ?? num(/(\d+)/) ?? 1
    count = Math.max(1, Math.min(30, count))
    const critical = Math.min(count, num(/(\d+)\s*(?:critical|crit|red|serious)/) ?? (t.includes('critical') ? 1 : 0))
    const eta = num(/(\d+)\s*(?:min|mins|minutes)/) ?? 10
    const kind = t.includes('fire') || t.includes('smoke') ? 'smoke inhalation'
      : t.includes('crash') || t.includes('mvc') || t.includes('collision') ? 'MVC injuries'
      : t.includes('shoot') || t.includes('gsw') ? 'penetrating trauma'
      : t.includes('fall') ? 'fall injuries'
      : t.includes('overdose') ? 'overdose'
      : 'injuries, unspecified'
    const patients = []
    for (let i = 0; i < count; i++) {
      const sev = i < critical ? (i % 2 === 0 ? 1 : 2) : [3, 3, 4, 3, 5, 4][i % 6]
      patients.push({ complaint: i < critical ? `${kind}, critical` : kind, severity: sev, eta: eta + Math.floor(i / 4) })
    }
    const draft_id = `D${++S.counters.D}`
    S.drafts[draft_id] = patients
    return { draft_id, patients }
  }

  function confirmDraft(id) {
    const d = S.drafts[id]
    if (!d) throw new Error(`Draft ${id} was not found or was already confirmed`)
    delete S.drafts[id]
    for (const x of d) mkPatient('RD', { severity: x.severity, complaint: x.complaint, state: 'incoming', eta: x.eta, needs_ct: x.severity <= 2 })
    emit('notice', { text: `Radio report confirmed: ${d.length} incoming added` })
    return { incoming: d.length }
  }

  function resolveApproval(id, approve) {
    const a = S.approvals.find((x) => x.approval_id === id)
    if (!a) throw new Error(`Approval ${id} is no longer pending`)
    S.approvals = S.approvals.filter((x) => x !== a)
    emit('approval.resolved', { approval_id: id, approved: approve })
    if (approve) {
      if (a.action === 'cancel_elective') {
        S.or_cases = S.or_cases.map((c) => (c.kind === 'elective' && c.status === 'scheduled' ? { ...c, status: 'cancelled' } : c))
        S.pacuOverflow = true
        emit('notice', { text: `Electives ${(a.params?.case_ids || []).join(', ')} cancelled. PACU open as ICU overflow` })
      }
      if (a.action === 'call_in_staff') {
        S.calledIn = true
        S.off_duty_nurses = Math.max(0, S.off_duty_nurses - 2)
        S.nurseArrivals.push({ at: S.clock + 45 })
        emit('notice', { text: '2 nurses called in, arrive in 45 min' })
      }
      scheduleCycleSoon(`approved: ${a.action.replace(/_/g, ' ')}`)
    }
    return { ok: true }
  }

  function resolveHold(id, outcome) {
    const h = S.holds.find((x) => x.hold_id === id)
    if (!h) throw new Error(`Hold ${id} is no longer open`)
    if (outcome !== 'proceed' && outcome !== 'cancel') throw new Error('outcome must be proceed or cancel')
    const p = S.patients[h.pid]
    S.holds = S.holds.filter((x) => x !== h)
    resolvedHolds++
    emit('hold.resolved', { hold_id: id, pid: h.pid, outcome })
    if (outcome === 'proceed') {
      place(p, h.to_unit, 'swarm', h.because, {})
      p.note = 'A person checked both records and approved the move'
      p.note_by = 'A person (after checking the records)'
      return { ok: true, detail: `${h.pid} moved to ${h.to_unit} after staff review` }
    }
    S.units[h.to_unit].reserved_for = S.units[h.to_unit].reserved_for.filter((x) => x !== h.pid)
    p.locked = false
    p.state = p.unit ? 'placed' : 'waiting'
    p.heading_to = null
    p.note = 'A person decided to keep them where they are'
    p.note_by = 'A person'
    return { ok: true, detail: `Reserved ${h.to_unit} bed released. ${h.pid} ${p.unit ? `stays in ${p.unit}` : 'is back in the queue'}` }
  }

  function control(b) {
    if (b.action === 'pause') S.paused = true
    else if (b.action === 'resume') S.paused = false
    else if (b.action === 'speed') {
      if (![1, 2, 5].includes(b.speed)) throw new Error('speed must be 1, 2 or 5')
      S.speed = b.speed
      S.paused = false
    } else if (b.action === 'reset') {
      if (b.key !== 'demo') throw new Error('Reset needs the demo key')
      resetWorld()
      minuteAcc = 0
      for (const k in answers) answers[k] = 0
      cycleMs.length = 0
      resolvedHolds = 0
    } else throw new Error(`unknown control action ${b.action}`)
    emitSnapshot()
    return { ok: true }
  }

  function results() {
    const all = allPatients()
    const planted = all.filter((p) => p.conflicts.length && !p.pid.startsWith('IN'))
    const arrived = planted.filter((p) => p.state !== 'incoming')
    const bucket = (sevs) => {
      const xs = all.filter((p) => sevs.includes(p.severity) && p.bedWait != null).map((p) => p.bedWait)
      return { patients: xs.length, avg_min: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0, max_min: xs.length ? Math.max(...xs) : 0 }
    }
    return {
      time_to_bed: { 1: bucket([1]), 2: bucket([2]), 3: bucket([3]), '4-5': bucket([4, 5]) },
      records: {
        planted: planted.length,
        on_arrived_patients: arrived.length,
        caught_before_moving: arrived.filter((p) => p.records_flag).length,
        waiting_for_a_human: S.holds.length,
        resolved_by_a_human: resolvedHolds,
        extra_flags: 0,
      },
      agents: {
        mode: MODE,
        cycles: S.counters.CY,
        avg_cycle_seconds: cycleMs.length ? Math.round(cycleMs.reduce((a, b) => a + b, 0) / cycleMs.length / 100) / 10 : 0,
        answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v > 0)),
        agents: 9,
      },
      note: 'Practice data from the in-browser mock.',
    }
  }

  function patientDetail(pid) {
    const p = S.patients[pid]
    if (!p) throw new Error(`No patient ${pid}`)
    const hold = S.holds.find((h) => h.pid === pid) || null
    const facts = Object.keys(p.records[0].claims)
    const disagree = facts.some((f) => p.records[0].claims[f].value !== p.records[1].claims[f].value)
    return {
      patient: publicPatient(p),
      sources: p.records,
      last_move: p.last_move,
      hold,
      notice: disagree ? 'sources disagree; a human must resolve' : null,
    }
  }

  resetWorld()

  return {
    subscribe(fn) {
      listeners.add(fn)
      fn({ id: ++seq, type: 'snapshot', clock: S.clock, cycle_id: null, round: null, data: snapshot() })
      return () => listeners.delete(fn)
    },
    start() {
      if (!interval) interval = setInterval(loop, 100)
    },
    stop() {
      clearInterval(interval)
      interval = null
    },
    handle,
  }
}

export const LEVEL_NAMES = ['NORMAL', 'MAKE ROOM', 'STRETCH', 'DIVERT', 'CRISIS']

const COMPARE = {
  seeds: [7, 11, 23],
  arms: [
    { arm: 'greedy', label: 'Every department for itself', avg_wait: 38.1, longest_wait: 140, critical_over_10: 4, hallway_minutes: 0, held: 0 },
    { arm: 'ladder', label: 'Greedy + escalation rules', avg_wait: 29.4, longest_wait: 96, critical_over_10: 2, hallway_minutes: 85, held: 0 },
    { arm: 'swarm', label: 'Hospital Swarm', avg_wait: 27.8, longest_wait: 88, critical_over_10: 1, hallway_minutes: 60, held: 3 },
  ],
}
