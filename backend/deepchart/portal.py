"""The doctor portal's state and actions. One instance per hospital reset; owned by the Engine.

Rules this module keeps:
- Nothing links to a patient without a human: `confirm()` or a transfer.
- Outside records open only with a reason for access, and every open is logged.
- Order warnings come from the same gate as the board and never block.
- The patient view never contains conflicts or clinical values.
"""
from __future__ import annotations

import copy
import datetime as _dt
import secrets
from dataclasses import dataclass, field

from backend import gate
from backend.deepchart import match
from backend.deepchart.access import REASONS, Session
from backend.deepchart.chart import check_order, conflicts_json, merged
from backend.deepchart.records import HOME, HOSP_B, HOSPITALS, Identity, Registry
from backend.sim.models import FACTS, Patient
from backend.sim.scenarios import plant
from backend.sim.words import place

TRANSFER_ETA = 8  # sim minutes from "send" to arrival at HOME

UNIT_WORDS = {"RESUS": "the resuscitation room", "ER": "the emergency department", "HALLWAY": "an emergency bed",
              "ICU": "intensive care", "STEPDOWN": "the close-watch beds", "WARD": "a ward", "OR": "surgery",
              "PACU": "recovery", "LOUNGE": "the discharge lounge"}


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


@dataclass
class Order:
    order_id: str
    pid: str
    text: str
    because: list[str]
    warnings: list[dict]
    status: str  # "saved" | "needs_ack"
    by: str
    reason: str = ""


@dataclass
class Transfer:
    transfer_id: str
    pid: str
    name: str
    from_hospital: str
    to_hospital: str
    at: int
    conflicts: int = 0
    from_pid: str = ""  # the patient's id at the sending hospital


@dataclass
class PortalState:
    confirmed: dict[str, set[str]] = field(default_factory=dict)  # pid -> refs a human said are this patient
    rejected: dict[str, set[str]] = field(default_factory=dict)   # pid -> refs a human said are not
    log: list[dict] = field(default_factory=list)
    orders: dict[str, Order] = field(default_factory=dict)
    transfers: list[Transfer] = field(default_factory=list)
    links: dict[str, str] = field(default_factory=dict)           # patient-link token -> pid


