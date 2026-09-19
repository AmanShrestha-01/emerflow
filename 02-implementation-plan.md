# Concord Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hospital command board that holds a patient placement whenever the records the placement relied on disagree across sources, showing both versions with provenance.

**Architecture:** One long-lived FastAPI process holds all state in memory. A greedy allocator proposes a unit and declares which clinical facts it relied on (`because`). A crosscheck step verifies only those facts across the patient's 2–3 pretend source records using two Gemini calls, and returns conflicts with provenance. A single React page polls `GET /state` once per second and renders capacity bars, patient rows (green = committed, amber = held) and a conflict detail panel. Conflicts are planted by our own injector, which writes an answer key so precision/recall is measurable.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, pytest, google-genai (Gemini), React 18 + Vite. No database, no SimPy, no OR-Tools, no Neo4j, no websockets.

**Spec:** `docs/superpowers/specs/2026-09-18-concord-design.md`

## Global Constraints

- **Safety copy rule:** no output may state which value is correct, or recommend/refuse a placement. Held rows say exactly `VERIFICATION REQUIRED` and `sources disagree; a human must resolve`. Never render a phrase like "give 20mg" or "do not send to step-down".
- **Fact vocabulary is fixed and closed.** Exactly these five keys, spelled exactly: `anticoagulant`, `penicillin_allergy`, `icu_need`, `vitals_stable`, `active_diabetes`. No task may invent a sixth.
- **Unit names are fixed:** `ER`, `ICU`, `STEPDOWN`, `OR`.
- **Severity** is an int 1–5 (1 = most critical), matching the ESI scale.
- **All dates are ISO `YYYY-MM-DD` strings.** Never `datetime` objects in API payloads.
- **Every claim carries provenance:** `source_id`, `source_name`, `recorded_date`, `resource_id`. A claim without provenance is a bug.
- **Gemini must be stubbable.** `CONCORD_STUB=1` in the environment makes every LLM call return deterministic canned output so the demo runs with no network. Verify the stub path works before the demo.
- **No database, no ORM, no migrations.** State is Python objects plus JSON files under `data/`.
- **Frontend polls `GET /state` every 1000ms.** No websockets.
- **Commit after every task.** Hackathon rule: the first commit must be after kickoff.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/models.py` | Dataclasses only: `Claim`, `SourceRecord`, `Patient`, `Plan`, `Conflict`, `Verdict`. No logic. |
| `backend/sources.py` | Turn one Synthea bundle into 2–3 `SourceRecord`s of `Claim`s. |
| `backend/injector.py` | Plant conflicts across a patient's sources; emit the answer key. |
| `backend/hospital.py` | In-memory unit capacity; `commit()` / `hold()`; capacity snapshot. |
| `backend/allocator.py` | `propose(patient, hospital)` -> `Plan` with `because`. No AI. |
| `backend/gemini.py` | Thin LLM wrapper: prompt in, parsed JSON out. Stub mode. |
| `backend/crosscheck.py` | `verify(patient, facts)` -> `Verdict`. Two LLM calls. |
| `backend/departments.py` | One plain-English status line per unit. |
| `backend/patient_queue.py` | Arrival timer + `surge(n)` injection. |
| `backend/score.py` | Precision/recall of reported conflicts vs answer key. |
| `backend/main.py` | FastAPI app: `/state`, `/surge`, `/patient/{pid}`, `/score`, `/reset`. |
| `frontend/src/App.jsx` | Polls `/state`; renders bars, rows, detail panel. |
| `frontend/src/api.js` | `fetchState()`, `triggerSurge()`, `fetchPatient(pid)`. |
| `data/synthea/` | Downloaded Synthea FHIR bundles (gitignored). |
| `data/answer_key.json` | Ground truth written by the injector. |

---

## Task 1: Project skeleton

**Files:**
- Create: `backend/__init__.py`, `backend/main.py`, `requirements.txt`, `.gitignore`, `pytest.ini`
- Test: `tests/test_health.py`

**Interfaces:**
- Consumes: nothing
- Produces: a running FastAPI app object importable as `backend.main.app`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_health.py
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_health_returns_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend'`

- [ ] **Step 3: Create the files**

```
# requirements.txt
fastapi==0.115.0
uvicorn==0.30.6
pytest==8.3.3
httpx==0.27.2
google-genai==0.3.0
```

```
# .gitignore
__pycache__/
.venv/
data/synthea/
node_modules/
.env
```

```
# pytest.ini
[pytest]
pythonpath = .
testpaths = tests
```

```python
# backend/__init__.py
```

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Concord")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Install and run the test**

Run: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pytest -v`
Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git init
git add .
git commit -m "feat: project skeleton with health endpoint"
```

---

## Task 2: Core data models

**Files:**
- Create: `backend/models.py`
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Claim(fact: str, value: str, status: str, source_id: str, source_name: str, recorded_date: str, resource_id: str)`
  - `SourceRecord(source_id: str, source_name: str, recorded_date: str, claims: list[Claim])`
  - `Patient(pid: str, display_name: str, complaint: str, severity: int, sources: list[SourceRecord], unit: str | None = None, state: str = "waiting", plan: "Plan | None" = None, verdict: "Verdict | None" = None)`
  - `Plan(pid: str, unit: str, because: list[str])`
  - `ConflictVersion(source_name: str, recorded_date: str, value: str, status: str, resource_id: str)`
  - `Conflict(fact: str, versions: list[ConflictVersion], reason: str)`
  - `Verdict(conflicts: list[Conflict])` with property `has_conflicts -> bool`
  - `FACTS: tuple[str, ...]` and `UNITS: tuple[str, ...]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models.py
from backend.models import Claim, Conflict, ConflictVersion, Patient, Plan, SourceRecord, Verdict, FACTS, UNITS


def test_fact_vocabulary_is_closed():
    assert FACTS == (
        "anticoagulant",
        "penicillin_allergy",
        "icu_need",
        "vitals_stable",
        "active_diabetes",
    )
    assert UNITS == ("ER", "ICU", "STEPDOWN", "OR")


def test_claim_carries_provenance():
    c = Claim(
        fact="anticoagulant",
        value="warfarin 5mg",
        status="active",
        source_id="hospital_b",
        source_name="Hospital B - Cardiology",
        recorded_date="2026-02-04",
        resource_id="MedicationStatement/abc-123",
    )
    assert c.source_name == "Hospital B - Cardiology"
    assert c.resource_id == "MedicationStatement/abc-123"


def test_verdict_reports_whether_conflicts_exist():
    empty = Verdict(conflicts=[])
    assert empty.has_conflicts is False

    v = Verdict(conflicts=[
        Conflict(
            fact="anticoagulant",
            versions=[
                ConflictVersion("Hospital B", "2026-02-04", "warfarin 5mg", "active", "MedicationStatement/abc"),
                ConflictVersion("Local intake", "2026-09-18", "none", "absent", "MedicationStatement/xyz"),
            ],
            reason="one source records an active anticoagulant, the other explicitly records none",
        )
    ])
    assert v.has_conflicts is True
    assert len(v.conflicts[0].versions) == 2


def test_patient_defaults_to_waiting():
    p = Patient(pid="P-01", display_name="Patient 01", complaint="chest pain", severity=2, sources=[])
    assert p.state == "waiting"
    assert p.unit is None
    assert p.plan is None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.models'`

- [ ] **Step 3: Write the implementation**

