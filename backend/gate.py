"""DeepChart gate: before a patient moves, check the facts the move relies on across record sources.

Deterministic for now. It never says which record is right; it only reports that sources disagree.
"Not mentioned" (a source with no claim for the fact) is a gap, never a conflict.
"""
from __future__ import annotations

from backend.sim.models import Claim, Conflict, ConflictVersion, Patient, Verdict
from backend.sim.rules import EMERGENCY_UNITS

ASSERTS = ("present", "active")
NOTICE = "sources disagree; a human must resolve"


def _disagree(a: Claim, b: Claim) -> str | None:
    if (a.status == "absent") != (b.status == "absent"):
        return "one source records it, the other explicitly records none"
    if {a.status, b.status} == {"active", "stopped"}:
        return "one source says active, the other says stopped"
    if a.status in ASSERTS and b.status in ASSERTS and a.value.strip().lower() != b.value.strip().lower():
        return "sources record different values"
    return None


def check(patient: Patient, because: list[str], to_unit: str) -> Verdict:
    """Compare only the `because` facts. Life-saving destinations get a non-blocking verdict."""
    conflicts: list[Conflict] = []
    for fact in because:
        if fact in patient.verified:
            continue  # a human already checked this fact across the sources
        pairs = [(s, s.claims[fact]) for s in patient.sources if fact in s.claims]
        reason = None
        for i in range(len(pairs)):
            for j in range(i + 1, len(pairs)):
                reason = reason or _disagree(pairs[i][1], pairs[j][1])
        if reason:
            conflicts.append(Conflict(
                fact=fact,
                reason=reason,
                versions=[ConflictVersion(s.source_name, s.recorded_date, c.value, c.status, c.resource_id)
                          for s, c in pairs],
            ))
    # Life-saving: resuscitation, or ANY move for a severity-1 patient. A critical patient is never
    # left waiting on paperwork; the move goes ahead and the disagreement is flagged for a human.
    life_saving = to_unit == "RESUS" or patient.severity == 1
    return Verdict(conflicts=conflicts, blocking=not life_saving)
