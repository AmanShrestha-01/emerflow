"""Demo sessions and roles. A real deployment would use the hospital's single sign-on instead.

Sessions survive a hospital reset; the access log and patient links do not (the patients change).
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

from backend.deepchart.records import HOME, HOSPITALS

ROLES = ("doctor", "commander")
REASONS = {"er": "Treating in the ER", "admit": "Admitting", "transfer": "Transfer received",
           "consult": "Consult"}


@dataclass
class Session:
    token: str
    hospital: str
    role: str


class Access:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def login(self, hospital: str, role: str, pin: str) -> Session:
        if hospital not in HOSPITALS:
            raise ValueError("unknown hospital")
        if role not in ROLES:
            raise ValueError("role must be doctor or commander")
        if role == "commander" and hospital != HOME:
            raise ValueError(f"the command board belongs to {HOME}")
        if pin != os.environ.get("EMERFLOW_DEMO_KEY", "demo"):
            raise PermissionError("wrong PIN")
        s = Session(secrets.token_urlsafe(16), hospital, role)
        self.sessions[s.token] = s
        return s

    def get(self, token: str | None) -> Session | None:
        return self.sessions.get(token or "")