```python
# backend/models.py
from __future__ import annotations

from dataclasses import dataclass, field

FACTS: tuple[str, ...] = (
    "anticoagulant",
    "penicillin_allergy",
    "icu_need",
    "vitals_stable",
    "active_diabetes",
)

UNITS: tuple[str, ...] = ("ER", "ICU", "STEPDOWN", "OR")


@dataclass
class Claim:
    fact: str
    value: str
    status: str  # "active" | "stopped" | "absent" | "present"
    source_id: str
    source_name: str
    recorded_date: str
    resource_id: str


@dataclass
class SourceRecord:
    source_id: str
    source_name: str
    recorded_date: str
    claims: list[Claim] = field(default_factory=list)


@dataclass
class Plan:
    pid: str
    unit: str
    because: list[str] = field(default_factory=list)


@dataclass
class ConflictVersion:
    source_name: str
    recorded_date: str
    value: str
    status: str
    resource_id: str


@dataclass
class Conflict:
    fact: str
    versions: list[ConflictVersion] = field(default_factory=list)
    reason: str = ""


@dataclass
class Verdict:
    conflicts: list[Conflict] = field(default_factory=list)

    @property
    def has_conflicts(self) -> bool:
        return len(self.conflicts) > 0


@dataclass
class Patient:
    pid: str
    display_name: str
    complaint: str
    severity: int
    sources: list[SourceRecord] = field(default_factory=list)
    unit: str | None = None
    state: str = "waiting"  # "waiting" | "committed" | "held"
    plan: Plan | None = None
    verdict: Verdict | None = None

    def claims_for(self, fact: str) -> list[Claim]:
        out: list[Claim] = []
        for s in self.sources:
            for c in s.claims:
                if c.fact == fact:
                    out.append(c)
        return out
```

- [ ] **Step 4: Run the test**

Run: `.venv/bin/pytest tests/test_models.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/models.py tests/test_models.py
git commit -m "feat: core data models with closed fact vocabulary"
```

---

## Task 3: Split Synthea bundles into pretend sources

**Files:**
- Create: `backend/sources.py`
- Test: `tests/test_sources.py`

**Interfaces:**
- Consumes: `Claim`, `SourceRecord`, `Patient`, `FACTS` from `backend.models`
- Produces:
  - `extract_claims(bundle: dict, source_id: str, source_name: str, recorded_date: str) -> list[Claim]`
  - `build_patient(bundle: dict, pid: str, complaint: str, severity: int) -> Patient` (creates 2 sources: `local` and `hospital_b`)
  - `SOURCE_DEFS: list[tuple[str, str]]`

**Note on data:** download `synthea_sample_data_fhir_r4` from https://synthea.mitre.org/downloads and unzip into `data/synthea/`. Use 20 bundles. Do not run the Synthea generator — it takes hours.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_sources.py
from backend.sources import build_patient, extract_claims

BUNDLE = {
    "entry": [
        {"resource": {
            "resourceType": "MedicationStatement",
            "id": "med-1",
            "status": "active",
            "medicationCodeableConcept": {"text": "Warfarin Sodium 5 MG Oral Tablet"},
        }},
        {"resource": {
            "resourceType": "AllergyIntolerance",
            "id": "alg-1",
            "code": {"text": "Penicillin G"},
        }},
        {"resource": {
            "resourceType": "Condition",
            "id": "con-1",
            "clinicalStatus": {"coding": [{"code": "active"}]},
            "code": {"text": "Diabetes mellitus type 2"},
        }},
    ]
}


def test_extract_claims_finds_anticoagulant():
    claims = extract_claims(BUNDLE, "local", "Local intake", "2026-09-18")
    facts = {c.fact: c for c in claims}
    assert "anticoagulant" in facts
    assert facts["anticoagulant"].status == "active"
    assert facts["anticoagulant"].resource_id == "MedicationStatement/med-1"
    assert facts["anticoagulant"].source_name == "Local intake"


def test_extract_claims_finds_penicillin_allergy():
    claims = extract_claims(BUNDLE, "local", "Local intake", "2026-09-18")
    facts = {c.fact for c in claims}
    assert "penicillin_allergy" in facts


def test_extract_claims_finds_active_diabetes():
    claims = extract_claims(BUNDLE, "local", "Local intake", "2026-09-18")
    facts = {c.fact: c for c in claims}
    assert facts["active_diabetes"].status == "active"


def test_build_patient_creates_two_sources_with_same_claims():
    p = build_patient(BUNDLE, "P-01", "chest pain", 2)
    assert p.pid == "P-01"
    assert len(p.sources) == 2
    assert {s.source_id for s in p.sources} == {"local", "hospital_b"}
    # before injection, both sources agree
    local = [c.value for c in p.sources[0].claims if c.fact == "anticoagulant"]
    other = [c.value for c in p.sources[1].claims if c.fact == "anticoagulant"]
    assert local == other
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_sources.py -v`
Expected: FAIL — no module `backend.sources`

- [ ] **Step 3: Write the implementation**

```python
# backend/sources.py
from __future__ import annotations

import copy
import datetime as _dt

from backend.models import Claim, Patient, SourceRecord

ANTICOAG_WORDS = ("warfarin", "coumadin", "apixaban", "eliquis", "rivaroxaban", "xarelto", "heparin")
PENICILLIN_WORDS = ("penicillin", "amoxicillin", "ampicillin")
DIABETES_WORDS = ("diabetes",)

SOURCE_DEFS: list[tuple[str, str]] = [
    ("local", "Local intake"),
    ("hospital_b", "Hospital B - Cardiology"),
]


def _text(node: dict) -> str:
    if not isinstance(node, dict):
        return ""
    if node.get("text"):
        return str(node["text"])
    for coding in node.get("coding", []) or []:
        if coding.get("display"):
            return str(coding["display"])
    return ""


def _mentions(haystack: str, words: tuple[str, ...]) -> bool:
    low = haystack.lower()
    return any(w in low for w in words)


def extract_claims(bundle: dict, source_id: str, source_name: str, recorded_date: str) -> list[Claim]:
    claims: list[Claim] = []
    seen: set[str] = set()

    def add(fact: str, value: str, status: str, resource_id: str) -> None:
        if fact in seen:
            return
        seen.add(fact)
        claims.append(Claim(
            fact=fact, value=value, status=status,
            source_id=source_id, source_name=source_name,
            recorded_date=recorded_date, resource_id=resource_id,
        ))

    for entry in bundle.get("entry", []) or []:
        res = entry.get("resource") or {}
        rtype = res.get("resourceType")
        rid = f"{rtype}/{res.get('id', 'unknown')}"

        if rtype in ("MedicationStatement", "MedicationRequest"):
            label = _text(res.get("medicationCodeableConcept") or {})
            if _mentions(label, ANTICOAG_WORDS):
                status = "active" if res.get("status") in ("active", "completed", None) else "stopped"
                add("anticoagulant", label, status, rid)

        elif rtype == "AllergyIntolerance":
            label = _text(res.get("code") or {})
            if _mentions(label, PENICILLIN_WORDS):
                add("penicillin_allergy", label, "present", rid)

        elif rtype == "Condition":
            label = _text(res.get("code") or {})
            if _mentions(label, DIABETES_WORDS):
                coding = (res.get("clinicalStatus") or {}).get("coding") or [{}]
                status = "active" if coding[0].get("code") == "active" else "stopped"
                add("active_diabetes", label, status, rid)

    # facts not asserted by this bundle are recorded as explicit absence,
    # so "absence of evidence" never silently becomes a conflict
    for fact in ("anticoagulant", "penicillin_allergy", "active_diabetes"):
        if fact not in seen:
            add(fact, "none recorded", "absent", f"{fact}/not-recorded")

    # operational facts every source asserts
    add("icu_need", "no", "absent", "assessment/icu-need")
    add("vitals_stable", "yes", "present", "assessment/vitals")
    return claims


def build_patient(bundle: dict, pid: str, complaint: str, severity: int) -> Patient:
    today = _dt.date.today().isoformat()
    older = (_dt.date.today() - _dt.timedelta(days=21)).isoformat()
    dates = {"local": today, "hospital_b": older}

    sources: list[SourceRecord] = []
    for source_id, source_name in SOURCE_DEFS:
        recorded = dates[source_id]
        sources.append(SourceRecord(
            source_id=source_id,
            source_name=source_name,
            recorded_date=recorded,
            claims=extract_claims(copy.deepcopy(bundle), source_id, source_name, recorded),
        ))

    return Patient(pid=pid, display_name=f"Patient {pid}", complaint=complaint,
                   severity=severity, sources=sources)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_sources.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/sources.py tests/test_sources.py
