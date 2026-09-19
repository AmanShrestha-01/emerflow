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
    "RESUS": "the resuscitation room", "ER": "an emergency bed", "HALLWAY": "a hallway bed",
    "ICU": "an intensive care (ICU) bed", "STEPDOWN": "a step-down bed", "WARD": "a ward bed",
    "OR": "surgery", "PACU": "the recovery room", "LOUNGE": "the discharge lounge", "HOME": "home",
    "PARTNER": "another hospital",
}

_PID = re.compile(r"\b(?:IN|MC|WI|RD|TR|HB)-\d+\b")
_UNIT = re.compile(r"\b(STEPDOWN|PACU|RESUS|HALLWAY|LOUNGE)\b")
_UNIT_PLAIN = {"STEPDOWN": "step-down", "PACU": "recovery", "RESUS": "resuscitation", "HALLWAY": "hallway",
               "LOUNGE": "discharge lounge"}


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
    return _UNIT.sub(lambda m: _UNIT_PLAIN[m.group(0)], text)
