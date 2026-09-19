"""Patient identity matching. It never merges anything; it only sorts candidates for a human to confirm.

strong   = name, date of birth and sex agree AND at least one of phone (last 4), insurance id, address agrees
possible = name, date of birth and sex agree, nothing else does. Shown as an identity conflict.
Anything weaker is not shown.
"""
from __future__ import annotations

import unicodedata

from backend.deepchart.records import HeldRecord, Identity

EXTRA = ("phone4", "insurance_id", "address")


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.lower().split())


def tier(query: Identity, held: Identity) -> str | None:
    if not all(norm(getattr(query, f)) == norm(getattr(held, f)) for f in ("name", "dob", "sex")):
        return None
    shared = [f for f in EXTRA if norm(getattr(query, f)) and norm(getattr(query, f)) == norm(getattr(held, f))]
    return "strong" if shared else "possible"


def differs(query: Identity, held: Identity) -> list[str]:
    return [f for f in EXTRA if norm(getattr(query, f)) and norm(getattr(query, f)) != norm(getattr(held, f))]


def find(query: Identity, records: list[HeldRecord]) -> list[tuple[HeldRecord, str]]:
    out = [(r, t) for r in records if (t := tier(query, r.identity))]
    return sorted(out, key=lambda x: (x[1] != "strong", x[0].hospital, x[0].ref))