git commit -m "feat: split Synthea bundles into per-source claim records"
```

---

## Task 4: The conflict injector and answer key

**This is the most important task in the plan. Do not defer it.**

**Files:**
- Create: `backend/injector.py`
- Test: `tests/test_injector.py`

**Interfaces:**
- Consumes: `Patient`, `Claim` from `backend.models`
- Produces:
  - `plant(patient: Patient, kinds: list[str], rng: random.Random) -> list[dict]` — mutates the patient's `hospital_b` source and returns answer-key rows
  - `plant_across(patients: list[Patient], seed: int = 7) -> list[dict]`
  - `write_answer_key(rows: list[dict], path: str) -> None`
  - Answer-key row shape: `{"pid": str, "fact": str, "kind": str, "sources": [str, str]}`
  - `KINDS: tuple[str, ...] = ("value", "status", "existence", "temporal")`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_injector.py
import random

from backend.injector import KINDS, plant, plant_across
from backend.models import Claim, Patient, SourceRecord


def _patient(pid="P-01"):
    def claims(source_id, source_name, date):
        return [
            Claim("anticoagulant", "warfarin 5mg", "active", source_id, source_name, date, "MedicationStatement/m1"),
            Claim("penicillin_allergy", "Penicillin G", "present", source_id, source_name, date, "AllergyIntolerance/a1"),
            Claim("active_diabetes", "Diabetes type 2", "active", source_id, source_name, date, "Condition/c1"),
            Claim("icu_need", "no", "absent", source_id, source_name, date, "assessment/icu-need"),
            Claim("vitals_stable", "yes", "present", source_id, source_name, date, "assessment/vitals"),
        ]

    return Patient(
        pid=pid, display_name=f"Patient {pid}", complaint="syncope", severity=3,
        sources=[
            SourceRecord("local", "Local intake", "2026-09-18", claims("local", "Local intake", "2026-09-18")),
            SourceRecord("hospital_b", "Hospital B", "2026-08-28", claims("hospital_b", "Hospital B", "2026-08-28")),
        ],
    )


def test_value_conflict_changes_only_one_source():
    p = _patient()
    rows = plant(p, ["value"], random.Random(1))
    assert len(rows) == 1
    assert rows[0]["fact"] in ("anticoagulant",)
    local = [c.value for c in p.sources[0].claims if c.fact == rows[0]["fact"]][0]
    other = [c.value for c in p.sources[1].claims if c.fact == rows[0]["fact"]][0]
    assert local != other


def test_existence_conflict_flips_a_claim_to_absent():
    p = _patient()
    rows = plant(p, ["existence"], random.Random(2))
    fact = rows[0]["fact"]
    other = [c for c in p.sources[1].claims if c.fact == fact][0]
    assert other.status == "absent"
    assert rows[0]["kind"] == "existence"


def test_status_conflict_marks_one_source_stopped():
    p = _patient()
    rows = plant(p, ["status"], random.Random(3))
    other = [c for c in p.sources[1].claims if c.fact == rows[0]["fact"]][0]
    assert other.status == "stopped"


def test_answer_key_row_shape():
    p = _patient()
    rows = plant(p, ["value"], random.Random(4))
    row = rows[0]
    assert set(row.keys()) == {"pid", "fact", "kind", "sources"}
    assert row["pid"] == "P-01"
    assert row["sources"] == ["local", "hospital_b"]
    assert row["kind"] in KINDS


def test_plant_across_is_deterministic_and_leaves_some_patients_clean():
    a = [_patient(f"P-{i:02d}") for i in range(10)]
    b = [_patient(f"P-{i:02d}") for i in range(10)]
    rows_a = plant_across(a, seed=7)
    rows_b = plant_across(b, seed=7)
    assert rows_a == rows_b
    touched = {r["pid"] for r in rows_a}
    assert 0 < len(touched) < 10  # some patients must stay clean, to expose false positives
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_injector.py -v`
Expected: FAIL — no module `backend.injector`

- [ ] **Step 3: Write the implementation**

```python
# backend/injector.py
from __future__ import annotations

import datetime as _dt
import json
import random

from backend.models import Claim, Patient

KINDS: tuple[str, ...] = ("value", "status", "existence", "temporal")

# only facts a placement can depend on are worth planting into
PLANTABLE = ("anticoagulant", "penicillin_allergy", "active_diabetes")

DOSE_SWAPS = {
    "warfarin 5mg": "warfarin 2.5mg",
    "Warfarin Sodium 5 MG Oral Tablet": "Warfarin Sodium 2.5 MG Oral Tablet",
}


def _claim(patient: Patient, source_id: str, fact: str) -> Claim | None:
    for s in patient.sources:
        if s.source_id != source_id:
            continue
        for c in s.claims:
            if c.fact == fact:
                return c
    return None


def plant(patient: Patient, kinds: list[str], rng: random.Random) -> list[dict]:
    """Mutate the hospital_b source only. Returns answer-key rows."""
    rows: list[dict] = []
    for kind in kinds:
        candidates = [f for f in PLANTABLE if _claim(patient, "hospital_b", f) is not None]
        if not candidates:
            continue
        fact = rng.choice(candidates)
        target = _claim(patient, "hospital_b", fact)
        assert target is not None

        if kind == "value":
            target.value = DOSE_SWAPS.get(target.value, target.value + " (2.5mg)")
        elif kind == "status":
            target.status = "stopped"
        elif kind == "existence":
            target.status = "absent"
            target.value = "no known " + fact.replace("_", " ")
        elif kind == "temporal":
            stale = (_dt.date.fromisoformat(target.recorded_date) - _dt.timedelta(days=400)).isoformat()
            target.recorded_date = stale
            target.value = DOSE_SWAPS.get(target.value, target.value + " (2.5mg)")
        else:
            raise ValueError(f"unknown kind {kind}")

        rows.append({"pid": patient.pid, "fact": fact, "kind": kind,
                     "sources": ["local", "hospital_b"]})
    return rows


def plant_across(patients: list[Patient], seed: int = 7) -> list[dict]:
    """Plant conflicts into roughly 40% of patients. Deterministic for a given seed."""
    rng = random.Random(seed)
    rows: list[dict] = []
    for p in patients:
        if rng.random() < 0.4:
            n = rng.choice([1, 1, 2])
            kinds = [rng.choice(KINDS) for _ in range(n)]
            rows.extend(plant(p, kinds, rng))
    return rows


def write_answer_key(rows: list[dict], path: str = "data/answer_key.json") -> None:
    with open(path, "w") as fh:
        json.dump(rows, fh, indent=2)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_injector.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/injector.py tests/test_injector.py
git commit -m "feat: conflict injector with deterministic ground-truth answer key"
```

---

## Task 5: Hospital state

**Files:**
- Create: `backend/hospital.py`
- Test: `tests/test_hospital.py`

**Interfaces:**
- Consumes: `UNITS` from `backend.models`
- Produces:
  - `Hospital()` with `capacity: dict[str, dict]`, `free(unit) -> int`, `occupy(unit) -> bool`, `release(unit) -> None`, `snapshot() -> list[dict]`
  - Snapshot row: `{"unit": str, "total": int, "occupied": int, "percent": int}`
  - Starting capacity: `ER` 20 total / 14 occupied, `ICU` 10 / 9, `STEPDOWN` 16 / 12, `OR` 4 / 2

- [ ] **Step 1: Write the failing test**

```python
# tests/test_hospital.py
from backend.hospital import Hospital


def test_starting_capacity():
    h = Hospital()
    snap = {r["unit"]: r for r in h.snapshot()}
    assert snap["ICU"]["total"] == 10
    assert snap["ICU"]["occupied"] == 9
    assert snap["ICU"]["percent"] == 90


def test_occupy_reduces_free_beds():
    h = Hospital()
    assert h.free("ICU") == 1
    assert h.occupy("ICU") is True
    assert h.free("ICU") == 0


def test_occupy_fails_when_full():
    h = Hospital()
    h.occupy("ICU")
    assert h.occupy("ICU") is False


def test_percent_can_exceed_100_under_surge():
    h = Hospital()
    for _ in range(10):
        h.capacity["ER"]["occupied"] += 1
    snap = {r["unit"]: r for r in h.snapshot()}
    assert snap["ER"]["percent"] == 120
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_hospital.py -v`
Expected: FAIL — no module `backend.hospital`

