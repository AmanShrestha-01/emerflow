# Emer Flow · Hospital Swarm: the backend ↔ frontend contract

This is the one shape both halves agree on. The backend runs at `http://localhost:8000`, and every route below starts with `/api`.
All times are **simulated minutes** (`clock`). One simulated minute passes per real second at 1x.

## Fixed vocabulary
- **Units:** `RESUS`, `ER`, `HALLWAY`, `ICU`, `STEPDOWN`, `WARD`, `OR`, `PACU`, `LOUNGE`. Off-site destinations: `HOME`, `PARTNER`.
- **Patient states:** `incoming`, `waiting`, `placed`, `held`, `discharged`, `transferred`
- **Facts** (the `because` lists): `anticoagulant`, `penicillin_allergy`, `vitals_stable`, `icu_need`, `on_pressors`, `blood_type`
- **Levels:** `0 NORMAL`, `1 MAKE ROOM`, `2 STRETCH`, `3 DIVERT`, `4 CRISIS`
- **Agents** (the `unit` field in agent events):
  - Departments: `ER`, `ICU`, `STEPDOWN`, `OR`, `STAFFING`, `IMAGING`, `BLOODBANK`, `EMS`
  - The coordinator is `COORDINATOR`
  - Rule-keepers (code, not AI): `FASTLANE`, `VALIDATOR`, `DEEPCHART`, `ESCALATION`

## REST
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/state` | | `State` (below) |
| GET | `/api/events` | | Server-Sent Events stream of `Event` |
| POST | `/api/surge` | `{"kind": "bus"}` for 25 bus-crash patients, or `{"kind": "busy"}` for a busy night (about 3× more everyday arrivals for 60 min). Optional `"n"` for bus | `{"incoming": 25}` or `{"busy_until": 160}` |
| POST | `/api/radio` | `{"text": "bus crash, 12 patients, 3 critical, 10 min out"}` | `{"draft_id": "D1", "patients": [{"complaint","severity","eta"}]}` |
| POST | `/api/radio/{draft_id}/confirm` | | `{"incoming": n}` |
| POST | `/api/approvals/{approval_id}` | `{"approve": true}` | `{"ok": true}` |
| POST | `/api/holds/{hold_id}/resolve` | `{"outcome": "proceed" \| "cancel"}` | `{"ok": true, "detail": "..."}` |
| POST | `/api/control` | `{"action": "pause" \| "resume" \| "speed" \| "reset", "speed": 1 \| 2 \| 5, "key": "demo"}` | `{"ok": true}` |
| GET | `/api/patient/{pid}` | | `PatientDetail` |
| GET | `/api/compare` | | `Compare` |

### State
```json
{
  "clock": 42, "version": 318, "level": 2, "level_name": "STRETCH", "diversion": false,
  "paused": false, "speed": 1, "mode": "stub", "busy_until": null,
  "units": [{"unit": "ICU", "beds": 10, "occupied": 9, "reserved": 1, "percent": 100, "nurses": 5,
             "occupants": ["IN-10"], "reserved_for": ["MC-03"]}],
  "patients": [{"pid": "MC-03", "name": "Lena Cho", "age": 54, "complaint": "head injury, confused",
                "severity": 2, "state": "held", "unit": null, "waited": 7, "eta": null,
                "needs_ct": true, "needs_blood": false, "retriage": false, "records_flag": false, "locked": true}],
  "ct_queue": ["MC-03"], "blood": {"O-": 8}, "or_cases": [], "partners": {"Mercy General": 4},
  "off_duty_nurses": 6,
  "holds": [{"hold_id": "H12", "pid": "MC-03", "to_unit": "ICU", "because": ["icu_need", "anticoagulant"],
             "created_at": 40,
             "conflicts": [{"fact": "anticoagulant", "reason": "one source records it, the other explicitly records none",
                            "versions": [{"source_name": "Local intake", "recorded_date": "2026-09-19",
                                          "value": "none recorded", "status": "absent",
                                          "resource_id": "MedicationStatement/loc-MC-03-ac"},
                                         {"source_name": "Hospital B - Cardiology", "recorded_date": "2026-03-02",
                                          "value": "warfarin 5mg", "status": "active",
                                          "resource_id": "MedicationStatement/hb-MC-03-ac"}]}]}],
  "approvals": [{"approval_id": "A4", "action": "cancel_elective", "level": 2,
                 "reason": "PACU needed as ICU overflow", "params": {"case_ids": ["C3", "C4"]},
                 "detail": "frees 2 PACU beds", "created_at": 38}],
  "metrics": {"avg_wait": 12.4, "longest_wait": 31, "critical_waiting": 1, "hallway": 3,
              "held": 2, "diverted": 0, "placed": 20, "waiting": 5},
  "feed": [ /* last ~200 Events, oldest first */ ]
}
```

**Patient rows also carry** (added for the patient-first board):
- `need`: the triage note, in plain words, e.g. "Emergency surgery", "Heart and lung monitoring (ICU)", "Treat in the ER, then home".
- `needs_surgery`: a bool.
- `note`: why the patient is where they are, e.g. "Life-threatening: straight to resuscitation".
- `note_by`: who decided. One of `Fast lane (code)`, `Agent plan`, `Fallback (code)`, `Rules (code)`, `Records check (code)`, `A human`, `A human (records checked)`.
- `heading_to`: the target unit of a paused (held) move, otherwise `null`.

Trauma cases (gunshot, stab wound, internal bleeding) go Resus → OR → Recovery/ICU → Ward.

### Event (SSE `data:` line, JSON)
```json
{"id": 57, "type": "agent.status", "clock": 41, "cycle_id": "cy7", "round": "status",
 "data": {"unit": "ICU", "line": "1 bed left, holding it for critical patients", "free_now": 1,
          "can_free": [{"pid": "IN-10", "to_unit": "STEPDOWN", "ready_in_min": 12, "why": "improving"}],
          "needs": ["1 nurse"], "blockers": [], "stale": false}}