class Portal:
    def __init__(self, engine) -> None:
        self.e = engine
        self.reg = Registry(engine.h.patients, engine.key, engine.seed)
        self.s = PortalState()

    # ---------- helpers ----------
    @property
    def h(self):
        return self.e.h

    def _patient(self, pid: str) -> Patient:
        if pid not in self.h.patients:
            raise NotFound("unknown patient")
        return self.h.patients[pid]

    @staticmethod
    def _need_reason(reason: str | None) -> str:
        if reason not in REASONS:
            raise Forbidden("pick a reason for access before opening outside records")
        return reason

    @staticmethod
    def _need_doctor(sess: Session) -> None:
        if sess.role != "doctor":
            raise Forbidden("doctors only")

    def _need_home(self, sess: Session, pid: str) -> Patient:
        p = self._patient(pid)
        if sess.hospital != HOME:
            raise Forbidden(f"{pid} is not a patient at {sess.hospital}")
        return p

    def _log(self, sess: Session, pid: str, action: str, reason: str | None = None, public: str | None = None) -> None:
        """`action` is for staff; `public` is what the patient sees (never clinical detail)."""
        entry = {"at": _dt.datetime.now().strftime("%H:%M:%S"), "clock": self.h.clock, "pid": pid,
                 "hospital": sess.hospital, "role": sess.role, "action": action,
                 "public": public or action, "reason": REASONS.get(reason or "", "")}
        last = next((e for e in reversed(self.s.log) if e["pid"] == pid), None)
        same = ("hospital", "role", "action", "reason")
        if last and all(last[k] == entry[k] for k in same):
            return  # re-opening the same chart for the same reason is one access, not many
        self.s.log.append(entry)

    def _linked(self, p: Patient, source) -> bool:
        return any(s is source for s in p.sources)

    def _hold(self, pid: str) -> dict | None:
        return next((x for x in self.h.snapshot()["holds"] if x["pid"] == pid), None)

    # ---------- lists ----------
    def patients(self, sess: Session) -> list[dict]:
        self._need_doctor(sess)
        if sess.hospital == HOME:
            out = []
            held = {x.move.pid for x in self.h.holds.values()}
            for p in self.h.patients.values():
                if p.state in ("discharged", "transferred") or not p.sources:
                    continue
                row = self.h.patient_row(p)
                row["conflicts"] = sum(1 for f in merged(p) if f["kind"] == "conflict")
                row["held"] = p.pid in held
                out.append(row)
            return sorted(out, key=lambda r: (not r["held"], -r["conflicts"], r["severity"], r["pid"]))
        if sess.hospital == HOSP_B:
            sent = {t.from_pid for t in self.s.transfers}
            return [{"pid": pid, "name": p.name, "age": p.age, "complaint": p.complaint, "severity": p.severity,
                     "state": "transferred" if pid in sent else "placed", "unit": p.unit}
                    for pid, (p, _) in self.reg.roster.items()]
        return []

    # ---------- lookup ----------
    def lookup(self, sess: Session, reason: str | None, pid: str | None = None, query: dict | None = None) -> dict:
        self._need_doctor(sess)
        reason = self._need_reason(reason)
        if pid:
            p = self._need_home(sess, pid)
            q = self.reg.identity(pid)
        else:
            p = None
            q = Identity(**{k: (query or {}).get(k, "") for k in ("name", "dob", "sex", "phone4",
                                                                  "insurance_id", "address")})
            if not (q.name and q.dob and q.sex):
                raise ValueError("name, date of birth and sex are required")
        rejected = self.s.rejected.get(pid or "", set())
        out = []
        for rec, t in match.find(q, self.reg.all_outside(exclude=sess.hospital)):
            if rec.ref in rejected or (p is not None and rec.pid == pid and rec.hospital == sess.hospital):
                continue
            out.append({"record_ref": rec.ref, "hospital": rec.hospital, "source_name": rec.source.source_name,
                        "recorded_date": rec.source.recorded_date, "name": rec.identity.name,
                        "dob": rec.identity.dob, "sex": rec.identity.sex, "match": t,
                        "differs": match.differs(q, rec.identity),
                        "linked": p is not None and self._linked(p, rec.source),
                        "confirmed": rec.ref in self.s.confirmed.get(pid or "", set()),
                        "facts": len(rec.source.claims)})
        self._log(sess, pid or "search", "looked up records at other hospitals", reason)
        return {"query": q.__dict__, "candidates": out}

    def confirm(self, sess: Session, pid: str, ref: str, same_person: bool, reason: str | None) -> dict:
        self._need_doctor(sess)
        reason = self._need_reason(reason)
        p = self._need_home(sess, pid)
        rec = self.reg.by_ref.get(ref)
        if rec is None:
            raise NotFound("unknown record")
        linked = self._linked(p, rec.source)
        if same_person:
            self.s.confirmed.setdefault(pid, set()).add(ref)
            self.s.rejected.get(pid, set()).discard(ref)
            if not linked:
                p.sources.append(rec.source)
                self.h.version += 1
                self.e.emit("record.linked", {"pid": pid, "record_ref": ref, "hospital": rec.hospital,
                                              "by_hospital": sess.hospital})
            self._log(sess, pid, f"confirmed a {rec.hospital} record is this patient", reason,
                      public=f"added your {rec.hospital} record")
            return {"ok": True, "linked": True}
        self.s.rejected.setdefault(pid, set()).add(ref)
        self.s.confirmed.get(pid, set()).discard(ref)
        if linked:
            p.sources = [s for s in p.sources if s is not rec.source]
            self.h.version += 1
            self.e.emit("record.unlinked", {"pid": pid, "record_ref": ref, "hospital": rec.hospital,
                                            "by_hospital": sess.hospital})
        self._log(sess, pid, f"said a {rec.hospital} record is NOT this patient", reason,
                      public=f"checked a {rec.hospital} record and kept it off your chart")
        return {"ok": True, "linked": False}

    # ---------- chart ----------
    def chart(self, sess: Session, pid: str, reason: str | None) -> dict:
        self._need_doctor(sess)
        reason = self._need_reason(reason)
        p = self._need_home(sess, pid)
        facts = merged(p)
        hold = self._hold(pid)
        self._log(sess, pid, "opened the merged chart", reason)
        return {
            "patient": self.h.patient_row(p), "hospital": sess.hospital, "identity": self.reg.identity(pid).__dict__,
            "sources": [{"source_name": s.source_name, "recorded_date": s.recorded_date,
                         "hospital": {"local": HOME, "hospital_b": HOSP_B}.get(s.source_id, "Hospital C")}
                        for s in p.sources],
            "facts": facts, "hold": hold,
            "orders": [o.__dict__ for o in self.s.orders.values() if o.pid == pid],
            "notice": gate.NOTICE if hold or any(f["kind"] == "conflict" for f in facts) else "",
        }

    def resolve_hold(self, sess: Session, pid: str, hold_id: str, outcome: str, reason: str | None) -> dict:
        """A doctor resolves the board's hold from the chart. Same path as the board's resolve button."""
        self._need_doctor(sess)
        reason = self._need_reason(reason)
        self._need_home(sess, pid)
        hold = self.h.holds.get(hold_id)
        if hold is None or hold.move.pid != pid:
            raise NotFound("hold no longer pending")
        if outcome not in ("proceed", "cancel"):
            raise ValueError("outcome must be proceed or cancel")
        to_unit = hold.move.to_unit
        detail = self.e.resolve_hold(hold_id, outcome)
        if outcome == "proceed":
            self._log(sess, pid, f"checked the records and let the move to {place(to_unit)} go ahead", reason,
                      public="double-checked your records")
        else:
            self._log(sess, pid, f"checked the records and stopped the move to {place(to_unit)}", reason,
                      public="double-checked your records")
        return {"ok": True, "detail": detail, "outcome": outcome, "to_unit": to_unit}

    # ---------- orders ----------
    def order(self, sess: Session, pid: str, text: str, because: list[str]) -> dict:
        self._need_doctor(sess)
        p = self._need_home(sess, pid)
        if not text.strip():
            raise ValueError("order text is empty")
        bad = [f for f in because if f not in FACTS]
        if bad:
            raise ValueError(f"unknown facts: {', '.join(bad)}")
        warnings = conflicts_json(check_order(p, because))
        o = Order(self.h.next_id("O"), pid, text.strip(), list(because), warnings,
                  "needs_ack" if warnings else "saved", sess.hospital)
        self.s.orders[o.order_id] = o
        if warnings:
            self.e.emit("order.warning", {"order_id": o.order_id, "pid": pid, "because": o.because,
                                          "conflicts": warnings})
        self._log(sess, pid, "wrote an order", public="updated your care plan")
        return {"order_id": o.order_id, "status": o.status, "warnings": warnings}

    def ack(self, sess: Session, order_id: str, reason: str) -> dict:
        self._need_doctor(sess)
        o = self.s.orders.get(order_id)
        if o is None:
            raise NotFound("unknown order")
        p = self._need_home(sess, o.pid)
        if not (reason or "").strip():
            raise ValueError("write what you checked before saving")
        if o.status == "needs_ack":
            o.status, o.reason = "saved", reason.strip()
            facts = [w["fact"] for w in o.warnings]
            p.verified.update(facts)  # same meaning as resolving a hold with "proceed"
            self.e.emit("order.acknowledged", {"order_id": order_id, "pid": o.pid, "facts": facts})
            self._log(sess, o.pid, f"reviewed conflicting records ({', '.join(facts)}): {o.reason}",
                      public="double-checked your records")
        return {"order_id": order_id, "status": o.status}

    # ---------- transfers ----------
    def transfer(self, sess: Session, pid: str, to_hospital: str) -> dict:
        self._need_doctor(sess)
        if sess.hospital != HOSP_B or pid not in self.reg.roster:
            raise Forbidden("only Hospital B's own patients can be sent in this demo")
        if to_hospital != HOME:
            raise ValueError(f"transfers go to {HOME}")
        if any(t.from_pid == pid for t in self.s.transfers):
            raise ValueError("already transferred")
        src, ident = self.reg.roster[pid]
        new_pid = f"TR-{len(self.s.transfers) + 1:02d}"
        p = Patient(pid=new_pid, name=src.name, age=src.age, complaint=src.complaint, severity=src.severity,
                    arrived_at=self.h.clock + TRANSFER_ETA, state="incoming", sources=copy.deepcopy(src.sources),
                    blood_type=src.blood_type)
        # Records at the receiving hospital rarely match the sender's exactly: plant one known disagreement.
        plant(p, "anticoagulant", "existence", self.e.key)
        self.reg.set_identity(new_pid, ident)
        self.h.add_patient(p)
        t = Transfer(f"T{len(self.s.transfers) + 1}", new_pid, p.name, HOSP_B, HOME, self.h.clock,
                     sum(1 for f in merged(p) if f["kind"] == "conflict"), from_pid=pid)
        self.s.transfers.append(t)
        self._log(sess, new_pid, f"sent the record with a transfer to {HOME}", "transfer")
        self.e.emit("transfer.received", {"transfer_id": t.transfer_id, "pid": new_pid,
                                          "from_hospital": HOSP_B, "to_hospital": HOME})
        self.e.emit("notice", {"text": f"Transfer from {HOSP_B}: {p.name} arrives in "
                                       f"{TRANSFER_ETA} min, records attached"})
        return {"transfer_id": t.transfer_id, "pid": new_pid}

    def inbox(self, sess: Session) -> list[dict]:
        self._need_doctor(sess)
        return [t.__dict__ for t in self.s.transfers if t.to_hospital == sess.hospital]

    # ---------- access log and patient link ----------
    def access_log(self, sess: Session, pid: str) -> list[dict]:
        self._need_doctor(sess)
        return [e for e in self.s.log if e["pid"] == pid]

    def patient_link(self, sess: Session, pid: str) -> dict:
        self._need_doctor(sess)
        self._need_home(sess, pid)
        token = next((t for t, x in self.s.links.items() if x == pid), None) or secrets.token_urlsafe(9)
        self.s.links[token] = pid
        return {"token": token, "path": f"/p/{token}"}

    def patient_view(self, token: str) -> dict:
        pid = self.s.links.get(token)
        if pid is None or pid not in self.h.patients:
            raise NotFound("this link is not valid")
        p = self.h.patients[pid]
        line = {
            "incoming": f"You're on your way to {HOME}. The team knows you're coming.",
            "waiting": "You're waiting for a bed. The team knows you're here.",
            "held": "You're waiting for a bed. Staff are double-checking your records.",
            "placed": f"You have a bed in {UNIT_WORDS.get(p.unit or '', 'the hospital')}.",
            "discharged": "You've been discharged.",
            "transferred": "You've been moved to another hospital.",
        }.get(p.state, "You're in our care.")
        return {"first_name": p.name.split()[0], "status_line": line,
                "access_log": [{"at": e["at"], "hospital": e["hospital"], "role": e["role"],
                                "action": e["public"], "reason": e["reason"]}
                               for e in self.s.log if e["pid"] == pid]}

    # ---------- measured, not guessed ----------
    def score(self) -> dict:
        planted = {(k["pid"], k["fact"]) for k in self.e.key if "fact" in k and k["pid"] in self.h.patients}
        found = set()
        for p in self.h.patients.values():
            base = p.sources[:2]  # the scenario's own two sources, before any human linking
            for fact in FACTS:
                cs = [s.claims[fact] for s in base if fact in s.claims]
                if len(cs) == 2 and gate._disagree(cs[0], cs[1]):
                    found.add((p.pid, fact))
        tp = len(found & planted)
        caught = missed = false_alarm = true_ok = 0
        for pid in list(self.h.patients):
            for rec in self.reg._c_records(pid):
                t = match.tier(self.reg.identity(pid), rec.identity)
                if rec.lookalike_of:
                    caught += t == "possible"
                    missed += t == "strong"
                else:
                    true_ok += t == "strong"
                    false_alarm += t != "strong"
        ratio = lambda a, b: round(a / b, 3) if b else None  # noqa: E731
        return {
            "records": {"planted": len(planted), "flagged": len(found), "correct": tp,
                        "precision": ratio(tp, len(found)), "recall": ratio(tp, len(planted))},
            "identity": {"lookalikes": caught + missed, "shown_as_possible": caught, "wrongly_strong": missed,
                         "true_records": true_ok + false_alarm, "true_shown_strong": true_ok,
                         "true_shown_possible": false_alarm,
                         "recall": ratio(caught, caught + missed)},
            "note": "Conflicts and lookalikes are planted by us; scoring is against that answer key.",
        }


__all__ = ["Portal", "NotFound", "Forbidden", "HOSPITALS"]
