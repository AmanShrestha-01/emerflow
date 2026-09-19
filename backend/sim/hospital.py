"""The hospital blackboard: all state lives here, in code. Agents only ever see views of it."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

from backend.sim.models import OFFSITE, Escalation, Move, ORCase, Patient, Unit, Verdict

# Bed counts per unit.
BEDS: dict[str, int] = {
    "RESUS": 4, "ER": 20, "HALLWAY": 8, "ICU": 10, "STEPDOWN": 16,
    "WARD": 30, "OR": 3, "PACU": 6, "LOUNGE": 10,
}
# Nurses on shift per unit at the start.
NURSES: dict[str, int] = {"RESUS": 4, "ER": 5, "ICU": 5, "PACU": 2, "STEPDOWN": 4, "WARD": 5}


@dataclass
class Hold:
    hold_id: str
    move: Move
    verdict: Verdict
    created_at: int


@dataclass
class Approval:
    approval_id: str
    escalation: Escalation
    created_at: int
    detail: str = ""


def _hold_sentence(h: "Hospital", hold: "Hold") -> str:
    from backend.sim.words import facts_phrase, place
    p = h.patients[hold.move.pid]
    about = facts_phrase([c.fact for c in hold.verdict.conflicts])
    return (f"{p.name} can't be moved to {place(hold.move.to_unit)} yet: two hospitals' records disagree "
            f"about {about}.")


def _approval_sentence(h: "Hospital", a: "Approval") -> str:
    from backend.sim.words import plain
    e, prm = a.escalation, a.escalation.params
    if e.action == "cancel_elective":
        n = len(prm.get("case_ids") or []) or "the"
        return f"Postpone {n} planned (non-urgent) surgeries so their recovery beds can take critical patients?"
    if e.action == "call_in_staff":
        return f"Call in {prm.get('count') or 2} off-duty nurses? They'd arrive in about 45 minutes."
    if e.action == "divert_ambulances":
        return "Ask ambulances with less serious patients to go to other hospitals for now?"
    if e.action == "transfer_out":
        names = ", ".join(h.patients[x].name for x in prm.get("pids") or [] if x in h.patients)
        return plain(f"Transfer {names} to a partner hospital to free beds?", h)
    return plain(a.detail, h)


@dataclass
class Hospital:
    units: dict[str, Unit] = field(default_factory=lambda: {n: Unit(n, b) for n, b in BEDS.items()})
    nurses: dict[str, int] = field(default_factory=lambda: dict(NURSES))
    off_duty_nurses: int = 6
    callins: list[tuple[int, str, int]] = field(default_factory=list)  # (arrives_at, unit, count)
    patients: dict[str, Patient] = field(default_factory=dict)
    ct_queue: list[str] = field(default_factory=list)
    blood: dict[str, int] = field(default_factory=lambda: {"O-": 8, "O+": 14, "A+": 10, "A-": 3, "B+": 6, "AB+": 3})
    or_cases: list[ORCase] = field(default_factory=list)
    partners: dict[str, int] = field(default_factory=lambda: {"Mercy General": 4, "St. Luke's": 3})
    diversion: bool = False
    busy_until: int | None = None  # a busy night: more everyday arrivals until this minute
    level: int = 0
    level_since: int = 0
    clock: int = 0
    version: int = 0
    locked: set[str] = field(default_factory=set)
    holds: dict[str, Hold] = field(default_factory=dict)
    approvals: dict[str, Approval] = field(default_factory=dict)
    waits: list[tuple[str, int, int]] = field(default_factory=list)  # (pid, severity, minutes waited)
    hallway_minutes: int = 0
    diverted: int = 0
    _seq: int = 0

    # ---------- ids ----------
    def next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}{self._seq}"

    def clone(self) -> "Hospital":
        return copy.deepcopy(self)

    # ---------- queries ----------
    def waiting(self) -> list[Patient]:
        """ER waiting room, most critical first, then longest wait."""
        ws = [p for p in self.patients.values() if p.state == "waiting" and p.unit is None]
        return sorted(ws, key=lambda p: (p.severity, p.arrived_at))

    def in_unit(self, unit: str) -> list[Patient]:
        return [self.patients[pid] for pid in self.units[unit].occupants]

    def occupancy(self, unit: str) -> int:
        u = self.units[unit]
        return round(100 * u.used / u.beds) if u.beds else 0

    def blood_available(self, blood_type: str, units: int) -> bool:
        return self.blood.get(blood_type, 0) + self.blood.get("O-", 0) >= units

    # ---------- mutations ----------
    def add_patient(self, p: Patient) -> None:
        self.patients[p.pid] = p
        self.version += 1

    def apply_move(self, m: Move) -> None:
        """Move a patient. Callers must have validated the move (rules.check_move)."""
        p = self.patients[m.pid]
        if p.unit and p.unit in self.units:
            u = self.units[p.unit]
            if p.pid in u.occupants:
                u.occupants.remove(p.pid)
        for u in self.units.values():
            u.reserved.pop(p.pid, None)
        if p.unit is None and p.state == "waiting":
            self.waits.append((p.pid, p.severity, self.clock - p.arrived_at))
            p.placed_at = self.clock
        p.moved_at = self.clock
        if m.to_unit in OFFSITE:
            p.unit = None
            p.state = "discharged" if m.to_unit == "HOME" else "transferred"
            if m.to_unit == "PARTNER":
                name = max(self.partners, key=self.partners.get)
                self.partners[name] = max(0, self.partners[name] - 1)
        else:
            self.units[m.to_unit].occupants.append(p.pid)
            p.unit = m.to_unit
            p.state = "placed"
        if m.to_unit == "OR" and p.needs_blood:
            self.use_blood(p.blood_type, 2)
        self.version += 1

    def use_blood(self, blood_type: str, units: int) -> None:
        own = min(units, self.blood.get(blood_type, 0))
        self.blood[blood_type] = self.blood.get(blood_type, 0) - own
        self.blood["O-"] = max(0, self.blood.get("O-", 0) - (units - own))

    def reserve(self, pid: str, unit: str, until: int) -> None:
        if unit in self.units:
            self.units[unit].reserved[pid] = until
        self.version += 1

    def release(self, pid: str) -> None:
        for u in self.units.values():
            u.reserved.pop(pid, None)
        self.version += 1

    def expire_reservations(self) -> list[str]:
        gone = []
        for u in self.units.values():
            for pid, until in list(u.reserved.items()):
                if until <= self.clock:
                    del u.reserved[pid]
                    gone.append(pid)
        if gone:
            self.version += 1
        return gone

    # ---------- views ----------
    def unit_view(self, unit: str) -> dict:
        """What one department agent is allowed to see about its own unit."""
        u = self.units[unit]
        return {
            "unit": unit,
            "beds": u.beds,
            "occupied": len(u.occupants),
            "reserved": len(u.reserved),
            "free": u.free,
            "nurses": self.nurses.get(unit),
            "patients": [
                {"pid": p.pid, "severity": p.severity, "complaint": p.complaint,
                 "improving": p.improving, "ready_for_discharge": p.ready_for_discharge,
                 "needs_ct": p.needs_ct and not p.ct_done, "locked": p.pid in self.locked}
                for p in self.in_unit(unit)
            ],
        }

    def patient_row(self, p: Patient) -> dict:
        return {
            "pid": p.pid, "name": p.name, "age": p.age, "complaint": p.complaint,
            "severity": p.severity, "state": p.state, "unit": p.unit,
            "waited": (p.placed_at if p.placed_at is not None else self.clock) - p.arrived_at
            if p.state != "incoming" else 0,
            "eta": p.arrived_at - self.clock if p.state == "incoming" else None,
            "needs_ct": p.needs_ct and not p.ct_done, "needs_blood": p.needs_blood,
            "retriage": p.retriage_flag, "records_flag": p.records_flag,
            "locked": p.pid in self.locked,
            "need": p.need, "needs_surgery": p.needs_surgery,
            "note": p.note, "note_by": p.note_by, "heading_to": p.heading_to,
        }

    def snapshot(self) -> dict:
        return {
            "clock": self.clock,
            "version": self.version,
            "level": self.level,
            "diversion": self.diversion,
            "busy_until": self.busy_until if self.busy_until and self.busy_until > self.clock else None,
            "units": [
                {"unit": n, "beds": u.beds, "occupied": len(u.occupants), "reserved": len(u.reserved),
                 "percent": self.occupancy(n), "nurses": self.nurses.get(n),
                 "occupants": list(u.occupants), "reserved_for": list(u.reserved)}
                for n, u in self.units.items()
            ],
            "patients": [self.patient_row(p) for p in self.patients.values()
                         if p.state not in ("discharged", "transferred")],
            "ct_queue": list(self.ct_queue),
            "blood": dict(self.blood),
            "or_cases": [c.__dict__ for c in self.or_cases if not c.cancelled and c.ends_at > self.clock],
            "partners": dict(self.partners),
            "off_duty_nurses": self.off_duty_nurses,
            "holds": [
                {"hold_id": h.hold_id, "pid": h.move.pid, "to_unit": h.move.to_unit,
                 "name": self.patients[h.move.pid].name,
                 "sentence": _hold_sentence(self, h),
                 "because": h.move.because, "created_at": h.created_at,
                 "conflicts": [
                     {"fact": c.fact, "reason": c.reason, "versions": [v.__dict__ for v in c.versions]}
                     for c in h.verdict.conflicts
                 ]}
                for h in self.holds.values()
            ],
            "approvals": [
                {"approval_id": a.approval_id, "action": a.escalation.action, "level": a.escalation.level,
                 "sentence": _approval_sentence(self, a),
                 "reason": a.escalation.reason, "params": a.escalation.params, "detail": a.detail,
                 "created_at": a.created_at}
                for a in self.approvals.values()
            ],
        }
