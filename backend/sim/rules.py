"""Hard rules. Code, never an LLM, decides whether a move is allowed.

Also owns the `because` list: every destination names the facts a placement
there relies on. Every move gets these attached here, whoever proposed it.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from backend.sim.models import DESTINATIONS, FACTS, Move

if TYPE_CHECKING:
    from backend.sim.hospital import Hospital

# The facts a placement into each destination relies on (>= 2 each).
REQUIRED_FACTS: dict[str, list[str]] = {
    "RESUS": ["anticoagulant", "blood_type"],
    "ER": ["vitals_stable", "anticoagulant"],
    "HALLWAY": ["vitals_stable", "icu_need"],
    "ICU": ["icu_need", "anticoagulant"],
    "STEPDOWN": ["anticoagulant", "vitals_stable", "icu_need"],
    "WARD": ["vitals_stable", "on_pressors"],
    "OR": ["anticoagulant", "penicillin_allergy", "blood_type"],
    "PACU": ["anticoagulant", "vitals_stable"],
    "LOUNGE": ["vitals_stable", "on_pressors"],
    "HOME": ["vitals_stable", "anticoagulant"],
    "PARTNER": ["vitals_stable", "icu_need"],
}

# Overflow/life-saving destinations. A records conflict never blocks a move here for a severity-1
# patient (see gate.check); RESUS never blocks for anyone.
EMERGENCY_UNITS: tuple[str, ...] = ("RESUS", "HALLWAY")

# Patients per nurse, for units where the ratio is a hard limit.
NURSE_RATIO: dict[str, int] = {"RESUS": 1, "ICU": 2, "PACU": 2, "STEPDOWN": 4, "ER": 4}

# Escalation actions: minimum level, and all need a human.
ESCALATION_ACTIONS: dict[str, int] = {
    "cancel_elective": 2,
    "call_in_staff": 2,
    "divert_ambulances": 3,
    "transfer_out": 3,
}

# Severity bands each unit accepts (1 = most critical).
SEVERITY_OK: dict[str, tuple[int, int]] = {
    "RESUS": (1, 2),
    "ICU": (1, 2),
    "OR": (1, 3),
    "STEPDOWN": (2, 3),
    "PACU": (1, 3),
    "HALLWAY": (1, 5),
    "ER": (2, 5),
    "WARD": (3, 5),
    "LOUNGE": (3, 5),
    "HOME": (3, 5),
    "PARTNER": (2, 5),
}


def attach_because(to_unit: str, extra: list[str] | None = None) -> list[str]:
    """Required facts for the destination, plus any valid extras. Extras can add, never remove."""
    facts = list(REQUIRED_FACTS[to_unit])
    for f in extra or []:
        if f in FACTS and f not in facts:
            facts.append(f)
    return facts


def min_level_for(move: Move, hospital: "Hospital") -> int:
    """Lowest escalation level at which this move is allowed."""
    p = hospital.patients[move.pid]
    if move.to_unit == "HALLWAY":
        return 0 if p.severity == 1 else 2
    if move.to_unit == "PACU" and move.from_unit != "OR":
        return 2  # recovery room used as ICU overflow
    if move.to_unit == "LOUNGE":
        return 1
    if move.to_unit == "PARTNER":
        return 3
    return 0


def check_move(move: Move, hospital: "Hospital", *, level: int | None = None) -> str | None:
    """Return None if the move is allowed right now, else a short human-readable reason."""
    level = hospital.level if level is None else level
    p = hospital.patients.get(move.pid)
    if p is None:
        return f"unknown patient {move.pid}"
    if move.to_unit not in DESTINATIONS:
        return f"unknown destination {move.to_unit}"
    if p.state in ("held", "discharged", "transferred", "incoming"):
        return f"{p.pid} is {p.state}"
    if p.pid in hospital.locked:
        return f"{p.pid} is locked by a pending hold or approval"
    if move.from_unit != p.unit:
        return f"{p.pid} is not in {move.from_unit}"
    if move.to_unit == p.unit:
        return f"{p.pid} is already in {move.to_unit}"

    lo, hi = SEVERITY_OK[move.to_unit]
    if not lo <= p.severity <= hi:
        return f"severity {p.severity} does not belong in {move.to_unit}"

    need = min_level_for(move, hospital)
    if level < need:
        return f"{move.to_unit} needs level {need}, hospital is at {level}"

    if move.to_unit in ("HOME", "LOUNGE") and not p.ready_for_discharge:
        return f"{p.pid} is not ready for discharge"
    if p.unit == "ICU" and move.to_unit in ("STEPDOWN", "WARD") and not p.improving:
        return f"{p.pid} is not improving enough to leave ICU"
    if p.needs_ct and not p.ct_done and move.to_unit in ("STEPDOWN", "WARD", "OR", "HOME", "PARTNER"):
        return f"{p.pid} is waiting for a CT scan"
    if move.to_unit in ("STEPDOWN", "WARD", "LOUNGE", "HOME", "PARTNER"):
        if p.needs_xray and not p.xray_done:
            return f"{p.pid} is waiting for an X-ray"
        if p.needs_labs and not p.labs_done:
            return f"{p.pid} is waiting for lab results"
    if move.to_unit == "OR" and p.needs_blood and not hospital.blood_available(p.blood_type, 2):
        return f"not enough {p.blood_type} blood for {p.pid}"

    if move.to_unit in hospital.units:
        u = hospital.units[move.to_unit]
        has_reservation = p.pid in u.reserved
        sev1_overflow = move.to_unit == "HALLWAY" and p.severity == 1  # never "no place" for the sickest
        if not has_reservation and u.free <= 0 and not sev1_overflow:
            return f"{move.to_unit} is full"
        ratio = NURSE_RATIO.get(move.to_unit)
        if ratio is not None:
            load = len(u.occupants) + len(u.reserved) + (0 if has_reservation else 1)
            if load > hospital.nurses[move.to_unit] * ratio:
                return f"{move.to_unit} has no nurse free (1:{ratio})"
    return None


def check_plan(moves: list[Move], hospital: "Hospital") -> tuple[list[Move], list[tuple[Move, str]]]:
    """Validate moves one by one against a scratch copy, so later moves see earlier ones.

    Keeps the valid subset. A patient may appear in at most one move per plan.
    """
    scratch = hospital.clone()
    kept: list[Move] = []
    dropped: list[tuple[Move, str]] = []
    seen: set[str] = set()
    for m in moves:
        if m.pid in seen:
            dropped.append((m, f"{m.pid} appears in two moves"))
            continue
        reason = check_move(m, scratch)
        if reason:
            dropped.append((m, reason))
            continue
        seen.add(m.pid)
        scratch.apply_move(m)
        kept.append(m)
    return kept, dropped
