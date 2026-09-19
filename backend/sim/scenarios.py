"""Seeded scenarios: a nearly full hospital, a mass-casualty surge, and planted record conflicts.

Every patient gets two record sources (local intake + an outside hospital). Conflicts are planted
into the outside source only, on facts their placement will rely on, and written to an answer key
so we can measure what the DeepChart gate catches.
"""
from __future__ import annotations

import datetime as _dt
import random

from backend.sim.hospital import Hospital
from backend.sim.models import Claim, ORCase, Patient, SourceRecord

TODAY = _dt.date(2026, 9, 19)
FIRST = ["Maya", "Omar", "Lena", "Jon", "Priya", "Luis", "Grace", "Tariq", "Ivy", "Sam", "Nia",
         "Ben", "Rosa", "Kai", "Elena", "Dev", "Hana", "Marco", "Zoe", "Amir", "Tess", "Noah",
         "Ada", "Felix", "June", "Ravi", "Iris", "Theo", "Mei", "Cole"]
LAST = ["Park", "Diaz", "Okafor", "Reyes", "Cho", "Singh", "Novak", "Haddad", "Brooks", "Ito",
        "Kowalski", "Mensah", "Silva", "Grant", "Lopez", "Ahmed", "Moreau", "Kim"]

MCI_COMPLAINTS: dict[int, list[tuple[str, bool, bool]]] = {  # (complaint, needs_ct, needs_blood)
    1: [("multiple trauma, unresponsive", True, True), ("internal bleeding, low pressure", True, True)],
    2: [("chest injury, hard to breathe", True, False), ("head injury, confused", True, False),
        ("open leg fracture", False, True)],
    3: [("abdominal pain after impact", True, False), ("broken arm", False, False),
        ("fainted at scene", False, False)],
    4: [("cuts and bruises", False, False), ("sprained ankle", False, False)],
    5: [("minor scrapes", False, False), ("panic, no injury", False, False)],
}
WALKIN_COMPLAINTS = [(3, "chest pain"), (4, "fever"), (3, "shortness of breath"), (4, "back pain"),
                     (2, "stroke symptoms"), (5, "rash"), (3, "kidney stone")]
BLOOD_TYPES = ["O+", "O+", "A+", "A+", "B+", "O-", "A-", "AB+"]


def _name(rng: random.Random) -> str:
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def _claims(p: Patient, rng: random.Random, sid: str) -> dict[str, Claim]:
    on_thinner = rng.random() < 0.3
    allergic = rng.random() < 0.15
    pressors = p.unit == "ICU" and not p.improving and rng.random() < 0.5
    c = {
        "anticoagulant": Claim("anticoagulant", "warfarin 5mg" if on_thinner else "none recorded",
                               "active" if on_thinner else "absent", f"MedicationStatement/{sid}-{p.pid}-ac"),
        "penicillin_allergy": Claim("penicillin_allergy", "Penicillin G" if allergic else "no known allergies",
                                    "present" if allergic else "absent", f"AllergyIntolerance/{sid}-{p.pid}"),
        "vitals_stable": Claim("vitals_stable", "stable" if p.severity >= 3 else "unstable", "present",
                               f"Observation/{sid}-{p.pid}-vitals"),
        "icu_need": Claim("icu_need", "yes" if p.severity <= 2 else "no",
                          "present" if p.severity <= 2 else "absent", f"Condition/{sid}-{p.pid}-icu"),
        "on_pressors": Claim("on_pressors", "norepinephrine" if pressors else "none recorded",
                             "active" if pressors else "absent", f"MedicationStatement/{sid}-{p.pid}-press"),
        "blood_type": Claim("blood_type", p.blood_type, "present", f"Observation/{sid}-{p.pid}-abo"),
    }
    return c


def give_records(p: Patient, rng: random.Random) -> None:
    """Two agreeing sources; the outside one sometimes simply doesn't mention a fact (a gap)."""
    local = SourceRecord("local", "Local intake", TODAY.isoformat(), _claims(p, rng, "loc"))
    outside_claims = {k: Claim(v.fact, v.value, v.status, v.resource_id.replace("/loc-", "/hb-"))
                      for k, v in local.claims.items()}
    for fact in list(outside_claims):
        if fact != "blood_type" and rng.random() < 0.12:
            del outside_claims[fact]  # "not mentioned" -> a gap, never a conflict
    days = rng.randint(14, 400)
    outside = SourceRecord("hospital_b", "Hospital B - Cardiology",
                           (TODAY - _dt.timedelta(days=days)).isoformat(), outside_claims)
    p.sources = [local, outside]


def plant(p: Patient, fact: str, kind: str, key: list[dict]) -> None:
    """Make the outside source disagree with local intake on one fact."""
    local = p.sources[0].claims[fact]
    outside = p.sources[1]
    rid = local.resource_id.replace("/loc-", "/hb-")
    if kind == "existence":
        if local.status == "absent":
            new = Claim(fact, {"anticoagulant": "warfarin 5mg", "penicillin_allergy": "Penicillin G",
                               "on_pressors": "norepinephrine", "icu_need": "yes"}.get(fact, "yes"), "active", rid)
        else:
            new = Claim(fact, "none recorded", "absent", rid)
    elif kind == "status":
        new = Claim(fact, local.value, "stopped" if local.status != "stopped" else "active", rid)
        if local.status == "absent":
            new = Claim(fact, "warfarin 5mg", "stopped", rid)
    elif kind == "value":
        swaps = {"stable": "unstable", "unstable": "stable", "warfarin 5mg": "warfarin 2.5mg",
                 "yes": "no"}
        if fact == "blood_type":
            new = Claim(fact, "A+" if local.value != "A+" else "O+", "present", rid)
        elif local.value in swaps and local.status != "absent":
            new = Claim(fact, swaps[local.value], local.status, rid)
        else:
            new = Claim(fact, "warfarin 2.5mg", "active", rid) if fact == "anticoagulant" else \
                Claim(fact, "unstable", "present", rid)
            if local.status == "absent":
                kind = "existence"
    else:
        raise ValueError(kind)
    outside.claims[fact] = new
    key.append({"pid": p.pid, "fact": fact, "kind": kind})