```
| type | data |
|---|---|
| `snapshot` | the full `State`. Sent first on connect; replace everything |
| `tick` | `{clock, level}`, once per simulated minute |
| `patient.arrived` | `{pid, severity, complaint}` |
| `level.changed` | `{old, new, name}` |
| `cycle.start` | `{cycle_id, trigger}` |
| `agent.status` | `{unit, line, free_now, can_free[], needs[], blockers[], stale}` |
| `coordinator.question` | `{unit, question}` |
| `agent.answer` | `{unit, answer}` |
| `coordinator.plan` | `{summary, moves:[{pid,to_unit,kind,reason}], escalations:[{action,reason}]}` |
| `move.applied` | `{move_id, pid, from_unit, to_unit, source, because[]}`. `source` is `fastlane`, `swarm` or `fallback` |
| `move.held` | `{hold_id, pid, to_unit, because[], conflicts[]}`. DeepChart stopped it |
| `move.flagged` | `{pid, to_unit, conflicts[]}`. Life-saving placement went ahead, but the records disagree |
| `move.dropped` | `{pid, to_unit, reason}`. The validator rejected it |
| `approval.requested` | `{approval_id, action, reason, detail}` |
| `approval.resolved` | `{approval_id, approved}` |
| `hold.resolved` | `{hold_id, pid, outcome}` |
| `retriage.flag` | `{pid, waited}` |
| `cycle.end` | `{cycle_id, applied, held, dropped, ms}` |
| `notice` | `{text}`: miscellaneous human-readable lines, e.g. "2 nurses called in, arrive in 45 min" |
| `agent.thinking` | `{from, to}`. An agent has started composing a message (a Gemini call is in flight). Show "ICU is typing…" until a `agent.message` from the same `from` arrives in this cycle |
| `agent.message` | `{msg_id, from, to[], kind, text, pids[], how}`. One utterance in the swarm conversation |

### The swarm conversation (`agent.message`)
- **`from`** and **`to`** use agent names: the 8 departments, `COORDINATOR`, and the rule-keepers `VALIDATOR`, `DEEPCHART`, `FASTLANE`, `ESCALATION`. `to: ["ALL"]` is a broadcast.
- **`kind`** values:

  | kind | meaning |
  |---|---|
  | `status` | a department reports to the coordinator |
  | `ask` | a question, coordinator → department or department → department |
  | `reply` | an answer to an ask |
  | `plan` | the coordinator tells a department what it will do. One message per affected department, plus one `ALL` summary |
  | `ack` | a department confirms its part of the plan |
  | `object` | a department raises a concern. Code still decides |
  | `system` | a rule-keeper speaks: validator rejections, DeepChart holds, escalation requests |

- **`how`:** `live` means Gemini wrote it, `stub` or `fallback` mean the rules wrote it, and `code` means the text is a fixed template.
- **`pids`** lists the patients mentioned, so the UI can link them.

A typical cycle reads:
1. 8 × `status`
2. COORDINATOR → ICU `ask`, then ICU → COORDINATOR `reply`
3. ICU → STEPDOWN `ask`, then STEPDOWN → ICU `reply`
4. COORDINATOR → ALL `plan`, then COORDINATOR → each department `plan`
5. `ack`/`object` from those departments
6. `system` lines from VALIDATOR and DEEPCHART.

The `round` field is `status`, `question`, `plan`, `apply`, or `null` for events outside a cycle.

### PatientDetail
```json
{"patient": { /* patient row */ }, "sources": [{"source_name", "recorded_date",
  "claims": {"anticoagulant": {"value", "status", "resource_id"}}}],
 "last_move": {"to_unit", "because": [], "source"}, "hold": { /* hold or null */ },
 "notice": "sources disagree; a human must resolve"}
