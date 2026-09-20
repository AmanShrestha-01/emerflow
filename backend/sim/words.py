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
# Every unit code that can end up inside a sentence a human reads. The validator's reasons and the
# coordinator's orders both carry raw codes, and "(OR is full)" means nothing to anyone outside a hospital.
# Every unit code that can end up inside a sentence a human reads. The validator's reasons and the
# coordinator's orders both carry raw codes, and "(OR is full)" means nothing to anyone outside a
# hospital. Each replacement brings its own article, so the pattern swallows one in front of the code:
# "the OR" becomes "surgery", not "the surgery", and "an ICU bed" becomes "intensive care bed".
_UNIT = re.compile(r"\b(?:a|an|the)\s+(?=[A-Z])|\b(STEPDOWN|PACU|RESUS|HALLWAY|LOUNGE|ICU|WARD|OR|ER|HOME|PARTNER)\b")
_UNIT_PLAIN = {"STEPDOWN": "the close-watch beds", "PACU": "the recovery room", "RESUS": "the critical care room",
               "HALLWAY": "the hallway beds", "LOUNGE": "the going-home lounge", "ICU": "intensive care",
               "WARD": "the ward", "OR": "surgery", "ER": "the emergency department", "HOME": "home",
               "PARTNER": "another hospital"}
_PLURAL = re.compile(r"\bbeds (is|was|has)\b")


def _unit_words(text: str) -> str:
    """Codes to words, dropping an article in front of one so the replacement's own article stands."""
    out, i = [], 0
    for m in _UNIT.finditer(text):
        if m.group(1) is None:                      # an article: keep it unless a code follows
            nxt = _UNIT.search(text, m.end())
            if nxt and nxt.start() == m.end() and nxt.group(1):
                out.append(text[i:m.start()])
                i = m.end()
            continue
        out.append(text[i:m.start()])
        out.append(_UNIT_PLAIN[m.group(1)])
        i = m.end()
    out.append(text[i:])
    said = "".join(out)
    # a plural place needs a plural verb: "close-watch beds is full" is not English
    return _PLURAL.sub(lambda m: "beds " + {"is": "are", "was": "were", "has": "have"}[m.group(1)], said)


def facts_phrase(facts: list[str]) -> str:
    words = [FACT_WORDS.get(f, f.replace("_", " ")) for f in facts]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def place(unit: str | None) -> str:
    return PLACE_WORDS.get(unit or "", unit or "")


def to_place(unit: str | None) -> str:
    """"to a ward bed", but "home" — you go home, you do not go to home."""
    where = place(unit)
    return where if where in ("home",) else f"to {where}"


def plain(text: str, h: "Hospital") -> str:
    """Replace patient codes with names, and unit codes with everyday words."""
    def name(m: re.Match) -> str:
        p = h.patients.get(m.group(0))
        return p.name if p else "a patient"
    text = _PID.sub(name, text or "")
    return close_watch(_unit_words(text))


_STEP_VERB = re.compile(r"\bstep down\b", re.I)
_STEP_ING = re.compile(r"\bstepp(ing|ed) down\b", re.I)
_STEP_NOUN = re.compile(r"\bstep-?downs?\b", re.I)


_RESUS = re.compile(r"(\b(?:the|a|an)\s+)?\bresus(?:citation)?(\s+(?:room|bay|bays|beds?))?\b", re.I)
_EMS = re.compile(r"(\b(?:the)\s+)?\bEMS\b")


def _starts_sentence(m: re.Match) -> bool:
    before = m.string[:m.start()].rstrip()
    return not before or before[-1] in ".!?:"


def _resus(m: re.Match) -> str:
    plural = bool(m.group(2)) and m.group(2).strip().lower() in ("bays", "beds")
    words = "critical care beds" if plural else "critical care room"
    phrase = (m.group(1) or "") + words if m.group(1) else "the " + words
    return phrase[0].upper() + phrase[1:] if _starts_sentence(m) else phrase


def _ems(m: re.Match) -> str:
    phrase = (m.group(1) or "the ") + "ambulance service"
    return phrase[0].upper() + phrase[1:] if _starts_sentence(m) else phrase


def close_watch(text: str) -> str:
    """'step-down' is hospital jargon; say 'close-watch' (beds for patients who still need watching)."""
    text = _RESUS.sub(_resus, text)
    text = _EMS.sub(_ems, text)
    text = _STEP_ING.sub(lambda m: ("moving" if m.group(1).lower() == "ing" else "moved"), text)
    text = _STEP_VERB.sub(lambda m: "move to close-watch beds" if m.group(0)[0].islower() else "Move to close-watch beds", text)
    return _STEP_NOUN.sub(lambda m: "close-watch" if m.group(0)[0].islower() else "Close-watch", text)
