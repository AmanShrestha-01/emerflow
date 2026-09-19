"""Demo sessions and roles. A real deployment would use the hospital's single sign-on instead.

Sessions survive a hospital reset; the access log and patient links do not (the patients change).
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

from backend.deepchart.records import HOME, HOSP_B, HOSP_C, HOSPITALS

ROLES = ("doctor", "commander")
# Made-up demo doctors, three per hospital. None shares a first or last name with a generated patient.
DOCTORS: dict[str, tuple[str, ...]] = {
    HOME: ("Dr. Amara Whitfield", "Dr. Daniel Osei", "Dr. Rebecca Lindqvist"),
    HOSP_B: ("Dr. Samuel Achebe", "Dr. Hannah Morales", "Dr. Marcus Delaney"),
    HOSP_C: ("Dr. Claire Donovan", "Dr. Julian Ashby", "Dr. Naomi Fairbanks"),
}
REASONS = {"er": "Treating in the ER", "admit": "Admitting", "transfer": "Transfer received",
           "consult": "Consult"}


@dataclass
class Session:
    token: str
    hospital: str
    role: str
    name: str = ""  # the doctor's name; empty for the commander


class Access:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def login(self, hospital: str, role: str, pin: str, doctor: str | None = None) -> Session:
        if hospital not in HOSPITALS:
            raise ValueError("unknown hospital")
        if role not in ROLES:
            raise ValueError("role must be doctor or commander")
        if role == "commander" and hospital != HOME:
            raise ValueError(f"the command board belongs to {HOME}")
        if pin != os.environ.get("EMERFLOW_DEMO_KEY", "demo"):
            raise PermissionError("wrong PIN")
        name = ""
        if role == "doctor":
            name = doctor or DOCTORS[hospital][0]  # no pick (e.g. the board's demo deep link): the first doctor
            if name not in DOCTORS[hospital]:
                raise ValueError(f"{name} is not a doctor at {hospital}")
        s = Session(secrets.token_urlsafe(16), hospital, role, name)
        self.sessions[s.token] = s
        return s

    def get(self, token: str | None) -> Session | None:
        return self.sessions.get(token or "")
