"""Fast lane: code places the obvious cases instantly, so nobody waits on the AI.

- Severity 1 always gets a resuscitation bay, or a hallway overflow bed. Never "no place".
- Anyone whose natural unit has a clearly free bed is placed greedily.
Everything else stays in the queue for the swarm.
"""
from __future__ import annotations

from backend.sim.hospital import Hospital
from backend.sim.models import Move, Patient
from backend.sim.pipeline import Emit, _noop, commit
from backend.sim.rules import check_move


def preferred_unit(p: Patient) -> str:
    if p.severity == 1:
        return "RESUS"
    if p.severity == 2:
        return "ICU"
    if p.severity == 3:
        return "ER" if p.needs_ct and not p.ct_done else "STEPDOWN"
    return "ER"


def place_one(h: Hospital, p: Patient, emit: Emit = _noop, source: str = "fastlane") -> str | None:
    options = ["RESUS", "ICU", "HALLWAY"] if p.severity == 1 else [preferred_unit(p)]
    for unit in options:
        where = {"RESUS": "resuscitation", "ICU": "an ICU bed", "HALLWAY": "a hallway bed (overflow)",
                 "ER": "an emergency bed", "STEPDOWN": "a step-down bed"}.get(unit, unit)
        reason = (f"Life-threatening: straight to {where}" if p.severity == 1
                  else f"{p.need or 'Care needed'}: {where} was free")
        m = Move(h.next_id("M"), p.pid, p.unit, unit, "admit", source=source, reason=reason)
        if check_move(m, h) is None:
            return commit(h, m, emit)
    return None


def run(h: Hospital, emit: Emit = _noop) -> dict[str, int]:
    counts: dict[str, int] = {}
    for p in h.waiting():
        result = place_one(h, p, emit)
        if result:
            counts[result] = counts.get(result, 0) + 1
    return counts