- [ ] **Step 3: Write the implementation**

```python
# backend/hospital.py
from __future__ import annotations

from backend.models import UNITS

START = {
    "ER": {"total": 20, "occupied": 14},
    "ICU": {"total": 10, "occupied": 9},
    "STEPDOWN": {"total": 16, "occupied": 12},
    "OR": {"total": 4, "occupied": 2},
}


class Hospital:
    def __init__(self) -> None:
        self.capacity: dict[str, dict] = {u: dict(START[u]) for u in UNITS}

    def free(self, unit: str) -> int:
        c = self.capacity[unit]
        return max(0, c["total"] - c["occupied"])

    def occupy(self, unit: str) -> bool:
        if self.free(unit) <= 0:
            return False
        self.capacity[unit]["occupied"] += 1
        return True

    def release(self, unit: str) -> None:
        c = self.capacity[unit]
        c["occupied"] = max(0, c["occupied"] - 1)

    def snapshot(self) -> list[dict]:
        rows = []
        for u in UNITS:
            c = self.capacity[u]
            pct = round(100 * c["occupied"] / c["total"]) if c["total"] else 0
            rows.append({"unit": u, "total": c["total"], "occupied": c["occupied"], "percent": pct})
        return rows

    def reset(self) -> None:
        self.capacity = {u: dict(START[u]) for u in UNITS}
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_hospital.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/hospital.py tests/test_hospital.py
git commit -m "feat: in-memory hospital capacity state"
```

---

## Task 6: The allocator (no AI)

**Files:**
- Create: `backend/allocator.py`
- Test: `tests/test_allocator.py`

**Interfaces:**
- Consumes: `Patient`, `Plan` from `backend.models`; `Hospital` from `backend.hospital`
- Produces:
  - `propose(patient: Patient, hospital: Hospital) -> Plan`
  - `UNIT_FACTS: dict[str, list[str]]` — the facts each unit's placement depends on

- [ ] **Step 1: Write the failing test**

```python
# tests/test_allocator.py
from backend.allocator import UNIT_FACTS, propose
from backend.hospital import Hospital
from backend.models import Patient


def _p(severity, pid="P-01"):
    return Patient(pid=pid, display_name=pid, complaint="syncope", severity=severity, sources=[])


def test_critical_patient_goes_to_icu_when_bed_free():
    plan = propose(_p(1), Hospital())
    assert plan.unit == "ICU"


def test_stable_patient_goes_to_stepdown():
    plan = propose(_p(3), Hospital())
    assert plan.unit == "STEPDOWN"


def test_plan_declares_the_facts_it_relied_on():
    plan = propose(_p(3), Hospital())
    assert plan.because == UNIT_FACTS["STEPDOWN"]
    assert "anticoagulant" in plan.because


def test_falls_back_to_er_when_target_unit_is_full():
    h = Hospital()
    h.capacity["ICU"]["occupied"] = 10
    plan = propose(_p(1), h)
    assert plan.unit == "ER"


def test_every_unit_declares_at_least_one_fact():
    for unit, facts in UNIT_FACTS.items():
        assert len(facts) >= 1
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_allocator.py -v`
Expected: FAIL — no module `backend.allocator`

- [ ] **Step 3: Write the implementation**

```python
# backend/allocator.py
from __future__ import annotations

from backend.hospital import Hospital
from backend.models import Patient, Plan

# The facts a placement into each unit depends on.
# This mapping is the whole reason targeted crosschecking is possible.
UNIT_FACTS: dict[str, list[str]] = {
    "ICU": ["icu_need", "anticoagulant"],
    "STEPDOWN": ["anticoagulant", "vitals_stable", "icu_need"],
    "OR": ["anticoagulant", "penicillin_allergy"],
    "ER": ["vitals_stable"],
}


def _preferred_unit(severity: int) -> str:
    if severity <= 2:
        return "ICU"
    if severity == 3:
        return "STEPDOWN"
    return "ER"


def propose(patient: Patient, hospital: Hospital) -> Plan:
    """Greedy: first-choice unit if a bed is free, else ER. Deliberately no AI."""
    target = _preferred_unit(patient.severity)
    if hospital.free(target) <= 0:
        target = "ER"
    return Plan(pid=patient.pid, unit=target, because=list(UNIT_FACTS[target]))
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_allocator.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/allocator.py tests/test_allocator.py
git commit -m "feat: greedy allocator that declares the facts it relied on"
```

---

## Task 7: Gemini wrapper with stub mode

**Files:**
- Create: `backend/gemini.py`
- Test: `tests/test_gemini.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `ask_json(prompt: str, stub_key: str) -> dict` — returns parsed JSON; returns `STUBS[stub_key]` when `CONCORD_STUB=1` or no API key is set
  - `STUBS: dict[str, dict]`
  - `strip_fences(text: str) -> str`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_gemini.py
import os

from backend.gemini import ask_json, strip_fences


def test_strip_fences_removes_markdown_code_block():
    raw = '```json\n{"a": 1}\n```'
    assert strip_fences(raw) == '{"a": 1}'


def test_strip_fences_passes_plain_json_through():
    assert strip_fences('{"a": 1}') == '{"a": 1}'


def test_stub_mode_returns_canned_json_without_network(monkeypatch):
    monkeypatch.setenv("CONCORD_STUB", "1")
    out = ask_json("anything", stub_key="adjudicate")
    assert isinstance(out, dict)
    assert "conflicts" in out
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_gemini.py -v`
Expected: FAIL — no module `backend.gemini`

- [ ] **Step 3: Write the implementation**

```python
# backend/gemini.py
from __future__ import annotations

import json
import os
import re

MODEL = "gemini-3.5-flash-lite"

STUBS: dict[str, dict] = {
    "extract": {"claims": []},
    "adjudicate": {"conflicts": []},
}

_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def strip_fences(text: str) -> str:
    return _FENCE.sub("", text.strip()).strip()


def _stubbing() -> bool:
    return os.environ.get("CONCORD_STUB") == "1" or not os.environ.get("GEMINI_API_KEY")


def ask_json(prompt: str, stub_key: str) -> dict:
    """Send a prompt, return parsed JSON. Falls back to a stub so the demo never dies."""
    if _stubbing():
        return json.loads(json.dumps(STUBS[stub_key]))
    try:
        from google import genai

        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        resp = client.models.generate_content(model=MODEL, contents=prompt)
        return json.loads(strip_fences(resp.text or "{}"))
    except Exception as exc:  # never let the board crash mid-demo
        print(f"[concord] gemini call failed, using stub: {exc}")
        return json.loads(json.dumps(STUBS[stub_key]))
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_gemini.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/gemini.py tests/test_gemini.py
git commit -m "feat: Gemini wrapper with stub fallback so the demo never dies"
```

---

## Task 8: Crosscheck — the heart of the product

**Files:**
- Create: `backend/crosscheck.py`
- Test: `tests/test_crosscheck.py`

**Interfaces:**
- Consumes: `Patient`, `Conflict`, `ConflictVersion`, `Verdict` from `backend.models`; `ask_json` from `backend.gemini`
- Produces:
  - `verify(patient: Patient, facts: list[str], use_llm: bool = True) -> Verdict`
  - `deterministic_conflicts(patient: Patient, facts: list[str]) -> list[Conflict]`
  - `build_adjudication_prompt(patient: Patient, fact: str) -> str`

**Design:** a deterministic pass finds candidate disagreements (cheap, always runs, demo-safe). When `use_llm` is on, Gemini adjudicates whether each candidate is a genuine contradiction or just different wording, and writes the human-readable `reason`. Absence only counts when a source *explicitly* records absence — never when a fact is merely missing.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_crosscheck.py
from backend.crosscheck import build_adjudication_prompt, deterministic_conflicts, verify
from backend.models import Claim, Patient, SourceRecord