```

### Compare
```json
{"seeds": [7, 11, 23], "arms": [
  {"arm": "greedy", "label": "Every department for itself", "avg_wait": 38.1, "longest_wait": 140,
   "critical_over_10": 4, "hallway_minutes": 0, "held": 0},
  {"arm": "ladder", "label": "Greedy + escalation rules", ...},
  {"arm": "swarm", "label": "Hospital Swarm", ...}]}
```

## Safety copy (UI must follow)
- **Held patients** show exactly `VERIFICATION REQUIRED` and `sources disagree; a human must resolve`.
- **Never show which record is correct.** Never show a clinical instruction.
- **Rule-keeper lines** (`FASTLANE`, `VALIDATOR`, `DEEPCHART`, `ESCALATION`) must look different from AI agent lines.

---

# Results, audit and replay (Hospital Swarm)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/results` | `Results` (below): headline numbers measured on this run |
| GET | `/api/audit` | `[AuditRow]`: every decision, oldest first |
| GET | `/api/audit.csv` | the same rows as a CSV download (`emerflow-audit.csv`) |

### Results
```json
{"time_to_bed": {"1": {"patients": 3, "avg_min": 0.0, "max_min": 0}, "2": {...}, "3": {...}, "4-5": {...}},
 "records": {"planted": 11, "on_arrived_patients": 9, "caught_before_moving": 8, "waiting_for_a_human": 3,
             "resolved_by_a_human": 2, "extra_flags": 0},
 "agents": {"mode": "live", "cycles": 6, "avg_cycle_seconds": 14.2, "answers": {"live": 88, "fallback": 2}, "agents": 10},
 "note": "Measured on this run. Record conflicts are planted by us, so 'caught' is checked against a known answer key."}
```
`caught_before_moving` counts planted mistakes that the records check held or flagged before a patient moved.

### AuditRow
`{"time": "21:42", "clock": 42, "round": "cy7", "event": "move.held", "patient": "MC-06", "from": "", "to": "ICU",
  "decided_by": "Records check (code)", "relied_on": "icu_need, anticoagulant",
  "records_disagree": "anticoagulant: Local intake=none recorded vs Hospital B - Cardiology=warfarin 5mg",
  "detail": "paused: sources disagree; a human must resolve"}`

`decided_by` is one of:
- `Fast lane (code)`
- `Agent plan (Gemini)`
- `Fallback (code)`
- `Validator (code)`
- `Records check (code)`
- `Escalation (code)`
- `Coordinator (Gemini | replay | stub | fallback)`
- `Human`

### Modes
`state.mode` is one of:
- `live`: Gemini answering now.
- `replay`: a recorded live Gemini run played back, with no network needed. Each answer's `how` is `replay`.
- `stub`: rule-based answers only.
- `fallback`: Gemini unavailable; rule-based answers.

### Board → DeepChart handoff
"Compare records" on a held patient links to `/doctor?pid=<pid>&hold=<hold_id>`, the DeepChart chart for that patient. A doctor resolves the hold there (`POST /api/holds/{id}/resolve`) and returns to the board.

# DeepChart portal (built; spec in `09-deepchart-portal-spec.md`)

Everything above stays valid, and the board routes stay open (no session needed). The portal adds the routes below.
They reuse the existing `Conflict` shape (`{fact, reason, versions:[{source_name, recorded_date, value, status, resource_id}]}`).

**Demo hospitals** (`GET /api/hospitals`):
- `Emer Flow General` is the board hospital. Its records are the existing `Local intake` source.
- `Hospital B` holds the existing `Hospital B - Cardiology` source, plus three patients of its own (`HB-01..03`) that it can transfer.
- `Hospital C` holds `Hospital C - Primary care` records: a real one for about a third of the patients, and a **lookalike** (same name, birth date and sex, but a different person) for every patient with a planted conflict.

Source names are unchanged from the board. Render `source_name` as given.

## Sessions and roles
- `POST /api/login` with `{"hospital", "role": "doctor" | "commander", "pin"}` returns `{"token", "hospital", "role"}`. The PIN is `EMERFLOW_DEMO_KEY` (default `demo`).
- Send `X-Session: <token>` on portal calls. No session gets a `401`. The wrong role, the wrong hospital, a wrong PIN, or no reason for access gets a `403`.
- Portal routes are for `doctor` only. `Hospital B` doctors can only list and transfer their own patients. Only `Emer Flow General` doctors can open board patients.

