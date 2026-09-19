"""Everyday words for the screen: patient names instead of codes, plain phrases instead of jargon."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.sim.hospital import Hospital

# What a disagreement is about, in words anyone understands.
FACT_WORDS: dict[str, str] = {
    "anticoagulant": "whether they take blood thinners",
    "penicillin_allergy": "whether they're allergic to penicillin",
    "vitals_stable": "whether their heart rate and breathing are stable",
    "icu_need": "whether they need intensive care",
    "on_pressors": "whether they're on blood-pressure support",
    "blood_type": "their blood type",
}

PLACE_WORDS: dict[str, str] = {
    "RESUS": "the critical care room", "ER": "an emergency bed", "HALLWAY": "an extra hallway bed",
    "ICU": "an intensive care bed", "STEPDOWN": "a close-watch bed", "WARD": "a ward bed",
    "OR": "surgery", "PACU": "the recovery room", "LOUNGE": "the going-home lounge", "HOME": "home",
    "PARTNER": "another hospital",
}

_PID = re.compile(r"\b(?:IN|MC|WI|RD|TR|HB)-\d+\b")
_UNIT = re.compile(r"\b(STEPDOWN|PACU|RESUS|HALLWAY|LOUNGE)\b")
_UNIT_PLAIN = {"STEPDOWN": "close-watch beds", "PACU": "recovery room", "RESUS": "critical care room",
               "HALLWAY": "extra hallway beds", "LOUNGE": "going-home lounge"}


def facts_phrase(facts: list[str]) -> str:
    words = [FACT_WORDS.get(f, f.replace("_", " ")) for f in facts]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def place(unit: str | None) -> str:
    return PLACE_WORDS.get(unit or "", unit or "")


def plain(text: str, h: "Hospital") -> str:
    """Replace patient codes with names, and unit codes with everyday words."""
    def name(m: re.Match) -> str:
        p = h.patients.get(m.group(0))
        return p.name if p else "a patient"
    text = _PID.sub(name, text or "")
    text = _UNIT.sub(lambda m: _UNIT_PLAIN[m.group(0)], text)
    return close_watch(text)


_STEP_VERB = re.compile(r"\bstep down\b", re.I)
_STEP_ING = re.compile(r"\bstepp(ing|ed) down\b", re.I)
_STEP_NOUN = re.compile(r"\bstep-?downs?\b", re.I)


def close_watch(text: str) -> str:
    """'step-down' is hospital jargon; say 'close-watch' (beds for patients who still need watching)."""
    text = _STEP_ING.sub(lambda m: ("moving" if m.group(1).lower() == "ing" else "moved"), text)
    text = _STEP_VERB.sub(lambda m: "move to close-watch beds" if m.group(0)[0].islower() else "Move to close-watch beds", text)
    return _STEP_NOUN.sub(lambda m: "close-watch" if m.group(0)[0].islower() else "Close-watch", text)
