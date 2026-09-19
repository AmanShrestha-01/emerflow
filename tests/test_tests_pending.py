"""X-ray and lab work-ups: real queues behind the X-ray and Lab agents, and the rule that uses them."""
import random

from backend.agents.departments import BY_NAME
from backend.sim.clock import LAB_MIN, XRAY_EVERY, XRAY_ROOMS, tick
from backend.sim.models import Move
from backend.sim.rules import check_move
from backend.sim.scenarios import _patient, build_hospital, mass_casualty


def _arrival(h, sev, complaint, **kw):
    p = _patient(h, random.Random(sev), "WI", sev, complaint, arrived_at=h.clock, state="waiting", **kw)
    h.add_patient(p)
    return p


def test_new_arrivals_get_tests_and_inpatients_do_not():
    h, key = build_hospital(7)
    assert not any(p.tests_pending() for p in h.patients.values())  # the seeded inpatients were worked up already
    pts = mass_casualty(h, key, seed=7, start=h.clock)
    assert any(p.needs_xray for p in pts) and any(p.needs_labs for p in pts)
    assert all(p.needs_labs == (p.severity <= 3) for p in pts)
    assert all(p.needs_xray for p in pts if "fracture" in p.complaint or "broken" in p.complaint)


def test_xray_rooms_clear_the_sickest_first():
    h, _ = build_hospital(7)
    arm = _arrival(h, 3, "broken arm")
    leg = _arrival(h, 2, "open leg fracture")
    ankle = _arrival(h, 4, "sprained ankle")
    rng = random.Random(1)
    while h.clock % XRAY_EVERY != XRAY_EVERY - 1:
        tick(h, rng, walkins=False)
    assert h.xray_queue[0] == leg.pid
    tick(h, rng, walkins=False)  # one X-ray round: both rooms finish an image
    done = [p for p in (leg, arm, ankle) if p.xray_done]
    assert done == [leg, arm][:XRAY_ROOMS] and not ankle.xray_done


def test_lab_results_take_time_and_go_sickest_first():
    h, _ = build_hospital(7)
    mild = _arrival(h, 3, "abdominal pain")
    sick = _arrival(h, 1, "sepsis, confused")
    rng = random.Random(1)
    for _ in range(LAB_MIN - 1):
        tick(h, rng, walkins=False)
    assert not sick.labs_done and not mild.labs_done  # no result sooner than LAB_MIN
    tick(h, rng, walkins=False)
    assert sick.labs_done and not mild.labs_done
    tick(h, rng, walkins=False)
    assert mild.labs_done and not h.lab_queue


def test_pending_tests_block_regular_beds_but_never_life_saving_ones():
    h, _ = build_hospital(7)
    p = _arrival(h, 3, "broken arm")
    assert p.tests_pending() == ["X-ray", "lab results"]
    assert "X-ray" in (check_move(Move("M1", p.pid, None, "STEPDOWN", "admit"), h) or "")
    er_why = check_move(Move("M2", p.pid, None, "ER", "admit"), h) or ""  # may be full, but never for tests
    assert "X-ray" not in er_why and "lab" not in er_why
    p.xray_done = True
    assert "lab results" in (check_move(Move("M3", p.pid, None, "STEPDOWN", "admit"), h) or "")
    crit = _arrival(h, 1, "multiple trauma, unresponsive")
    for dest in ("RESUS", "ICU", "HALLWAY"):
        why = check_move(Move("M4", crit.pid, None, dest, "admit"), h) or ""
        assert "X-ray" not in why and "lab" not in why


def test_xray_and_lab_agents_have_rule_based_fallbacks():
    h, key = build_hospital(7)
    mass_casualty(h, key, seed=7, start=h.clock - 10)
    tick(h, random.Random(1), walkins=False)
    for name, word in (("XRAY", "X-ray"), ("LAB", "sample")):
        st = BY_NAME[name].stub(h)
        assert word in st.line and st.blockers
