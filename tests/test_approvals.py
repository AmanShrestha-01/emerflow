"""Transfer-out approvals: what the human is shown is what gets locked, and what gets moved."""
import random

from backend.agents.schemas import PlanEscalation
from backend.sim import approvals, clock, rules
from backend.sim.models import Move
from backend.sim.scenarios import build_hospital, mass_casualty


def _surge_hospital():
    h, key = build_hospital(7)
    mass_casualty(h, key, seed=7, n=10, start=h.clock, incident="crash")
    h.level = 3
    return h


def test_an_approval_only_locks_the_patients_it_names():
    """The model writes the pid list free-hand, so it can name someone who is not in a bed at all.
    Locking them would refuse every destination for the rest of the run, with nothing saying why."""
    h = _surge_hospital()
    placed = next(p.pid for p in h.patients.values() if p.state == "placed")
    not_in_a_bed = next(p.pid for p in h.patients.values() if p.state != "placed")

    a = approvals.request(h, PlanEscalation(action="transfer_out", reason="surge",
                                            pids=[placed, not_in_a_bed, "IN-99"]))
    assert placed in a.detail and not_in_a_bed not in a.detail  # the human is shown one name
    assert h.locked == {placed}                                  # and only that one is locked


def test_approving_a_transfer_with_an_invented_patient_does_not_crash():
    """An id the model made up used to raise KeyError after the approval had already been popped: the
    board showed a 500 and the approval was gone."""
    h = _surge_hospital()
    placed = next(p.pid for p in h.patients.values() if p.state == "placed")
    a = approvals.request(h, PlanEscalation(action="transfer_out", reason="surge", pids=[placed, "IN-99"]))
    assert "applied" in approvals.resolve(h, a.approval_id, True)


def test_an_expired_approval_lets_its_patients_go():
    h = _surge_hospital()
    placed = next(p.pid for p in h.patients.values() if p.state == "placed")
    approvals.request(h, PlanEscalation(action="transfer_out", reason="surge", pids=[placed]))
    assert placed in h.locked
    h.level = 0
    clock.tick(h, random.Random(1))  # the level drops, so the approval expires
    assert not h.approvals
    assert placed not in h.locked, "an expired approval left its patients locked for the rest of the run"
    m = Move(h.next_id("M"), placed, h.patients[placed].unit, "STEPDOWN", "step down", source="swarm")
    assert rules.check_move(m, h) != f"{placed} is locked by a pending hold or approval"