def _patient(h: Hospital, rng: random.Random, prefix: str, severity: int, complaint: str,
             arrived_at: int, **kw) -> Patient:
    pid = f"{prefix}-{len([x for x in h.patients if x.startswith(prefix)]) + 1:02d}"
    p = Patient(pid=pid, name=_name(rng), age=rng.randint(19, 88), complaint=complaint,
                severity=severity, arrived_at=arrived_at, blood_type=rng.choice(BLOOD_TYPES), **kw)
    return p


def build_hospital(seed: int = 7) -> tuple[Hospital, list[dict]]:
    """A hospital already near capacity, with inpatients who have records. Returns (hospital, answer_key)."""
    rng = random.Random(seed)
    h = Hospital()
    key: list[dict] = []
    fill = {"ER": (14, 3, 5), "ICU": (9, 1, 2), "STEPDOWN": (12, 2, 3), "WARD": (27, 3, 5), "PACU": (1, 2, 3),
            "RESUS": (1, 1, 1)}
    for unit, (n, lo, hi) in fill.items():
        for i in range(n):
            sev = rng.randint(lo, hi)
            p = _patient(h, rng, "IN", sev, rng.choice(["pneumonia", "post-op recovery", "heart failure",
                                                        "sepsis", "COPD flare", "hip fracture"]),
                         arrived_at=-rng.randint(60, 600), unit=unit, state="placed")
            p.placed_at = p.arrived_at + rng.randint(5, 60)
            if unit == "ICU" and i < 3:
                p.improving, p.severity = True, 2  # ready to step down
            if unit == "STEPDOWN" and i < 3:
                p.improving, p.severity = True, 3  # ready for the ward
            if unit == "WARD" and i < 5:
                p.ready_for_discharge = True
            give_records(p, rng)
            h.add_patient(p)
            h.units[unit].occupants.append(p.pid)
    # Two elective surgeries running, two more scheduled. Each holds a PACU bed for recovery;
    # a case holds an OR room once it starts (the clock adds that reservation).
    for i, (start, end) in enumerate([(-40, 50), (-20, 70), (30, 120), (45, 150)]):
        cid = f"C{i + 1}"
        h.or_cases.append(ORCase(cid, pid=f"elective-{cid}", kind="elective", starts_at=start, ends_at=end))
        if start <= 0:
            h.units["OR"].reserved[f"case:{cid}"] = end
        h.units["PACU"].reserved[f"case:{cid}"] = end + 60
    # Planted conflicts on inpatients whose next move relies on the fact.
    icu_improving = [p for p in h.in_unit("ICU") if p.improving]
    ward_ready = [p for p in h.in_unit("WARD") if p.ready_for_discharge]
    plant(icu_improving[0], "vitals_stable", "value", key)
    plant(ward_ready[0], "anticoagulant", "existence", key)
    plant(ward_ready[1], "vitals_stable", "value", key)
    h.version += 1
    return h, key


def mass_casualty(h: Hospital, key: list[dict], seed: int = 7, n: int = 25, start: int | None = None) -> list[Patient]:
    """A bus crash: n patients arriving over the next ~12 minutes. Plants conflicts in some of them."""
    rng = random.Random(seed * 1000 + 1)
    start = h.clock if start is None else start
    mix = [1] * 3 + [2] * 6 + [3] * 9 + [4] * 5 + [5] * 2
    rng.shuffle(mix)
    out: list[Patient] = []
    for sev in mix[:n]:
        complaint, ct, blood = rng.choice(MCI_COMPLAINTS[sev])
        p = _patient(h, rng, "MC", sev, complaint, arrived_at=start + rng.randint(1, 12),
                     state="incoming", needs_ct=ct, needs_blood=blood)
        give_records(p, rng)
        h.add_patient(p)
        out.append(p)
    # Plant on facts their likely destination relies on (anticoagulant is in almost every unit's list).
    by_sev = {s: [p for p in out if p.severity == s] for s in range(1, 6)}
    targets = [(by_sev[1][:1], "anticoagulant", "existence"),   # emergency: placed, but flagged
               (by_sev[2][:2], "anticoagulant", "existence"),
               (by_sev[3][:2], "anticoagulant", "status"),
               (by_sev[3][2:3], "vitals_stable", "value"),
               (by_sev[4][:1], "vitals_stable", "value"),
               (by_sev[2][2:3], "icu_need", "value")]
    for pts, fact, kind in targets:
        for p in pts:
            plant(p, fact, kind, key)
    return out


def walk_in(h: Hospital, rng: random.Random) -> Patient:
    sev, complaint = rng.choice(WALKIN_COMPLAINTS)
    p = _patient(h, rng, "WI", sev, complaint, arrived_at=h.clock, state="waiting",
                 needs_ct=complaint in ("stroke symptoms", "chest pain"))
    give_records(p, rng)
    h.add_patient(p)
    return p