def _patient(local_kwargs, other_kwargs):
    return Patient(
        pid="P-14", display_name="Patient P-14", complaint="syncope", severity=3,
        sources=[
            SourceRecord("local", "Local intake", "2026-09-18",
                         [Claim(fact="anticoagulant", source_id="local", source_name="Local intake",
                                recorded_date="2026-09-18", resource_id="MedicationStatement/m1", **local_kwargs)]),
            SourceRecord("hospital_b", "Hospital B", "2026-08-28",
                         [Claim(fact="anticoagulant", source_id="hospital_b", source_name="Hospital B",
                                recorded_date="2026-08-28", resource_id="MedicationStatement/m2", **other_kwargs)]),
        ],
    )


def test_value_disagreement_is_a_conflict():
    p = _patient({"value": "warfarin 5mg", "status": "active"},
                 {"value": "warfarin 2.5mg", "status": "active"})
    conflicts = deterministic_conflicts(p, ["anticoagulant"])
    assert len(conflicts) == 1
    assert len(conflicts[0].versions) == 2


def test_explicit_absence_versus_active_is_a_conflict():
    p = _patient({"value": "none recorded", "status": "absent"},
                 {"value": "warfarin 5mg", "status": "active"})
    conflicts = deterministic_conflicts(p, ["anticoagulant"])
    assert len(conflicts) == 1


def test_agreeing_sources_produce_no_conflict():
    p = _patient({"value": "warfarin 5mg", "status": "active"},
                 {"value": "warfarin 5mg", "status": "active"})
    assert deterministic_conflicts(p, ["anticoagulant"]) == []


def test_facts_outside_the_because_list_are_never_checked():
    p = _patient({"value": "warfarin 5mg", "status": "active"},
                 {"value": "warfarin 2.5mg", "status": "active"})
    assert deterministic_conflicts(p, ["penicillin_allergy"]) == []


def test_verify_without_llm_returns_verdict():
    p = _patient({"value": "warfarin 5mg", "status": "active"},
                 {"value": "warfarin 2.5mg", "status": "active"})
    v = verify(p, ["anticoagulant"], use_llm=False)
    assert v.has_conflicts is True


def test_prompt_contains_both_sources_and_forbids_saying_which_is_right():
    p = _patient({"value": "warfarin 5mg", "status": "active"},
                 {"value": "warfarin 2.5mg", "status": "active"})
    prompt = build_adjudication_prompt(p, "anticoagulant")
    assert "Local intake" in prompt
    assert "Hospital B" in prompt
    assert "Do NOT say which value is correct" in prompt
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_crosscheck.py -v`
Expected: FAIL — no module `backend.crosscheck`

- [ ] **Step 3: Write the implementation**

```python
# backend/crosscheck.py
from __future__ import annotations

import json

from backend.gemini import ask_json
from backend.models import Claim, Conflict, ConflictVersion, Patient, Verdict

ACTIVE = ("active", "present")


def _version(c: Claim) -> ConflictVersion:
    return ConflictVersion(
        source_name=c.source_name,
        recorded_date=c.recorded_date,
        value=c.value,
        status=c.status,
        resource_id=c.resource_id,
    )


def _disagree(a: Claim, b: Claim) -> bool:
    # explicit absence vs. an active assertion
    if (a.status == "absent") != (b.status == "absent"):
        return True
    # both present but stopped vs active
    if a.status in ACTIVE and b.status == "stopped":
        return True
    if b.status in ACTIVE and a.status == "stopped":
        return True
    # both active but different recorded values
    if a.status in ACTIVE and b.status in ACTIVE:
        return a.value.strip().lower() != b.value.strip().lower()
    return False


def deterministic_conflicts(patient: Patient, facts: list[str]) -> list[Conflict]:
    out: list[Conflict] = []
    for fact in facts:
        claims = patient.claims_for(fact)
        if len(claims) < 2:
            continue
        found = False
        for i in range(len(claims)):
            for j in range(i + 1, len(claims)):
                if _disagree(claims[i], claims[j]):
                    found = True
        if found:
            out.append(Conflict(
                fact=fact,
                versions=[_version(c) for c in claims],
                reason="sources record different values or statuses for this fact",
            ))
    return out


def build_adjudication_prompt(patient: Patient, fact: str) -> str:
    rows = [
        {"source": c.source_name, "recorded_date": c.recorded_date,
         "value": c.value, "status": c.status}
        for c in patient.claims_for(fact)
    ]
    return f"""You are auditing whether medical records genuinely contradict each other.

Fact under review: {fact}

Records:
{json.dumps(rows, indent=2)}

Decide whether these records GENUINELY contradict each other, or whether they are
the same fact written differently (for example "Coumadin 5mg" and "warfarin 5 mg PO"
are the same fact; "on anticoagulation" is consistent with a specific anticoagulant).

Treat a record as denying a fact ONLY if it explicitly records absence. A record that
simply does not mention the fact is a GAP, not a contradiction.

Do NOT say which value is correct. Do NOT recommend any clinical action.

Reply with JSON only:
{{"conflicts": [{{"fact": "{fact}", "genuine": true, "reason": "<one short sentence, neutral>"}}]}}
If there is no genuine contradiction, reply {{"conflicts": []}}.
"""


def verify(patient: Patient, facts: list[str], use_llm: bool = True) -> Verdict:
    candidates = deterministic_conflicts(patient, facts)
    if not candidates or not use_llm:
        return Verdict(conflicts=candidates)

    kept: list[Conflict] = []
    for cand in candidates:
        result = ask_json(build_adjudication_prompt(patient, cand.fact), stub_key="adjudicate")
        judged = result.get("conflicts") or []
        if not judged:
            # stub or "no genuine conflict" -> keep the deterministic finding,
            # because the deterministic pass already required explicit disagreement
            kept.append(cand)
            continue
        first = judged[0]
        if first.get("genuine", True):
            cand.reason = first.get("reason") or cand.reason
            kept.append(cand)
    return Verdict(conflicts=kept)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_crosscheck.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/crosscheck.py tests/test_crosscheck.py
git commit -m "feat: crosscheck verifies only the facts a placement relied on"
```

---

## Task 9: Patient queue, surge, and the decision loop

**Files:**
- Create: `backend/patient_queue.py`
- Test: `tests/test_patient_queue.py`

**Interfaces:**
- Consumes: `Patient` from `backend.models`; `Hospital`; `propose`; `verify`; `build_patient`, `plant_across`
- Produces:
  - `Board(hospital: Hospital, patients: list[Patient])` with:
    - `decide(patient: Patient, use_llm: bool = True) -> None` — sets `plan`, `verdict`, `state`, `unit`
    - `surge(n: int) -> list[Patient]` — moves `n` waiting patients into decided state
    - `rows() -> list[dict]` — `{"pid","display_name","complaint","severity","unit","state","conflict_count"}`
    - `metrics() -> dict` — `{"held": int, "committed": int, "waiting": int}`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_patient_queue.py
from backend.hospital import Hospital
from backend.models import Claim, Patient, SourceRecord
from backend.patient_queue import Board


def _patient(pid, conflicting: bool):
    def claims(sid, sname, date, value):
        return [
            Claim("anticoagulant", value, "active", sid, sname, date, f"MedicationStatement/{sid}"),
            Claim("vitals_stable", "yes", "present", sid, sname, date, "assessment/vitals"),
            Claim("icu_need", "no", "absent", sid, sname, date, "assessment/icu-need"),
        ]

    other_value = "warfarin 2.5mg" if conflicting else "warfarin 5mg"
    return Patient(
        pid=pid, display_name=pid, complaint="syncope", severity=3,
        sources=[
            SourceRecord("local", "Local intake", "2026-09-18", claims("local", "Local intake", "2026-09-18", "warfarin 5mg")),
            SourceRecord("hospital_b", "Hospital B", "2026-08-28", claims("hospital_b", "Hospital B", "2026-08-28", other_value)),
        ],
    )


def test_clean_patient_is_committed_and_takes_a_bed():
    h = Hospital()
    before = h.free("STEPDOWN")
    b = Board(h, [_patient("P-01", conflicting=False)])
    b.decide(b.patients[0], use_llm=False)
    assert b.patients[0].state == "committed"
    assert b.patients[0].unit == "STEPDOWN"
    assert h.free("STEPDOWN") == before - 1


def test_conflicting_patient_is_held_and_takes_no_bed():
    h = Hospital()
    before = h.free("STEPDOWN")
    b = Board(h, [_patient("P-02", conflicting=True)])
    b.decide(b.patients[0], use_llm=False)
    assert b.patients[0].state == "held"
    assert h.free("STEPDOWN") == before


def test_surge_decides_n_waiting_patients():
    h = Hospital()
    patients = [_patient(f"P-{i:02d}", conflicting=(i % 3 == 0)) for i in range(6)]
    b = Board(h, patients)
    decided = b.surge(4)
    assert len(decided) == 4
    assert b.metrics()["waiting"] == 2


def test_rows_expose_state_and_conflict_count():
    h = Hospital()
    b = Board(h, [_patient("P-03", conflicting=True)])
    b.decide(b.patients[0], use_llm=False)
    row = b.rows()[0]
    assert row["state"] == "held"
    assert row["conflict_count"] == 1
    assert row["pid"] == "P-03"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_patient_queue.py -v`
