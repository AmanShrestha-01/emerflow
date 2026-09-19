import random

from backend import gate
from backend.sim import escalation, fastlane
from backend.sim.clock import tick
from backend.sim.hospital import Hospital
from backend.sim.models import Claim, Move, Patient, SourceRecord
from backend.sim.pipeline import commit, resolve_hold
from backend.sim.rules import REQUIRED_FACTS, attach_because, check_move, check_plan
from backend.sim.scenarios import build_hospital, give_records, mass_casualty


def _patient(pid="P-01", severity=3, **kw) -> Patient:
    p = Patient(pid=pid, name="Test", age=50, complaint="x", severity=severity, arrived_at=0, **kw)
    give_records(p, random.Random(1))
    return p


def _records(p, local: Claim, outside: Claim | None):
    fact = local.fact
    p.sources[0].claims[fact] = local
    if outside is None:
        p.sources[1].claims.pop(fact, None)
    else:
        p.sources[1].claims[fact] = outside


# ---------- the because list ----------
def test_every_destination_relies_on_at_least_two_facts():
    for dest, facts in REQUIRED_FACTS.items():
        assert len(facts) >= 2, dest


def test_extras_can_add_but_never_remove_required_facts():
    got = attach_because("STEPDOWN", ["penicillin_allergy", "made_up_fact"])
    assert got[:3] == REQUIRED_FACTS["STEPDOWN"]
    assert "penicillin_allergy" in got and "made_up_fact" not in got


# ---------- rules ----------
def test_full_unit_rejected_and_no_double_booking():
    h = Hospital()
    h.units["ICU"].beds = 1
    a, b = _patient("A", 2), _patient("B", 2)
    h.add_patient(a); h.add_patient(b)
    kept, dropped = check_plan([Move("m1", "A", None, "ICU", "admit"), Move("m2", "B", None, "ICU", "admit")], h)
    assert [m.pid for m in kept] == ["A"]
    assert "full" in dropped[0][1]


def test_patient_in_two_moves_is_rejected():
    h = Hospital()
    h.add_patient(_patient("A", 3))
    kept, dropped = check_plan([Move("m1", "A", None, "ER", "admit"), Move("m2", "A", None, "STEPDOWN", "admit")], h)
    assert len(kept) == 1 and "two moves" in dropped[0][1]


def test_icu_nurse_ratio_is_enforced():
    h = Hospital()
    h.nurses["ICU"] = 1  # 1 nurse : 2 patients
    for i in range(2):
        q = _patient(f"X{i}", 2, unit="ICU", state="placed")
        h.add_patient(q); h.units["ICU"].occupants.append(q.pid)
    h.add_patient(_patient("A", 2))
    assert "nurse" in check_move(Move("m", "A", None, "ICU", "admit"), h)


def test_moves_above_the_current_level_are_rejected():
    h = Hospital()
    h.add_patient(_patient("A", 3))
    m = Move("m", "A", None, "HALLWAY", "admit")
    assert "level 2" in check_move(m, h)
    h.level = 2
    assert check_move(m, h) is None


def test_severity_one_may_always_use_the_hallway():
    h = Hospital()
    h.add_patient(_patient("A", 1))
    assert check_move(Move("m", "A", None, "HALLWAY", "admit"), h) is None


def test_ct_blocks_stepdown_until_scanned():
    h = Hospital()
    h.add_patient(_patient("A", 3, needs_ct=True))
    assert "CT" in check_move(Move("m", "A", None, "STEPDOWN", "admit"), h)


# ---------- DeepChart gate ----------
def test_gate_holds_when_sources_disagree():
    p = _patient()
    _records(p, Claim("anticoagulant", "none recorded", "absent", "r1"),
             Claim("anticoagulant", "warfarin 5mg", "active", "r2"))
    v = gate.check(p, ["anticoagulant"], "STEPDOWN")
    assert len(v.conflicts) == 1 and v.blocking
    assert {x.source_name for x in v.conflicts[0].versions} == {"Local intake", "Hospital B - Cardiology"}


def test_not_mentioned_is_a_gap_not_a_conflict():
    p = _patient()
    _records(p, Claim("anticoagulant", "warfarin 5mg", "active", "r1"), None)
    assert gate.check(p, ["anticoagulant"], "STEPDOWN").clear


