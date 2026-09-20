"""What each agent remembers: written by code, faded by time, never about someone who has gone home."""
import asyncio
import random
import re

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
    m.add("happened", "old news", 1)  # an accumulating kind: "said" keeps only one note either way
    m.notes[0].at -= mem.WINDOW_S + 1  # pretend it was written before the window
    m.add("happened", "fresh", 2)
    assert len(m.notes) == 2          # both are still stored...
    assert [n.text for n in m.live()] == ["fresh"]  # ...but only one is still in mind


def test_memory_never_grows_past_the_cap():
    m = mem.Memory()
    for i in range(mem.CAP * 3):
        m.add("happened", f"line {i}", i)  # an accumulating kind; "said" keeps only the newest
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
    """A round records what each department said and offered. Outcomes arrive separately, through
    record_move, because they belong to every move and not only the ones the coordinator planned."""
    h, _ = _surged()
    rng = random.Random(7)
    swarm = Swarm(LLM(mode="stub", fake_latency=False))
    _rounds(h, rng, swarm, 2)
    notes = [n for m in swarm.memory.values() for n in m.live()]
    kinds = {n.kind for n in notes}
    assert {"said", "offered"} <= kinds, kinds
    # every note about a patient names a patient the hospital knows
    assert all(n.pid in h.patients for n in notes if n.pid)


def test_an_outcome_is_remembered_whoever_caused_it():
    """The fast lane, the clock and a human all move patients. None of them is the swarm, and the
    departments used to remember none of it."""
    h, _ = _surged()
    memories = {d: mem.Memory() for d in ("ER", "ICU", "STEPDOWN", "OR", "STAFFING", "IMAGING", "XRAY",
                                          "LAB", "BLOODBANK", "EMS")}
    pid = next(p.pid for p in h.patients.values() if p.unit == "ER")
    who = h.patients[pid].name

    mem.record_move(memories, h, "move.applied", {"pid": pid, "from_unit": "ER", "to_unit": "WARD"})
    er = [n.text for n in memories["ER"].live()]
    ward = [n.text for n in memories["STEPDOWN"].live()]  # STEPDOWN speaks for the ward
    assert er == [f"{who} moved to a ward bed"], er
    assert ward == [f"{who} moved to a ward bed"], ward

    # and the reason on a refusal reaches memory in plain words, not unit codes
    mem.record_move(memories, h, "move.dropped",
                    {"pid": pid, "to_unit": "ICU", "reason": "ICU is full"})
    icu = [n.text for n in memories["ICU"].live()]
    assert icu and "intensive care is full" in icu[0], icu
    assert "ICU" not in icu[0]


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
    kept, total = (int(n) for n in re.search(r"Following up: (\d+) of (\d+)", text).groups())
    assert 0 <= kept <= total, text


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


def test_saying_the_same_thing_again_refreshes_one_note():
    m = mem.Memory()
    m.add("said", "we have no O-negative blood", 10)
    m.add("offered", "you offered Ana Diaz a ward bed", 11, "W-1")
    m.add("said", "we have no O-negative blood", 14)  # the same report, a round later
    assert [n.text for n in m.notes] == ["you offered Ana Diaz a ward bed", "we have no O-negative blood"]
    assert m.notes[-1].clock == 14  # and it is the fresh one that survived


def test_only_the_newest_status_line_survives():
    """A status line quotes a bed count. Two of them in one prompt is a stale number beside a live one."""
    m = mem.Memory()
    m.add("said", 'you said: "We have three beds open."', 10)
    m.add("offered", "you offered Ana Diaz a ward bed", 11, "W-1")
    m.add("said", 'you said: "We have one bed open."', 20)
    said = [n.text for n in m.notes if n.kind == "said"]
    assert said == ['you said: "We have one bed open."']
    assert any(n.kind == "offered" for n in m.notes)  # events still accumulate


def test_a_later_answer_replaces_the_earlier_one():
    """Both halves of "could not move to surgery" / "moved to surgery" used to reach the next prompt."""
    m = mem.Memory()
    k = "move:P-1>OR"
    m.add("happened", "Marco Ahmed could not move to surgery (OR is full)", 10, "P-1", key=k)
    m.add("happened", "Marco Ahmed moved to surgery", 16, "P-1", key=k)
    assert [n.text for n in m.notes] == ["Marco Ahmed moved to surgery"]


def test_a_different_destination_is_a_different_fact():
    """Refused by close-watch, then taken by intensive care: both are true and both are kept."""
    m = mem.Memory()
    m.add("happened", "Hana Ito could not move to a close-watch bed", 10, "P-2", key="move:P-2>STEPDOWN")
    m.add("happened", "Hana Ito moved to an intensive care bed", 12, "P-2", key="move:P-2>ICU")
    assert len(m.notes) == 2


