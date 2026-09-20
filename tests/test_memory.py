"""What each agent remembers: written by code, faded by time, never about someone who has gone home."""
import asyncio
import random

from backend.agents import memory as mem
from backend.agents.cycle import Swarm
from backend.agents.llm import LLM
from backend.sim import fastlane
from backend.sim.clock import tick
from backend.sim.scenarios import build_hospital, mass_casualty


def _events():
    log = []
    return log, lambda t, d, **k: log.append((t, d, k))


def _surged(n: int = 12):
    h, key = build_hospital(7)
    mass_casualty(h, key, seed=7, n=n, start=h.clock, incident="Orleans St car crash")
    return h, key


def _rounds(h, rng, swarm, n: int, emit=None):
    for _ in range(n):
        for _ in range(4):
            tick(h, rng)
            fastlane.run(h)
        asyncio.run(swarm.run_cycle(h, emit or (lambda *a, **k: None), "test"))


def test_a_note_past_the_window_is_forgotten():
    m = mem.Memory()
    m.add("said", "old news", 1)
    m.notes[0].at -= mem.WINDOW_S + 1  # pretend it was written before the window
    m.add("said", "fresh", 2)
    assert [n.text for n in m.live()] == ["fresh"]


def test_memory_never_grows_past_the_cap():
    m = mem.Memory()
    for i in range(mem.CAP * 3):
        m.add("said", f"line {i}", i)
    assert len(m.notes) == mem.CAP
    assert m.notes[-1].text == f"line {mem.CAP * 3 - 1}"  # the newest survive


def test_a_block_is_empty_before_anything_happens():
    h, _ = build_hospital(7)
    assert mem.block(None, h) == ""
    assert mem.block(mem.Memory(), h) == ""


def test_memory_says_nothing_about_a_patient_who_went_home():
    h, _ = build_hospital(7)
    pid = next(p.pid for p in h.patients.values())
    who = h.patients[pid].name
    m = mem.Memory()
    m.add("offered", f"you offered {who} home", h.clock, pid)
    assert who in mem.block(m, h)
    h.patients[pid].state = "discharged"
    assert mem.block(m, h) == ""


def test_a_round_records_what_the_code_saw():
    h, _ = _surged()
    rng = random.Random(7)
    swarm = Swarm(LLM(mode="stub", fake_latency=False))
    _rounds(h, rng, swarm, 2)
    notes = [n for m in swarm.memory.values() for n in m.live()]
    kinds = {n.kind for n in notes}
    assert {"said", "happened"} <= kinds, kinds
    # every note about a patient names a patient the hospital knows
    assert all(n.pid in h.patients for n in notes if n.pid)


def test_the_follow_up_line_counts_promises_kept():
    h, _ = _surged()
    rng = random.Random(7)
    swarm = Swarm(LLM(mode="stub", fake_latency=False))
    assert mem.follow_up(swarm.memory, h) is None  # nothing promised yet
    _rounds(h, rng, swarm, 2)
    note = mem.follow_up(swarm.memory, h)
    assert note is not None
    text, pids = note
    assert text.startswith("Following up:")
    assert all(p in h.patients for p in pids)


def test_a_second_round_still_keeps_the_swarm_invariants():
    h, _ = _surged()
    rng = random.Random(7)
    swarm = Swarm(LLM(mode="stub", fake_latency=False))
    _rounds(h, rng, swarm, 1)  # first round fills memory
    log, emit = _events()
    _rounds(h, rng, swarm, 1, emit)  # second round reads it
    statuses = [d["unit"] for t, d, _ in log if t == "agent.status"]
    assert sorted(statuses) == sorted(["ER", "ICU", "STEPDOWN", "OR", "STAFFING", "IMAGING", "XRAY", "LAB",
                                       "BLOODBANK", "EMS"])
    assert [t for t, _, _ in log].count("coordinator.plan") == 1
    assert log[-1][0] == "cycle.end"
    assert all(k.get("cycle_id") for _, _, k in log)


def test_memory_json_is_safe_to_serve():
    h, _ = _surged()
    rng = random.Random(7)
    swarm = Swarm(LLM(mode="stub", fake_latency=False))
    _rounds(h, rng, swarm, 2)
    out = mem.as_json(swarm.memory, h)
    assert out["window_s"] == mem.WINDOW_S
    assert {a["unit"] for a in out["agents"]} >= {"ER", "ICU", "STEPDOWN"}
    for a in out["agents"]:
        for n in a["notes"]:
            assert set(n) == {"age_s", "clock", "kind", "pid", "name", "text", "here"}