Expected: FAIL — no module `backend.patient_queue`

- [ ] **Step 3: Write the implementation**

```python
# backend/patient_queue.py
from __future__ import annotations

from backend.allocator import propose
from backend.crosscheck import verify
from backend.hospital import Hospital
from backend.models import Patient


class Board:
    def __init__(self, hospital: Hospital, patients: list[Patient]) -> None:
        self.hospital = hospital
        self.patients = patients

    def decide(self, patient: Patient, use_llm: bool = True) -> None:
        plan = propose(patient, self.hospital)
        verdict = verify(patient, plan.because, use_llm=use_llm)
        patient.plan = plan
        patient.verdict = verdict
        if verdict.has_conflicts:
            patient.state = "held"
            patient.unit = None
        else:
            if self.hospital.occupy(plan.unit):
                patient.state = "committed"
                patient.unit = plan.unit
            else:
                patient.state = "waiting"
                patient.unit = None

    def surge(self, n: int, use_llm: bool = True) -> list[Patient]:
        waiting = [p for p in self.patients if p.state == "waiting"]
        chosen = waiting[:n]
        for p in chosen:
            self.decide(p, use_llm=use_llm)
        return chosen

    def rows(self) -> list[dict]:
        out = []
        for p in self.patients:
            count = len(p.verdict.conflicts) if p.verdict else 0
            out.append({
                "pid": p.pid,
                "display_name": p.display_name,
                "complaint": p.complaint,
                "severity": p.severity,
                "unit": p.unit,
                "state": p.state,
                "proposed_unit": p.plan.unit if p.plan else None,
                "conflict_count": count,
            })
        return out

    def metrics(self) -> dict:
        states = [p.state for p in self.patients]
        return {
            "held": states.count("held"),
            "committed": states.count("committed"),
            "waiting": states.count("waiting"),
        }
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_patient_queue.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/patient_queue.py tests/test_patient_queue.py
git commit -m "feat: board decides placements and holds on conflict"
```

---

## Task 10: Score against the answer key

**Files:**
- Create: `backend/score.py`
- Test: `tests/test_score.py`

**Interfaces:**
- Consumes: `Patient`
- Produces:
  - `score(patients: list[Patient], answer_key: list[dict]) -> dict` returning
    `{"planted": int, "caught": int, "missed": int, "false_positives": int, "precision": float, "recall": float}`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_score.py
from backend.models import Conflict, Patient, Verdict
from backend.score import score


def _p(pid, facts):
    return Patient(pid=pid, display_name=pid, complaint="x", severity=3, sources=[],
                   verdict=Verdict(conflicts=[Conflict(fact=f) for f in facts]))


def test_perfect_detection():
    patients = [_p("P-01", ["anticoagulant"])]
    key = [{"pid": "P-01", "fact": "anticoagulant", "kind": "value", "sources": ["local", "hospital_b"]}]
    s = score(patients, key)
    assert s == {"planted": 1, "caught": 1, "missed": 0, "false_positives": 0,
                 "precision": 1.0, "recall": 1.0}


def test_missed_conflict_lowers_recall():
    patients = [_p("P-01", [])]
    key = [{"pid": "P-01", "fact": "anticoagulant", "kind": "value", "sources": ["local", "hospital_b"]}]
    s = score(patients, key)
    assert s["missed"] == 1
    assert s["recall"] == 0.0


def test_false_positive_lowers_precision():
    patients = [_p("P-01", ["anticoagulant", "penicillin_allergy"])]
    key = [{"pid": "P-01", "fact": "anticoagulant", "kind": "value", "sources": ["local", "hospital_b"]}]
    s = score(patients, key)
    assert s["false_positives"] == 1
    assert s["precision"] == 0.5
    assert s["recall"] == 1.0


def test_no_planted_conflicts_gives_zero_recall_not_crash():
    s = score([_p("P-01", [])], [])
    assert s["planted"] == 0
    assert s["recall"] == 0.0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_score.py -v`
Expected: FAIL — no module `backend.score`

- [ ] **Step 3: Write the implementation**

```python
# backend/score.py
from __future__ import annotations

from backend.models import Patient


def score(patients: list[Patient], answer_key: list[dict]) -> dict:
    planted = {(r["pid"], r["fact"]) for r in answer_key}

    reported: set[tuple[str, str]] = set()
    for p in patients:
        if not p.verdict:
            continue
        for c in p.verdict.conflicts:
            reported.add((p.pid, c.fact))

    caught = planted & reported
    missed = planted - reported
    false_pos = reported - planted

    precision = len(caught) / len(reported) if reported else 0.0
    recall = len(caught) / len(planted) if planted else 0.0

    return {
        "planted": len(planted),
        "caught": len(caught),
        "missed": len(missed),
        "false_positives": len(false_pos),
        "precision": round(precision, 3),
        "recall": round(recall, 3),
    }
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_score.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/score.py tests/test_score.py
git commit -m "feat: precision and recall against the planted answer key"
```

---

## Task 11: Department status lines

**Files:**
- Create: `backend/departments.py`
- Test: `tests/test_departments.py`

**Interfaces:**
- Consumes: `Hospital`
- Produces: `status_lines(hospital: Hospital) -> list[dict]` — `{"unit": str, "line": str}`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_departments.py
from backend.departments import status_lines
from backend.hospital import Hospital


def test_icu_with_one_bed_says_critical_only():
    lines = {r["unit"]: r["line"] for r in status_lines(Hospital())}
    assert "1 bed left" in lines["ICU"]
    assert "critical" in lines["ICU"].lower()


def test_full_unit_says_full():
    h = Hospital()
    h.capacity["ICU"]["occupied"] = 10
    lines = {r["unit"]: r["line"] for r in status_lines(h)}
    assert "full" in lines["ICU"].lower()


def test_every_unit_gets_a_line():
    assert len(status_lines(Hospital())) == 4
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/test_departments.py -v`
Expected: FAIL — no module `backend.departments`

- [ ] **Step 3: Write the implementation**

```python
# backend/departments.py
from __future__ import annotations

from backend.hospital import Hospital
from backend.models import UNITS


def status_lines(hospital: Hospital) -> list[dict]:
    out = []
    for unit in UNITS:
        free = hospital.free(unit)
        if free == 0:
            line = f"{unit} is full - diverting"
        elif free == 1:
            line = f"{unit}: 1 bed left, holding it for critical patients only"
        else:
            line = f"{unit}: {free} beds open, accepting patients"
        out.append({"unit": unit, "line": line})
    return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/pytest tests/test_departments.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/departments.py tests/test_departments.py
git commit -m "feat: plain-English department status lines"
```