def test_notes_are_written_in_words_not_codes():
    """A note is read by a person as well as by an agent: no unit codes, no patient codes, no bare X."""
    h, _ = build_hospital(7)
    memories = {"ER": mem.Memory(), "ICU": mem.Memory(), "STEPDOWN": mem.Memory()}
    pid = next(p.pid for p in h.patients.values() if p.unit == "ER")
    mem.record_move(memories, h, "move.dropped", {"pid": pid, "to_unit": "STEPDOWN", "reason": "STEPDOWN is full"})
    text = memories["STEPDOWN"].live()[0].text
    assert "the close-watch beds are full" in text, text
    assert "STEPDOWN" not in text
    assert mem.readable("X-ray is busy") == "X-ray is busy"  # not every X is a patient

    # a casualty nobody has identified is literally named X, and the validator's reasons quote patient
    # codes, so the raw name came back through the reason even though the subject was sanitised
    nameless = next(iter(h.patients.values()))
    nameless.name = "X"
    mem.record_move(memories, h, "move.dropped",
                    {"pid": nameless.pid, "to_unit": "OR", "reason": f"{nameless.pid} is waiting for a scan"})
    got = memories["ER"].live()[-1].text if memories["ER"].live() else ""
    got = [n.text for n in memories["OR"].live()][-1] if "OR" in memories else got
    assert " X " not in f" {got} ", got


def _depts():
    return {d: mem.Memory() for d in ("ER", "ICU", "STEPDOWN", "OR", "STAFFING", "IMAGING", "XRAY", "LAB",
                                      "BLOODBANK", "EMS")}


def test_a_promise_is_a_patient_and_a_place():
    """Matching on the patient alone credited a department for a move it did not make: it offered a ward
    bed, somebody else took the patient to the critical care room, and the board called it kept."""
    h, _ = _surged()
    memories = _depts()
    p = next(x for x in h.patients.values() if x.state in mem.HERE)
    memories["ER"].add("offered", f"you offered to move {p.name} to a ward bed", h.clock, p.pid,
                       key=f"offer:{p.pid}>WARD", dest="WARD")
    mem.record_move(memories, h, "move.applied", {"pid": p.pid, "from_unit": "ER", "to_unit": "RESUS"})

    text, _ = mem.follow_up(memories, h)
    assert text.startswith("Following up: 0 of 1"), text  # they moved, but not where it was promised

    mem.record_move(memories, h, "move.applied", {"pid": p.pid, "from_unit": "RESUS", "to_unit": "WARD"})
    text, _ = mem.follow_up(memories, h)
    assert text.startswith("Following up: 1 of 1"), text  # now the promise is kept


def test_a_life_saving_move_is_not_reported_as_a_broken_promise():
    """A records conflict on a life-saving move comes back "flagged", and that event used to carry no
    source unit — so the department that offered the patient never learned it had happened, and the
    board announced it had broken its word about a patient already lying in the new bed."""
    h, _ = _surged()
    memories = _depts()
    p = next(x for x in h.patients.values() if x.unit == "ER")
    memories["ER"].add("offered", f"you offered to move {p.name} to an intensive care bed", h.clock, p.pid,
                       key=f"offer:{p.pid}>ICU", dest="ICU")
    mem.record_move(memories, h, "move.flagged", {"pid": p.pid, "from_unit": "ER", "to_unit": "ICU"})

    assert any(n.kind == "happened" and n.ok for n in memories["ER"].live()), "the source never learned"
    text, _ = mem.follow_up(memories, h)
    assert text.startswith("Following up: 1 of 1"), text
    assert "still here" not in text


def test_a_department_that_owns_no_beds_still_hears_the_answer():
    """Five of the ten departments speak for no unit. They can still offer a patient, and used to be
    named on the board every round for a promise that had in fact been kept."""
    h, _ = _surged()
    memories = _depts()
    p = next(x for x in h.patients.values() if x.state in mem.HERE)
    memories["LAB"].add("offered", f"you offered to move {p.name} to a ward bed", h.clock, p.pid,
                        key=f"offer:{p.pid}>WARD", dest="WARD")
    mem.record_move(memories, h, "move.applied", {"pid": p.pid, "from_unit": "ER", "to_unit": "WARD"})
    assert [n.text for n in memories["LAB"].live() if n.kind == "happened"], "the lab never heard"
    text, _ = mem.follow_up(memories, h)
    assert text.startswith("Following up: 1 of 1"), text


def test_an_order_about_a_discharged_patient_leaves_the_prompt():
    """An order used to be one line naming three people with no id attached, and a note with no id
    cannot be filtered when a patient goes home."""
    h, _ = _surged()
    m = mem.Memory()
    p = next(x for x in h.patients.values() if x.state in mem.HERE)
    m.add("ordered", f"the coordinator asked you to move {p.name} home", h.clock, p.pid, key=f"ordered:{p.pid}")
    assert p.name in mem.block(m, h)
    p.state = "discharged"
    assert mem.block(m, h) == ""
