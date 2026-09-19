"""The one path every move takes, whoever proposed it: rules check → DeepChart gate → hold or apply."""
from __future__ import annotations

from typing import Callable

from backend import gate
from backend.sim.hospital import Hold, Hospital
from backend.sim.models import Move, Verdict
from backend.sim.rules import attach_because, check_move
from backend.sim.words import facts_phrase, place, plain

HOLD_UNTIL = 10**9  # a held patient's target bed stays reserved until a human decides

Emit = Callable[..., object]

BY = {"fastlane": "Hospital rules", "swarm": "AI agents", "fallback": "Hospital rules",
      "baseline": "Hospital rules", "human": "A person"}
PLACE = {"RESUS": "the critical care room", "ER": "an emergency bed", "HALLWAY": "an extra hallway bed", "ICU": "an intensive care bed",
         "STEPDOWN": "a close-watch bed", "WARD": "a ward bed", "OR": "surgery", "PACU": "the recovery room",
         "LOUNGE": "the going-home lounge", "HOME": "home", "PARTNER": "a partner hospital"}


def _noop(*_a, **_k) -> None:
    return None


def conflicts_json(verdict) -> list[dict]:
    return [{"fact": c.fact, "reason": c.reason, "versions": [v.__dict__ for v in c.versions]}
            for c in verdict.conflicts]


def commit(h: Hospital, m: Move, emit: Emit = _noop, *, verified: bool = False, **ev) -> str:
    """Returns "applied" | "flagged" | "held" | "dropped". `verified` = a human already checked the records."""
    m.because = attach_because(m.to_unit, m.because)
    reason = check_move(m, h)
    if reason:
        emit("move.dropped", {"pid": m.pid, "to_unit": m.to_unit, "reason": reason, "source": m.source}, **ev)
        return "dropped"
    p = h.patients[m.pid]
    verdict = gate.check(p, m.because, m.to_unit) if h.records_check else Verdict()
    if verdict.conflicts and not verified:
        if verdict.blocking:
            hold = Hold(h.next_id("H"), m, verdict, h.clock)
            h.holds[hold.hold_id] = hold
            h.reserve(p.pid, m.to_unit, HOLD_UNTIL)
            h.locked.add(p.pid)
            p.state = "held"
            p.heading_to = m.to_unit
            about = facts_phrase([c.fact for c in verdict.conflicts])
            first = p.name.split()[0]
            what = (f"Can't send {first} home yet" if m.to_unit == "HOME" else
                    f"Can't move {first} to {place(m.to_unit)} yet")
            p.note, p.note_by = (f"{what}: two hospitals' records disagree about {about}. A person needs to check.",
                                 "Records check")
            emit("move.held", {"hold_id": hold.hold_id, "pid": p.pid, "to_unit": m.to_unit,
                               "because": m.because, "conflicts": conflicts_json(verdict)}, **ev)
            return "held"
        p.records_flag = True
        h.apply_move(m)
        about = facts_phrase([c.fact for c in verdict.conflicts])
        p.note, p.note_by = (f"Moved to {place(m.to_unit)} straight away to save their life. Two hospitals' records "
                             f"disagree about {about}, so a person should check.", BY.get(m.source, m.source))
        emit("move.flagged", {"pid": p.pid, "to_unit": m.to_unit, "because": m.because,
                              "conflicts": conflicts_json(verdict)}, **ev)
        return "flagged"
    from_unit = p.unit
    h.apply_move(m)
    p.heading_to = None
    reason = plain(m.reason, h)
    p.note = (reason[:1].upper() + reason[1:]) if reason else f"Moved to {place(m.to_unit)}"
    p.note_by = "A person (after checking the records)" if verified else BY.get(m.source, m.source)
    emit("move.applied", {"move_id": m.move_id, "pid": p.pid, "name": p.name, "from_unit": from_unit, "to_unit": m.to_unit,
                          "source": m.source, "because": m.because, "reason": m.reason}, **ev)
    return "applied"


def resolve_hold(h: Hospital, hold_id: str, outcome: str, emit: Emit = _noop) -> str:
    """A human resolved a records conflict. "proceed" re-validates against live state; "cancel" undoes the hold."""
    hold = h.holds.pop(hold_id)
    p = h.patients[hold.move.pid]
    h.locked.discard(p.pid)
    p.state = "placed" if p.unit else "waiting"
    reserved = any(p.pid in u.reserved for u in h.units.values())
    detail = "hold cancelled; patient stays where they are"
    p.heading_to = None
    if outcome != "proceed":
        p.note, p.note_by = "A person checked the records and decided not to move them for now", "A person"
    if outcome == "proceed":
        p.verified.update(c.fact for c in hold.verdict.conflicts)
        m = hold.move
        m.from_unit = p.unit
        reason = check_move(m, h)
        result = commit(h, m, emit, verified=True)
        detail = (f"records verified by a human; moved to {m.to_unit}" if result == "applied" else
                  f"records verified by a human, but the move can't happen now ({reason}); "
                  f"patient is back in the queue with records verified")
    if reserved:
        h.release(p.pid)
    emit("hold.resolved", {"hold_id": hold_id, "pid": p.pid, "outcome": outcome, "detail": detail})
    return detail
