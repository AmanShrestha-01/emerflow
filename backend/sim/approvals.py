"""Big actions wait for the one human reviewer. Code validates them before and after approval."""
from __future__ import annotations

from backend.agents.schemas import PlanEscalation
from backend.sim.hospital import Approval, Hospital
from backend.sim.models import Escalation, Move
from backend.sim.pipeline import Emit, _noop, commit
from backend.sim.rules import ESCALATION_ACTIONS, NURSE_RATIO

CALLIN_DELAY = 45
UNIT_WORDS = {"ICU": "intensive care", "ER": "emergency", "RESUS": "the critical care room", "PACU": "the recovery room",
              "STEPDOWN": "the close-watch beds", "WARD": "the ward"}


def _upcoming_electives(h: Hospital, ids: list[str] | None) -> list:
    cases = [c for c in h.or_cases if not c.cancelled and c.kind == "elective" and c.starts_at > h.clock]
    return [c for c in cases if not ids or c.case_id in ids]


def describe(h: Hospital, e: PlanEscalation) -> str | None:
    """Validate an escalation; return a human-readable detail, or None if it's not allowed."""
    if h.level < ESCALATION_ACTIONS[e.action]:
        return None
    if any(a.escalation.action == e.action for a in h.approvals.values()):
        return None
    if e.action == "cancel_elective":
        cases = _upcoming_electives(h, e.case_ids)
        return (f"postpone {len(cases)} planned (non-urgent) surgeries → frees {len(cases)} recovery room beds"
                if cases else None)
    if e.action == "call_in_staff":
        unit = e.unit if e.unit in NURSE_RATIO else "ICU"
        n = max(1, min(e.count or 2, h.off_duty_nurses))
        return (f"call in {n} off-duty nurse{'s' if n != 1 else ''} for {UNIT_WORDS.get(unit, unit)}; they arrive in {CALLIN_DELAY} min"
                if h.off_duty_nurses else None)
    if e.action == "divert_ambulances":
        return "ask ambulances with less serious patients to go to other hospitals" if not h.diversion else None
    if e.action == "transfer_out":
        pids = [pid for pid in e.pids if pid in h.patients and h.patients[pid].state == "placed"
                and pid not in h.locked]
        return f"transfer {', '.join(pids)} to a partner hospital" if pids and sum(h.partners.values()) else None
    return None


def request(h: Hospital, e: PlanEscalation, emit: Emit = _noop, **ev) -> Approval | None:
    detail = describe(h, e)
    if detail is None:
        emit("move.dropped", {"pid": None, "to_unit": None, "reason": f"escalation {e.action} not allowed now"}, **ev)
        return None
    params = {"case_ids": e.case_ids, "pids": e.pids, "unit": e.unit, "count": e.count}
    a = Approval(h.next_id("A"), Escalation(h.next_id("E"), e.action, ESCALATION_ACTIONS[e.action],
                                            e.reason, params), h.clock, detail)
    h.approvals[a.approval_id] = a
    if e.action == "transfer_out":
        h.locked.update(pid for pid in e.pids if pid in h.patients)
    h.version += 1
    emit("approval.requested", {"approval_id": a.approval_id, "action": e.action, "reason": e.reason,
                                "detail": detail}, **ev)
    return a


def resolve(h: Hospital, approval_id: str, approve: bool, emit: Emit = _noop) -> str:
    a = h.approvals.pop(approval_id)
    e, p = a.escalation, a.escalation.params
    if e.action == "transfer_out":
        h.locked.difference_update(p.get("pids") or [])
    detail = "a person said no"
    if approve:
        if e.action == "cancel_elective":
            cases = _upcoming_electives(h, p.get("case_ids"))
            for c in cases:
                c.cancelled = True
                for unit in ("OR", "PACU"):
                    h.units[unit].reserved.pop(f"case:{c.case_id}", None)
            detail = f"postponed {len(cases)} planned surgeries; {len(cases)} recovery room beds freed"
        elif e.action == "call_in_staff":
            unit = p.get("unit") if p.get("unit") in NURSE_RATIO else "ICU"
            n = max(1, min(p.get("count") or 2, h.off_duty_nurses))
            h.off_duty_nurses -= n
            h.callins.append((h.clock + CALLIN_DELAY, unit, n))
            detail = f"{n} nurse{'s' if n != 1 else ''} called in for {UNIT_WORDS.get(unit, unit)}, arriving in {CALLIN_DELAY} min"
        elif e.action == "divert_ambulances":
            h.diversion = True
            detail = "ambulances with less serious patients now go to other hospitals"
        elif e.action == "transfer_out":
            results = [commit(h, Move(h.next_id("M"), pid, h.patients[pid].unit, "PARTNER", "transfer_out",
                                      source="swarm", reason="approved transfer"), emit)
                       for pid in p.get("pids") or [] if h.patients[pid].state == "placed"]
            detail = f"transfers: {', '.join(results) or 'none possible'}"
        h.version += 1
    emit("approval.resolved", {"approval_id": approval_id, "approved": approve, "action": e.action,
                               "detail": detail})
    return detail