---

## Task 12: Wire the API

**Files:**
- Modify: `backend/main.py`
- Create: `backend/demo_data.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `GET /state` -> `{"capacity": [...], "departments": [...], "rows": [...], "metrics": {...}}`
  - `POST /surge` -> `{"decided": int}` (decides 25 waiting patients)
  - `GET /patient/{pid}` -> `{"pid","display_name","proposed_unit","because":[...],"state","conflicts":[{"fact","reason","versions":[...]}]}`
  - `GET /score` -> the score dict
  - `POST /reset` -> `{"status": "reset"}`
  - `backend/demo_data.py`: `load_board(n: int = 30) -> tuple[Board, list[dict]]` — builds patients from `data/synthea/`, plants conflicts, returns board and answer key. Falls back to synthetic in-code patients if `data/synthea/` is empty.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api.py
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_state_has_all_four_zones():
    r = client.post("/reset")
    assert r.status_code == 200
    body = client.get("/state").json()
    assert len(body["capacity"]) == 4
    assert len(body["departments"]) == 4
    assert isinstance(body["rows"], list)
    assert set(body["metrics"]) == {"held", "committed", "waiting"}


def test_surge_decides_patients_and_produces_holds():
    client.post("/reset")
    decided = client.post("/surge").json()["decided"]
    assert decided > 0
    metrics = client.get("/state").json()["metrics"]
    assert metrics["held"] >= 1, "the demo must produce at least one held row"
    assert metrics["committed"] >= 1


def test_patient_detail_exposes_because_and_provenance():
    client.post("/reset")
    client.post("/surge")
    rows = client.get("/state").json()["rows"]
    held = [r for r in rows if r["state"] == "held"]
    assert held, "expected at least one held patient"
    detail = client.get(f"/patient/{held[0]['pid']}").json()
    assert detail["because"]
    conflict = detail["conflicts"][0]
    assert len(conflict["versions"]) >= 2
    assert conflict["versions"][0]["source_name"]
    assert conflict["versions"][0]["recorded_date"]
    assert conflict["versions"][0]["resource_id"]


def test_score_endpoint_reports_planted_and_caught():
    client.post("/reset")
    client.post("/surge")
    s = client.get("/score").json()
    assert s["planted"] >= 1
    assert 0.0 <= s["recall"] <= 1.0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `CONCORD_STUB=1 .venv/bin/pytest tests/test_api.py -v`
Expected: FAIL — `/reset` returns 404

- [ ] **Step 3: Write demo_data.py**

```python
# backend/demo_data.py
from __future__ import annotations

import glob
import json
import os

from backend.hospital import Hospital
from backend.injector import plant_across
from backend.models import Claim, Patient, SourceRecord
from backend.patient_queue import Board
from backend.sources import build_patient

COMPLAINTS = ["chest pain", "syncope", "shortness of breath", "abdominal pain",
              "fracture", "head injury", "sepsis concern", "palpitations"]


def _fallback_patient(i: int) -> Patient:
    def claims(sid, sname, date):
        return [
            Claim("anticoagulant", "warfarin 5mg", "active", sid, sname, date, f"MedicationStatement/{sid}-{i}"),
            Claim("penicillin_allergy", "Penicillin G", "present", sid, sname, date, f"AllergyIntolerance/{sid}-{i}"),
            Claim("active_diabetes", "Diabetes type 2", "active", sid, sname, date, f"Condition/{sid}-{i}"),
            Claim("icu_need", "no", "absent", sid, sname, date, "assessment/icu-need"),
            Claim("vitals_stable", "yes", "present", sid, sname, date, "assessment/vitals"),
        ]

    return Patient(
        pid=f"P-{i:02d}", display_name=f"Patient P-{i:02d}",
        complaint=COMPLAINTS[i % len(COMPLAINTS)], severity=(i % 5) + 1,
        sources=[
            SourceRecord("local", "Local intake", "2026-09-18", claims("local", "Local intake", "2026-09-18")),
            SourceRecord("hospital_b", "Hospital B - Cardiology", "2026-08-28",
                         claims("hospital_b", "Hospital B - Cardiology", "2026-08-28")),
        ],
    )


def load_board(n: int = 30) -> tuple[Board, list[dict]]:
    paths = sorted(glob.glob(os.path.join("data", "synthea", "*.json")))[:n]
    patients: list[Patient] = []

    for i, path in enumerate(paths):
        try:
            with open(path) as fh:
                bundle = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        patients.append(build_patient(bundle, f"P-{i:02d}",
                                      COMPLAINTS[i % len(COMPLAINTS)], (i % 5) + 1))

    while len(patients) < n:
        patients.append(_fallback_patient(len(patients)))

    answer_key = plant_across(patients, seed=7)
    return Board(Hospital(), patients), answer_key
```

- [ ] **Step 4: Rewrite main.py**

```python
# backend/main.py
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.demo_data import load_board
from backend.departments import status_lines
from backend.score import score

app = FastAPI(title="Concord")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

USE_LLM = os.environ.get("CONCORD_STUB") != "1"

BOARD, ANSWER_KEY = load_board()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/reset")
def reset():
    global BOARD, ANSWER_KEY
    BOARD, ANSWER_KEY = load_board()
    return {"status": "reset"}


@app.get("/state")
def state():
    return {
        "capacity": BOARD.hospital.snapshot(),
        "departments": status_lines(BOARD.hospital),
        "rows": BOARD.rows(),
        "metrics": BOARD.metrics(),
    }


@app.post("/surge")
def surge():
    decided = BOARD.surge(25, use_llm=USE_LLM)
    return {"decided": len(decided)}


@app.get("/patient/{pid}")
def patient(pid: str):
    match = [p for p in BOARD.patients if p.pid == pid]
    if not match:
        raise HTTPException(status_code=404, detail="unknown patient")
    p = match[0]
    conflicts = []
    if p.verdict:
        for c in p.verdict.conflicts:
            conflicts.append({
                "fact": c.fact,
                "reason": c.reason,
                "versions": [v.__dict__ for v in c.versions],
            })
    return {
        "pid": p.pid,
        "display_name": p.display_name,
        "complaint": p.complaint,
        "severity": p.severity,
        "proposed_unit": p.plan.unit if p.plan else None,
        "because": p.plan.because if p.plan else [],
        "state": p.state,
        "conflicts": conflicts,
        "notice": "sources disagree; a human must resolve" if conflicts else "",
    }


@app.get("/score")
def score_endpoint():
    return score(BOARD.patients, ANSWER_KEY)
```

- [ ] **Step 5: Run the tests**

Run: `CONCORD_STUB=1 .venv/bin/pytest tests/test_api.py -v`
Expected: 4 passed

- [ ] **Step 6: Run the whole suite**

Run: `CONCORD_STUB=1 .venv/bin/pytest -v`
Expected: all passed

- [ ] **Step 7: Start the server by hand and confirm**

Run: `CONCORD_STUB=1 .venv/bin/uvicorn backend.main:app --reload --port 8000`
Then: `curl -s localhost:8000/state | head -40` and `curl -s -X POST localhost:8000/surge`
Expected: JSON with four capacity rows; surge reports `{"decided": 25}`

- [ ] **Step 8: Commit**

```bash
git add backend/main.py backend/demo_data.py tests/test_api.py
git commit -m "feat: API exposes state, surge, patient detail and score"
```

---

## Task 13: Frontend board (teammate-owned)

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/src/main.jsx`, `frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/App.css`

**Interfaces:**
- Consumes: `GET /state`, `POST /surge`, `GET /patient/{pid}`, `GET /score` from Task 12
- Produces: a page at `localhost:5173` with three zones — capacity bars, patient rows, conflict detail

- [ ] **Step 1: Scaffold Vite**

```bash
cd frontend
npm create vite@latest . -- --template react
npm install
```

- [ ] **Step 2: Write the API module**