def test_gate_only_checks_the_because_facts():
    p = _patient()
    _records(p, Claim("penicillin_allergy", "Penicillin G", "present", "r1"),
             Claim("penicillin_allergy", "no known allergies", "absent", "r2"))
    assert gate.check(p, ["anticoagulant", "vitals_stable"], "STEPDOWN").clear


def test_life_saving_destinations_are_flagged_not_blocked():
    h = Hospital()
    p = _patient("A", 1)
    _records(p, Claim("anticoagulant", "none recorded", "absent", "r1"),
             Claim("anticoagulant", "warfarin 5mg", "active", "r2"))
    h.add_patient(p)
    assert commit(h, Move("m", "A", None, "RESUS", "admit"), ) == "flagged"
    assert p.unit == "RESUS" and p.records_flag


def test_held_patient_takes_no_bed_but_reserves_one_then_human_resolves():
    h = Hospital()
    p = _patient("A", 3)
    _records(p, Claim("anticoagulant", "none recorded", "absent", "r1"),
             Claim("anticoagulant", "warfarin 5mg", "active", "r2"))
    h.add_patient(p)
    assert commit(h, Move("m", "A", None, "STEPDOWN", "admit")) == "held"
    assert p.state == "held" and p.unit is None and "A" in h.units["STEPDOWN"].reserved
    assert check_move(Move("m2", "A", None, "ER", "admit"), h) is not None  # locked
    (hold_id,) = h.holds
    resolve_hold(h, hold_id, "proceed")
    assert p.unit == "STEPDOWN" and p.state == "placed" and not h.locked


# ---------- fast lane ----------
def test_fastlane_never_leaves_severity_one_unplaced():
    h, key = build_hospital(7)
    mass_casualty(h, key, n=25)
    rng = random.Random(0)
    for _ in range(15):
        tick(h, rng, walkins=False)
        fastlane.run(h)
    for p in h.patients.values():
        if p.severity == 1 and p.state != "incoming":
            assert p.unit in ("RESUS", "HALLWAY", "ICU", "OR"), (p.pid, p.state)


# ---------- escalation ----------
def test_escalation_rises_under_surge_and_has_hysteresis():
    h, key = build_hospital(7)
    assert escalation.compute_level(h) <= 1
    mass_casualty(h, key, n=25)
    rng = random.Random(0)
    for _ in range(15):
        tick(h, rng, walkins=False)
        fastlane.run(h)
    assert h.level >= 2
    # small relief is not enough to drop straight to 0
    lvl = h.level
    escalation.update_level(h)
    assert h.level >= lvl - 1


def test_seeded_surge_plants_conflicts_on_relied_upon_facts():
    h, key = build_hospital(7)
    mass_casualty(h, key, n=25)
    assert len(key) >= 8
    for row in key:
        assert row["fact"] in {f for fs in REQUIRED_FACTS.values() for f in fs}


def test_held_bed_stays_reserved_until_a_human_decides_and_verification_is_remembered():
    h = Hospital()
    p = _patient("A", 3)
    _records(p, Claim("anticoagulant", "none recorded", "absent", "r1"),
             Claim("anticoagulant", "warfarin 5mg", "active", "r2"))
    h.add_patient(p)
    commit(h, Move("m", "A", None, "STEPDOWN", "admit"))
    h.clock += 500
    h.expire_reservations()
    assert "A" in h.units["STEPDOWN"].reserved  # a slow human doesn't lose the bed
    (hold_id,) = h.holds
    resolve_hold(h, hold_id, "proceed")
    assert "anticoagulant" in p.verified
    # the same records conflict is not raised again for this patient
    assert gate.check(p, ["anticoagulant"], "ICU").clear


def test_hallway_is_only_life_saving_for_severity_one():
    h = Hospital()
    h.level = 2
    p = _patient("A", 4)
    _records(p, Claim("vitals_stable", "stable", "present", "r1"),
             Claim("vitals_stable", "unstable", "present", "r2"))
    h.add_patient(p)
    assert commit(h, Move("m", "A", None, "HALLWAY", "admit")) == "held"
