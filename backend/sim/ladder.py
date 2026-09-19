"""Rule-based planner: greedy placement + make-room chains + the escalation ladder, all in code.

Used three ways: the coordinator's stub/fallback, and the "greedy + escalation rules" baseline arm.
It returns the same Plan form the Gemini coordinator returns.
"""
from __future__ import annotations

from backend.agents.schemas import Plan, PlanEscalation, PlanMove
from backend.sim.hospital import Hospital
from backend.sim.models import Move, Patient
from backend.sim.rules import ESCALATION_ACTIONS, check_move

# What we'd like for each severity, best first. Level-gated options are filtered by check_move.
OPTIONS: dict[int, list[str]] = {
    1: ["RESUS", "ICU", "HALLWAY"],
    2: ["ICU", "PACU", "HALLWAY"],
    3: ["STEPDOWN", "ER", "HALLWAY"],
    4: ["ER", "HALLWAY"],
    5: ["ER", "HALLWAY"],
}
# To free a bed in unit X, move an eligible patient from X to one of these.
MAKE_ROOM: dict[str, list[str]] = {"ICU": ["STEPDOWN"], "STEPDOWN": ["WARD"], "WARD": ["LOUNGE"]}


def _try(h: Hospital, pid: str, from_unit: str | None, to_unit: str, kind: str,
         reason: str, moves: list[PlanMove]) -> bool:
    m = Move("scratch", pid, from_unit, to_unit, kind)
    if check_move(m, h) is None:
        h.apply_move(m)
        moves.append(PlanMove(pid=pid, to_unit=to_unit, kind=kind, reason=reason))
        return True
    return False


def _make_room(h: Hospital, unit: str, moves: list[PlanMove], depth: int = 0) -> bool:
    """Free one bed in `unit` by moving someone onward (recursively making room there if needed)."""
    if depth > 2 or unit not in MAKE_ROOM:
        return False
    cands = [p for p in h.in_unit(unit) if p.pid not in h.locked and
             (p.improving if unit in ("ICU", "STEPDOWN") else p.ready_for_discharge)]
    for p in sorted(cands, key=lambda p: -p.severity):
        for dest in MAKE_ROOM[unit]:
            why = {"STEPDOWN": "improving; steps down to free an ICU bed",
                   "WARD": "stable; moves to the ward to free a step-down bed",
                   "LOUNGE": "ready to go home; waits in the discharge lounge"}[dest]
            if _try(h, p.pid, unit, dest, "transfer", why, moves):
                return True
            if _make_room(h, dest, moves, depth + 1) and _try(h, p.pid, unit, dest, "transfer", why, moves):
                return True
    return False


def _place(h: Hospital, p: Patient, moves: list[PlanMove]) -> bool:
    opts = OPTIONS[p.severity]
    if p.severity == 3 and p.needs_ct and not p.ct_done:
        opts = ["ER", "HALLWAY"]  # must be scanned before step-down
    for unit in opts:
        if _try(h, p.pid, None, unit, "admit", f"severity {p.severity}, {p.complaint}", moves):
            return True
        if unit in MAKE_ROOM and _make_room(h, unit, moves) and \
                _try(h, p.pid, None, unit, "admit", f"severity {p.severity}, into the bed just freed", moves):
            return True
    return False


def _pending(h: Hospital, action: str) -> bool:
    return any(a.escalation.action == action for a in h.approvals.values())


def rule_plan(live: Hospital, *, escalate: bool = True) -> Plan:
    h = live.clone()  # plan on a scratch copy; the real apply re-validates against live state
    moves: list[PlanMove] = []
    unplaced = [p for p in h.waiting() if not _place(h, p, moves)]

    # Level 1+: clear discharge-ready patients to the lounge proactively.
    if h.level >= 1:
        for p in [p for p in h.in_unit("WARD") if p.ready_for_discharge and p.pid not in h.locked][:3]:
            _try(h, p.pid, "WARD", "LOUNGE", "transfer", "ready to go home; frees a ward bed", moves)

    escalations: list[PlanEscalation] = []
    if escalate and h.level >= ESCALATION_ACTIONS["cancel_elective"]:
        upcoming = [c.case_id for c in h.or_cases
                    if not c.cancelled and c.kind == "elective" and c.starts_at > h.clock]
        if upcoming and any(p.severity <= 2 for p in unplaced) and not _pending(live, "cancel_elective"):
            escalations.append(PlanEscalation(
                action="cancel_elective", case_ids=upcoming,
                reason=f"{sum(p.severity <= 2 for p in unplaced)} critical patients have no ICU-level bed; "
                       f"cancelling {len(upcoming)} elective case(s) frees recovery-room beds"))
        from backend.sim.rules import NURSE_RATIO
        tight = [u for u, r in NURSE_RATIO.items() if h.units[u].free > 0 and
                 len(h.units[u].occupants) + len(h.units[u].reserved) >= h.nurses.get(u, 0) * r]
        if tight and h.off_duty_nurses > 0 and not h.callins and not _pending(live, "call_in_staff"):
            escalations.append(PlanEscalation(
                action="call_in_staff", unit=tight[0], count=min(2, h.off_duty_nurses),
                reason=f"{tight[0]} has beds but no nurse free; call in {min(2, h.off_duty_nurses)} nurses"))
    if escalate and h.level >= ESCALATION_ACTIONS["divert_ambulances"]:
        if not h.diversion and not _pending(live, "divert_ambulances"):
            escalations.append(PlanEscalation(
                action="divert_ambulances", reason="still full after stretching; send stable ambulances elsewhere"))
        stable = [p.pid for u in ("STEPDOWN", "ER") for p in h.in_unit(u)
                  if p.severity >= 3 and p.pid not in h.locked][:2]
        if stable and sum(h.partners.values()) > 0 and not _pending(live, "transfer_out"):
            escalations.append(PlanEscalation(
                action="transfer_out", pids=stable, reason="transfer stable patients to a partner hospital"))

    n_crit = sum(p.severity <= 2 for p in unplaced)
    summary = (f"Place {sum(m.kind == 'admit' for m in moves)} waiting patients, "
               f"{sum(m.kind != 'admit' for m in moves)} moves to make room"
               + (f"; {len(unplaced)} still unplaced ({n_crit} critical)" if unplaced else "")
               + (f"; asking approval for {', '.join(e.action for e in escalations)}" if escalations else ""))
    return Plan(summary=summary, moves=moves, escalations=escalations)