## REST
| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/login` | see above | `{token, hospital, role}` |
| GET | `/api/hospitals` | | `[{"name"}]` |
| GET | `/api/portal/patients` | | Emer Flow General: patient rows plus `conflicts` and `held`, with held patients first. Hospital B: its own patients |
| GET | `/api/lookup` | `?pid=MC-03&reason=er`, or `?name=&dob=&sex=&phone4=&reason=` | `{"query", "candidates": [Candidate]}` |
| POST | `/api/lookup/confirm` | `{"pid", "record_ref", "same_person": bool, "reason"}` | `{"ok": true, "linked": bool}` |
| GET | `/api/chart/{pid}` | `?reason=er` | `Chart` |
| POST | `/api/chart/{pid}/resolve` | `{"hold_id", "outcome": "proceed" \| "cancel", "reason": "er"}` | `{"ok", "detail", "outcome", "to_unit"}`. The same `resolve_hold` as `POST /api/holds/{id}/resolve`, but logged as a doctor action with its reason |
| POST | `/api/orders` | `{"pid", "text", "because": [fact]}` | `{"order_id", "status": "saved" \| "needs_ack", "warnings": [Conflict]}` |
| POST | `/api/orders/{order_id}/ack` | `{"reason"}` (must not be empty) | `{"order_id", "status": "saved"}` |
| POST | `/api/transfers` | `{"pid": "HB-01", "to_hospital": "Emer Flow General"}` (Hospital B only) | `{"transfer_id", "pid": "TR-01"}` |
| GET | `/api/inbox` | | `[{"transfer_id", "pid", "name", "from_hospital", "to_hospital", "at", "conflicts", "from_pid"}]` |
| GET | `/api/access-log/{pid}` | | `[{"at", "clock", "pid", "hospital", "role", "action", "public", "reason"}]` |
| POST | `/api/patient-link` | `{"pid"}` | `{"token", "path": "/p/<token>"}` |
| GET | `/api/p/{token}` | no session | `PatientView` |
| GET | `/api/deepchart/score` | no session | precision and recall against the answer key (records and identity) |

`reason` is one of `er` (Treating in the ER), `admit`, `transfer`, `consult`.

**Deep link from the board:** `/doctor?pid=MC-03&hold=H12` opens that patient's chart with the reason preset to `er`.
With no session, the login is prefilled (Emer Flow General, doctor). `&pin=demo` logs in automatically, for the demo.

**Rules:**
- Nothing links to a patient without a human. `confirm` with `same_person: true` appends the record to `Patient.sources`. `false` hides it from later lookups, and it also unlinks the record if it was already linked (logged).
- Acknowledging an order adds its facts to `Patient.verified`, the same as resolving a hold with `proceed`.
- A transfer creates a board patient `TR-xx` (incoming in 8 min) with both records, and plants one `anticoagulant` conflict in the answer key.

### Candidate
```json
{"record_ref": "Hospital C/pcx-MC-03", "hospital": "Hospital C", "source_name": "Hospital C - Primary care",
 "recorded_date": "2025-06-01", "name": "Lena Cho", "dob": "1972-03-02", "sex": "F",
 "match": "strong" | "possible", "differs": ["phone4", "insurance_id", "address"],
 "linked": false, "confirmed": false, "facts": 3}
```
A `possible` match is an identity conflict. The UI says: `Is this the same person? A human must decide.`

### Chart
```json
{"patient": { /* patient row */ }, "hospital": "Emer Flow General", "identity": {"name", "dob", "sex", "phone4", "insurance_id", "address"},
 "sources": [{"source_name", "recorded_date", "hospital"}],
 "facts": [{"fact", "kind": "conflict" | "agree" | "gap", "reason", "versions": [...], "missing_from": [source_name],
            "verified_by_human": bool}],
 "hold": { /* same shape as State.holds, or null */ }, "orders": [...],
 "notice": "sources disagree; a human must resolve"}
```
`facts` is ordered: conflicts first, then agree, then gap.

### PatientView
```json
{"first_name": "Lena", "status_line": "You're waiting for a bed. Staff are double-checking your records.",
 "access_log": [{"at", "hospital", "role", "action", "reason"}]}
```
`action` here is the patient-safe `public` text. It never contains facts, values, conflicts, or other patients.

## New events
| type | data |
|---|---|
| `record.linked` / `record.unlinked` | `{pid, record_ref, hospital, by_hospital}` |
| `transfer.received` | `{transfer_id, pid, from_hospital, to_hospital}` |
| `order.warning` | `{order_id, pid, because[], conflicts[]}` |
| `order.acknowledged` | `{order_id, pid, facts[]}`. The reason text stays in the access log |

These are not swarm messages. The board ignores them unless it chooses to show them.
