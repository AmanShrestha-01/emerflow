"""The merged chart: every fact across every linked source, grouped as conflict, agree or gap.

Conflicts come only from `gate._disagree`, the same comparison the board's gate uses. Nothing here
says which version is correct.
"""
from __future__ import annotations

from backend import gate
from backend.sim.models import FACTS, Conflict, Patient

ORDER = {"conflict": 0, "agree": 1, "gap": 2}


def _versions(p: Patient, fact: str) -> list[dict]:
    return [{"source_name": s.source_name, "recorded_date": s.recorded_date, "value": c.value,
             "status": c.status, "resource_id": c.resource_id}
            for s in p.sources if (c := s.claims.get(fact))]


def merged(p: Patient) -> list[dict]:
    out = []
    for fact in FACTS:
        claims = [s.claims[fact] for s in p.sources if fact in s.claims]
        reason = None
        for i in range(len(claims)):
            for j in range(i + 1, len(claims)):
                reason = reason or gate._disagree(claims[i], claims[j])
        missing = [s.source_name for s in p.sources if fact not in s.claims]
        if reason and fact not in p.verified:
            kind = "conflict"
        elif missing:
            kind = "gap"
        else:
            kind = "agree"
        row = {"fact": fact, "kind": kind, "reason": reason if kind == "conflict" else None,
               "versions": _versions(p, fact), "missing_from": missing,
               "verified_by_human": bool(reason) and fact in p.verified}
        out.append(row)
    return sorted(out, key=lambda r: ORDER[r["kind"]])


def check_order(p: Patient, because: list[str]) -> list[Conflict]:
    """Same gate as the board. Order warnings never block, so `blocking` is ignored."""
    return gate.check(p, because, p.unit or "ER").conflicts


def conflicts_json(conflicts: list[Conflict]) -> list[dict]:
    return [{"fact": c.fact, "reason": c.reason, "versions": [v.__dict__ for v in c.versions]} for c in conflicts]
