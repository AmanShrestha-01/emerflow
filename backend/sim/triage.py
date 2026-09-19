"""Plain-English triage notes: what's wrong, and what kind of care the patient needs.

This is the simulated triage nurse's note, set when a patient arrives. It describes the kind of bed or
service needed (e.g. "Emergency surgery"), never a treatment instruction, and never which record is right.
"""
from __future__ import annotations

# (keywords in the complaint, care need, needs surgery?) First match wins.
NEEDS: list[tuple[tuple[str, ...], str, bool]] = [
    (("gunshot", "stab", "internal bleeding", "multiple trauma"), "Emergency surgery", True),
    (("open leg fracture",), "Surgery to fix the fracture", True),
    (("stroke",), "Brain scan now, then ICU", False),
    (("chest pain, sweaty", "chest injury"), "Heart and lung monitoring (ICU)", False),
    (("chest pain",), "Heart monitoring", False),
    (("asthma", "hard to breathe", "short of breath", "shortness of breath"), "Breathing support", False),
    (("sepsis",), "Infection care (ICU)", False),
    (("head injury",), "Brain scan, then close watch", False),
    (("abdominal pain",), "Scan and assessment", False),
    (("fainted",), "Heart check and observation", False),
    (("hip", "broken arm", "broken wrist"), "X-ray and fracture care", False),
    (("cut", "scrapes", "bruises", "sprained"), "Treat in the ER, then home", False),
    (("fever", "flu", "sore throat", "rash", "migraine", "vomiting", "back pain", "kidney stone"),
     "Treat in the ER", False),
]

BY_SEVERITY = {1: "Life-saving care now", 2: "Urgent care, likely ICU", 3: "Admission for care",
               4: "Treat in the ER", 5: "Quick treatment, then home"}


def care_need(complaint: str, severity: int) -> tuple[str, bool]:
    c = complaint.lower()
    for words, need, surgery in NEEDS:
        if any(w in c for w in words):
            return need, surgery
    return BY_SEVERITY.get(severity, "Assessment"), False