```javascript
// frontend/src/api.js
const BASE = "http://localhost:8000";

export async function fetchState() {
  const r = await fetch(`${BASE}/state`);
  if (!r.ok) throw new Error("state failed");
  return r.json();
}

export async function triggerSurge() {
  const r = await fetch(`${BASE}/surge`, { method: "POST" });
  return r.json();
}

export async function fetchPatient(pid) {
  const r = await fetch(`${BASE}/patient/${pid}`);
  return r.json();
}

export async function fetchScore() {
  const r = await fetch(`${BASE}/score`);
  return r.json();
}
```

- [ ] **Step 3: Write App.jsx**

```jsx
// frontend/src/App.jsx
import { useEffect, useState } from "react";
import { fetchPatient, fetchScore, fetchState, triggerSurge } from "./api";
import "./App.css";

export default function App() {
  const [state, setState] = useState(null);
  const [detail, setDetail] = useState(null);
  const [score, setScore] = useState(null);

  useEffect(() => {
    const tick = () => fetchState().then(setState).catch(() => {});
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  async function onSurge() {
    await triggerSurge();
    setScore(await fetchScore());
  }

  async function onRow(pid) {
    setDetail(await fetchPatient(pid));
  }

  if (!state) return <div className="app">connecting…</div>;

  return (
    <div className="app">
      <header>
        <h1>CONCORD</h1>
        <button className="surge" onClick={onSurge}>MASS CASUALTY</button>
      </header>

      <section className="bars">
        {state.capacity.map((c) => (
          <div key={c.unit} className="bar-row">
            <span className="unit">{c.unit}</span>
            <div className="bar">
              <div
                className={c.percent >= 100 ? "fill over" : "fill"}
                style={{ width: `${Math.min(100, c.percent)}%` }}
              />
            </div>
            <span className="pct">{c.percent}%</span>
          </div>
        ))}
        <div className="metrics">
          held {state.metrics.held} · placed {state.metrics.committed} · waiting {state.metrics.waiting}
          {score && <> · caught {score.caught}/{score.planted}</>}
        </div>
      </section>

      <section className="rows">
        {state.rows.filter((r) => r.state !== "waiting").map((r) => (
          <div
            key={r.pid}
            className={`row ${r.state}`}
            onClick={() => onRow(r.pid)}
          >
            <span className="pid">{r.pid}</span>
            <span className="complaint">{r.complaint}</span>
            <span className="arrow">→</span>
            <span className="unit">{r.unit || r.proposed_unit}</span>
            <span className="status">
              {r.state === "held" ? "HELD · VERIFICATION REQUIRED" : "COMMITTED"}
            </span>
          </div>
        ))}
      </section>

      {detail && (
        <section className="detail">
          <h2>
            {detail.pid} — proposed {detail.proposed_unit}
          </h2>
          <p className="because">
            decision relied on: {detail.because.join(", ")}
          </p>
          {detail.conflicts.map((c) => (
            <div key={c.fact} className="conflict">
              <h3>{c.fact.replace(/_/g, " ")}</h3>
              <p className="reason">{c.reason}</p>
              <table>
                <tbody>
                  {c.versions.map((v) => (
                    <tr key={v.resource_id}>
                      <td>{v.source_name}</td>
                      <td>{v.recorded_date}</td>
                      <td>{v.value}</td>
                      <td>{v.status}</td>
                      <td className="rid">{v.resource_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {detail.notice && <p className="notice">{detail.notice}</p>}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write App.css**

```css
/* frontend/src/App.css */
:root { --bg:#0d1117; --fg:#e6edf3; --green:#2ea043; --amber:#d29922; --dim:#8b949e; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font-family: ui-monospace, Menlo, monospace; }
.app { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
header { display:flex; justify-content:space-between; align-items:center; }
h1 { letter-spacing: 0.3em; font-size: 20px; }
.surge { background:#8b1a1a; color:#fff; border:0; padding:14px 22px; font:inherit; font-weight:700; cursor:pointer; border-radius:4px; }
.surge:hover { background:#b02424; }
.bars { margin:24px 0; }
.bar-row { display:grid; grid-template-columns:90px 1fr 60px; align-items:center; gap:12px; margin:6px 0; }
.bar { background:#161b22; height:16px; border-radius:2px; overflow:hidden; }
.fill { background:var(--green); height:100%; }
.fill.over { background:#b02424; }
.metrics { color:var(--dim); margin-top:12px; font-size:13px; }
.rows { border-top:1px solid #21262d; }
.row { display:grid; grid-template-columns:70px 1fr 20px 110px 240px; gap:10px; padding:10px 8px; border-bottom:1px solid #21262d; cursor:pointer; border-left:3px solid transparent; }
.row.committed { border-left-color:var(--green); }
.row.held { border-left-color:var(--amber); background:#1c1708; }
.row:hover { background:#161b22; }
.status { color:var(--dim); font-size:12px; text-align:right; }
.row.held .status { color:var(--amber); }
.detail { margin-top:24px; border:1px solid var(--amber); padding:16px; border-radius:4px; }
.because { color:var(--dim); font-size:13px; }
table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
td { padding:6px 8px; border-top:1px solid #21262d; }
.rid { color:var(--dim); font-size:11px; }
.notice { color:var(--amber); font-weight:700; margin-top:12px; }
```

- [ ] **Step 5: Verify by hand**

Run backend: `CONCORD_STUB=1 .venv/bin/uvicorn backend.main:app --port 8000`
Run frontend: `cd frontend && npm run dev`
Open `localhost:5173`. Confirm: four capacity bars render; pressing MASS CASUALTY fills rows; at least one row is amber; clicking an amber row shows two source rows with dates and resource ids.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat: board UI with capacity bars, rows and conflict detail"
```

---

## Task 14: Demo hardening

**Files:**
- Create: `README.md`, `run.sh`
- Test: manual

- [ ] **Step 1: Write run.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
trap 'kill 0' EXIT
.venv/bin/uvicorn backend.main:app --port 8000 &
(cd frontend && npm run dev) &
wait
```

- [ ] **Step 2: Verify the stub path works with no network**

Run: `CONCORD_STUB=1 ./run.sh`, then turn off wifi and press MASS CASUALTY.
Expected: the board still fills and still produces held rows. If it does not, the demo is not safe — fix before sleeping.

- [ ] **Step 3: Write README.md**

Include: the one-line pitch, the safety boundary sentence, how to run, where the answer key comes from, and an explicit paragraph stating that the team injected the conflicts and why that is what makes precision/recall measurable.

- [ ] **Step 4: Rehearse the 90-second script from the spec out loud, ten times**

- [ ] **Step 5: Commit**

```bash
git add README.md run.sh
chmod +x run.sh
git commit -m "docs: README, one-command runner, demo hardening"
```

---

## Self-Review

**Spec coverage:** Section 4 (both halves on one screen) → Tasks 11, 13. Section 5 (architecture/core loop) → Tasks 6, 8, 9. Section 6 components 1–7 → Tasks 3, 4, 9, 6, 8, 13, 10. Section 7 (stack; no SimPy/OR-Tools/DB/websockets) → enforced in Global Constraints and Tasks 5, 9, 13. Section 8 (Synthea has no conflicts) → Task 4. Section 9 (demo script) → Task 14 step 4. Section 3 (safety boundary) → Global Constraints, Task 8 prompt, Task 12 `notice` field. Section 13 (policy framing) → Task 14 README. No gaps.

**Type consistency:** `Plan.because` is `list[str]` in Tasks 2, 6, 8, 9, 12. `verify(patient, facts, use_llm)` matches between Tasks 8 and 9. `Board.surge(n, use_llm)` matches Tasks 9 and 12. Answer-key row keys `pid/fact/kind/sources` match Tasks 4, 10, 12. `ConflictVersion` fields match Tasks 2, 8, 13.

**Cut order if behind** (from spec section 11): drop Task 11, then drop the LLM pass in Task 8 (`use_llm=False` everywhere — the deterministic pass alone still demos), then drop Task 10's score screen last. Never cut Tasks 3, 4, 8, or the provenance table in Task 13.
