"""The running hospital: clock loop, fast lane, swarm-cycle triggers, human actions, metrics."""
from __future__ import annotations

import asyncio
import os
import random
import re
import statistics

from backend.agents.cycle import Swarm
from backend.agents.llm import LLM
from backend.agents.schemas import RadioParse, RadioPatient
from backend.events import EventBus
from backend.sim import approvals, escalation, fastlane
from backend.sim.clock import tick
from backend.sim.hospital import Hospital
from backend.sim.ladder import rule_plan
from backend.sim.models import Move
from backend.sim.pipeline import commit, resolve_hold
from backend.sim.scenarios import build_hospital, give_records, mass_casualty
from backend import gate
from backend.deepchart.access import Access
from backend.deepchart.portal import Portal

DEMO_KEY = os.environ.get("EMERFLOW_DEMO_KEY", "demo")
CYCLE_GAP = 3        # min sim-minutes between cycles when patients are waiting
CYCLE_IDLE = 10      # otherwise, a cycle every 10 sim-minutes if a unit is >= 90%
CLOCK_START = 21 * 60
BUSY_MINUTES = 60
CENSUS_EVERY = 5      # sim-minutes between occupancy samples for the census chart
CENSUS_KEEP = 96      # samples kept (8 hours)


# ---------- audit trail: every decision, who made it, and why ----------
AUDITED = ("move.applied", "move.held", "move.flagged", "move.dropped", "hold.resolved",
           "approval.requested", "approval.resolved", "coordinator.plan", "level.changed", "patient.arrived")
WHO = {"fastlane": "Fast lane (code)", "swarm": "Agent plan (Gemini)", "fallback": "Fallback (code)",
       "baseline": "Rules (code)"}


def audit_row(type_: str, d: dict, clock: int, cycle_id: str | None) -> dict:
    facts = ", ".join(d.get("because") or [])
    conflicts = "; ".join(f"{c['fact']}: " + " vs ".join(f"{v['source_name']}={v['value']}" for v in c["versions"])
                          for c in d.get("conflicts") or [])
    row = {"time": f"{(CLOCK_START + clock) // 60 % 24:02d}:{(CLOCK_START + clock) % 60:02d}", "clock": clock,
           "round": cycle_id or "", "event": type_, "patient": d.get("pid") or "",
           "from": d.get("from_unit") or "", "to": d.get("to_unit") or "", "decided_by": "",
           "relied_on": facts, "records_disagree": conflicts, "detail": ""}
    if type_ == "move.applied":
        row["decided_by"] = WHO.get(d.get("source"), d.get("source", ""))
        row["detail"] = d.get("reason", "")
    elif type_ == "move.held":
        row.update(decided_by="Records check (code)", detail="paused: sources disagree; a human must resolve")
    elif type_ == "move.flagged":
        row.update(decided_by="Records check (code)", detail="life-saving move went ahead; flagged for review")
    elif type_ == "move.dropped":
        row.update(decided_by="Validator (code)", detail=d.get("reason", ""))
    elif type_ == "hold.resolved":
        row.update(decided_by="Human", detail=f"{d.get('outcome')}: {d.get('detail', '')}")
    elif type_ == "approval.requested":
        row.update(decided_by="Escalation (code)", detail=f"{d.get('action')}: {d.get('detail', '')}")
    elif type_ == "approval.resolved":
        row.update(decided_by="Human", detail=f"{d.get('action', '')} {'approved' if d.get('approved') else 'rejected'}"
                                               f"{' (expired)' if d.get('expired') else ''}: {d.get('detail', '')}")
    elif type_ == "coordinator.plan":
        row.update(decided_by="Coordinator (Gemini)" if d.get("how") == "live" else f"Coordinator ({d.get('how')})",
                   detail=d.get("summary", ""))
    elif type_ == "level.changed":
        row.update(decided_by="Escalation (code)", detail=f"level {d.get('old')} -> {d.get('new')} {d.get('name')}")
    elif type_ == "patient.arrived":
        row.update(detail=f"severity {d.get('severity')}: {d.get('complaint')}")
    return row


def metrics(h: Hospital) -> dict:
    now_waiting = [h.clock - p.arrived_at for p in h.waiting()]
    waits = [w for _, _, w in h.waits] + now_waiting
    return {
        "avg_wait": round(statistics.mean(waits), 1) if waits else 0.0,
        "longest_wait": max(waits, default=0),
        "critical_waiting": sum(1 for p in h.waiting() if p.severity <= 2),
        "hallway": len(h.units["HALLWAY"].occupants),
        "held": len(h.holds),
        "diverted": h.diverted,
        "placed": len(h.waits),
        "waiting": len(now_waiting),
    }


def _radio_stub(text: str) -> RadioParse:
    t = text.lower()
    n = int(m.group(1)) if (m := re.search(r"(\d+)\s*(patients|injured|victims|casualties|people)", t)) else 3
    crit = int(m.group(1)) if (m := re.search(r"(\d+)\s*(critical|serious|red)", t)) else max(1, n // 4)
    eta = int(m.group(1)) if (m := re.search(r"(\d+)\s*(min|minutes)", t)) else 10
    what = "bus crash" if "bus" in t else "fire" if "fire" in t else "collision" if "crash" in t else "incident"
    pts = []
    for i in range(min(n, 30)):
        sev = (1 if i % 2 == 0 else 2) if i < crit else (3 if i % 3 else 4)
        pts.append(RadioPatient(complaint=f"injured in {what}", severity=sev, eta=min(120, eta + i % 4)))
    return RadioParse(patients=pts)


SPEEDS = (0.25, 0.5, 1, 2, 5)  # sim-minutes per real second; 0.5 is the default demo pace


class Engine:
    def __init__(self, llm: LLM | None = None) -> None:
        self.bus = EventBus()
        self.llm = llm or LLM()
        self.paused = False
        self.speed: float = 0.5
        self.drafts: dict[str, list[RadioPatient]] = {}
        self._loop_task: asyncio.Task | None = None
        self._cycle_task: asyncio.Task | None = None
        self.access = Access()  # DeepChart portal sessions survive a reset
        self.reset(seed=7)

    # ---------- lifecycle ----------
    def reset(self, seed: int = 7) -> None:
        self.seed = seed
        self.h, self.key = build_hospital(seed)
        self.portal = Portal(self)
        self.rng = random.Random(seed)
        self.swarm = Swarm(self.llm)
        self.llm.reset()  # a new run: new tape in live mode, replay restarts from the top
        self.last_cycle = -99
        self.surges = 0
        self.bus_crash_at: int | None = None
        self.bus.reset()
        self.audit: list[dict] = []
        self.caught: set[tuple[str, str]] = set()   # (pid, fact) the records check caught before a move
        self.cycle_ms: list[int] = []
        self.census: list[dict] = [{"clock": 0, **{u: self.h.occupancy(u) for u in ("ER", "ICU", "STEPDOWN", "WARD")}}]
        self.emit("notice", {"text": "Hospital reset. Normal evening, nearly full."})
        self.emit("snapshot", self.state(include_feed=False))

    def emit(self, type_: str, data: dict, *, cycle_id: str | None = None, round_: str | None = None,
             clock: int | None = None) -> None:
        t = self.h.clock if clock is None else clock
        self.bus.emit(type_, data, clock=t, cycle_id=cycle_id, round_=round_)
        if type_ in AUDITED:
            self.audit.append(audit_row(type_, data, t, cycle_id))
        if type_ in ("move.held", "move.flagged"):
            for c in data.get("conflicts", []):
                self.caught.add((data["pid"], c["fact"]))
        elif type_ == "cycle.end":
            self.cycle_ms.append(data.get("ms", 0))

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(1 / self.speed)
            if not self.paused:
                self.step()

    def start(self) -> None:
        if self._loop_task is None:
            self._loop_task = asyncio.create_task(self.run_forever())

    def step(self) -> None:
        """One simulated minute: clock, fast lane, maybe a swarm cycle."""
        h = self.h
        tick(h, self.rng, lambda t, d, **k: self.emit(t, d))
        fastlane.run(h, lambda t, d, **k: self.emit(t, d))
        self.emit("tick", {"clock": h.clock, "level": h.level})
        if h.clock % CENSUS_EVERY == 0:
            self.census.append({"clock": h.clock, **{u: h.occupancy(u) for u in ("ER", "ICU", "STEPDOWN", "WARD")}})
            self.census = self.census[-CENSUS_KEEP:]
        busy = self._cycle_task is not None and not self._cycle_task.done()
        if busy:
            return
        pressure = any(h.occupancy(u) >= 90 for u in ("ER", "ICU", "STEPDOWN", "WARD"))
        if (h.waiting() and h.clock - self.last_cycle >= CYCLE_GAP) or \
                (pressure and h.clock - self.last_cycle >= CYCLE_IDLE):
            self.last_cycle = h.clock
            trigger = f"{len(h.waiting())} waiting" if h.waiting() else "units near capacity"
            self._cycle_task = asyncio.create_task(self._cycle(trigger))

    async def _cycle(self, trigger: str) -> None:
        try:
            await self.swarm.run_cycle(self.h, self.emit, trigger)
        except Exception as exc:  # the board must keep moving
            self.emit("notice", {"text": f"swarm cycle failed ({exc}); code fallback continues"})

    # ---------- inputs ----------
    def surge(self, n: int = 25) -> int:
        self.surges += 1
        self.bus_crash_at = self.h.clock
        pts = mass_casualty(self.h, self.key, seed=self.seed + self.surges * 13, n=n, start=self.h.clock)
        self.emit("notice", {"text": f"MASS CASUALTY: bus crash, {len(pts)} patients inbound"})
        return len(pts)

    def busy_night(self, minutes: int = BUSY_MINUTES) -> int:
        """A busy night: everyday arrivals (mostly flu) triple for the next hour."""
        self.h.busy_until = self.h.clock + minutes
        self.h.version += 1
        self.emit("notice", {"text": f"Busy night: about three times more everyday patients for {minutes} minutes"})
        return self.h.busy_until

    async def radio(self, text: str) -> dict:
        out, _ = await self.llm.call(
            "intake", "lite",
            f"""Turn this EMS radio message into a list of incoming patients.
Severity: 1 = critical/life-threatening ... 5 = minor. eta = minutes until arrival.
Message: "{text}"
Use at most 30 patients. Do not add anyone not described.""",
            RadioParse, lambda: _radio_stub(text), 10.0)
        did = f"D{len(self.drafts) + 1}"
        self.drafts[did] = list(out.patients)
        return {"draft_id": did, "patients": [p.model_dump() for p in out.patients]}

    def confirm_radio(self, draft_id: str) -> int:
        from backend.sim.scenarios import _patient
        pts = self.drafts.pop(draft_id)
        for rp in pts:
            p = _patient(self.h, self.rng, "RD", rp.severity, rp.complaint,
                         arrived_at=self.h.clock + max(1, rp.eta), state="incoming",
                         needs_ct=rp.severity <= 2)
            give_records(p, self.rng)
            self.h.add_patient(p)
        self.emit("notice", {"text": f"Radio: {len(pts)} patients inbound"})
        return len(pts)

    def approve(self, approval_id: str, approve: bool) -> str:
        return approvals.resolve(self.h, approval_id, approve, lambda t, d, **k: self.emit(t, d))

    def resolve_hold(self, hold_id: str, outcome: str) -> str:
        return resolve_hold(self.h, hold_id, outcome, lambda t, d, **k: self.emit(t, d))

    def control(self, action: str, speed: float | None = None, key: str | None = None) -> None:
        if action == "pause":
            self.paused = True
        elif action == "resume":
            self.paused = False
        elif action == "speed" and speed in SPEEDS:
            self.speed = speed
            self.paused = False
        elif action == "reset":
            if key != DEMO_KEY:
                raise PermissionError("reset needs the demo key")
            if self._cycle_task and not self._cycle_task.done():
                self._cycle_task.cancel()
            self.reset(self.seed)
        self.emit("notice", {"text": f"control: {action}" + (f" {speed:g}x" if action == "speed" and speed is not None else "")})

    # ---------- outputs ----------
    def state(self, include_feed: bool = True) -> dict:
        s = self.h.snapshot()
        s.update({"level_name": escalation.NAMES[self.h.level], "paused": self.paused, "speed": self.speed,
                  "mode": self.llm.mode if not self.llm.breaker_open else "fallback",
                  "clock_start": CLOCK_START, "metrics": metrics(self.h), "bus_crash_at": self.bus_crash_at,
                  "census": self.census})
        if include_feed:
            # Ticks are noise on reload; keep the conversation and decisions.
            s["feed"] = [e for e in self.bus.history if e["type"] not in ("tick", "agent.thinking")][-300:]
        return s

    def results(self) -> dict:
        """Headline numbers for the board and the pitch, all measured on this run."""
        h = self.h
        by_sev: dict[str, list[int]] = {"1": [], "2": [], "3": [], "4-5": []}
        for _, sev, w in h.waits:
            by_sev["4-5" if sev >= 4 else str(sev)].append(w)
        planted = {(k["pid"], k["fact"]) for k in self.key if "fact" in k and k["pid"] in h.patients}
        arrived = {pid for pid, p in h.patients.items() if p.state != "incoming"}
        exposed = {x for x in planted if x[0] in arrived}  # mistakes on patients who are actually here
        caught = self.caught & planted
        verified = sum(len(p.verified) for p in h.patients.values())
        return {
            "time_to_bed": {k: {"patients": len(v), "avg_min": round(statistics.mean(v), 1) if v else None,
                                "max_min": max(v) if v else None} for k, v in by_sev.items()},
            "records_check": h.records_check,
            "records": {"planted": len(planted), "on_arrived_patients": len(exposed),
                        "caught_before_moving": len(caught), "waiting_for_a_human": len(h.holds),
                        "resolved_by_a_human": verified,
                        "extra_flags": len(self.caught - planted)},
            "agents": {"mode": self.llm.mode, "cycles": len(self.cycle_ms),
                       "avg_cycle_seconds": round(statistics.mean(self.cycle_ms) / 1000, 1) if self.cycle_ms else None,
                       "answers": dict(self.llm.hows), "agents": 10},
            "note": "Measured on this run. Record conflicts are planted by us, so 'caught' is checked "
                    "against a known answer key.",
        }

    def patient_detail(self, pid: str) -> dict:
        h = self.h
        p = h.patients[pid]
        hold = next((x for x in h.snapshot()["holds"] if x["pid"] == pid), None)
        last = next((e["data"] for e in reversed(self.bus.history)
                     if e["type"] in ("move.applied", "move.held", "move.flagged") and e["data"].get("pid") == pid),
                    None)
        flagged = None
        if p.records_flag and p.unit:
            v = gate.check(p, (last or {}).get("because") or [], p.unit)
            flagged = [{"fact": c.fact, "reason": c.reason, "versions": [x.__dict__ for x in c.versions]}
                       for c in v.conflicts]
        return {
            "patient": h.patient_row(p),
            "sources": [{"source_name": s.source_name, "recorded_date": s.recorded_date,
                         "claims": {f: {"value": c.value, "status": c.status, "resource_id": c.resource_id}
                                    for f, c in s.claims.items()}} for s in p.sources],
            "last_move": {"to_unit": last.get("to_unit"), "because": last.get("because", []),
                          "source": last.get("source")} if last else None,
            "hold": hold,
            "flagged_conflicts": flagged,
            "notice": "sources disagree; a human must resolve" if hold or flagged else "",
        }


# ---------- honest comparison: same scenario, three ways ----------
HOLD_REVIEW_MIN = 8  # in headless runs, a human reviews each hold after 8 minutes


def _greedy_flow(h: Hospital) -> None:
    """Every department for itself: normal flow only, no coordination, no escalation actions."""
    for p in [p for p in h.in_unit("WARD") if p.ready_for_discharge and p.pid not in h.locked][:1]:
        commit(h, Move(h.next_id("M"), p.pid, "WARD", "HOME", "discharge", source="baseline"))
    for p in [p for p in h.in_unit("ICU") if p.improving and p.pid not in h.locked][:1]:
        if h.units["STEPDOWN"].free > 0:
            commit(h, Move(h.next_id("M"), p.pid, "ICU", "STEPDOWN", "transfer", source="baseline"))


def _ladder_flow(h: Hospital) -> None:
    plan = rule_plan(h)
    for pm in plan.moves:
        p = h.patients[pm.pid]
        commit(h, Move(h.next_id("M"), pm.pid, p.unit, pm.to_unit, pm.kind, source="baseline", reason=pm.reason))
    for e in plan.escalations:
        a = approvals.request(h, e)
        if a:
            approvals.resolve(h, a.approval_id, True)  # the human says yes, identically in every arm


def run_headless(seed: int, arm: str, minutes: int = 150, n: int = 25) -> dict:
    h, key = build_hospital(seed)
    rng = random.Random(seed)
    swarm = Swarm(LLM(mode="stub", fake_latency=False)) if arm == "swarm" else None
    holds_seen: set[str] = set()
    for t in range(minutes):
        if t == 5:
            mass_casualty(h, key, seed=seed, n=n, start=h.clock)
        tick(h, rng)
        fastlane.run(h)
        if arm == "greedy":
            _greedy_flow(h)
        elif arm == "ladder" and t % CYCLE_GAP == 0:
            _ladder_flow(h)
        elif arm == "swarm" and t % CYCLE_GAP == 0:
            asyncio.run(swarm.run_cycle(h, lambda *a, **k: None, "headless"))
            for aid in list(h.approvals):
                approvals.resolve(h, aid, True)
        holds_seen.update(h.holds)
        for hid, hold in list(h.holds.items()):
            if h.clock - hold.created_at >= HOLD_REVIEW_MIN:
                resolve_hold(h, hid, "proceed")
    m = metrics(h)
    crit_over = sum(1 for _, sev, w in h.waits if sev <= 2 and w > 10) + \
        sum(1 for p in h.waiting() if p.severity <= 2 and h.clock - p.arrived_at > 10)
    return {"avg_wait": m["avg_wait"], "longest_wait": m["longest_wait"], "critical_over_10": crit_over,
            "hallway_minutes": h.hallway_minutes, "held": len(holds_seen), "still_waiting": m["waiting"],
            "diverted": h.diverted}


ARMS = [("greedy", "Every department for itself"), ("ladder", "Greedy + escalation rules (code)"),
        ("swarm", "Hospital Swarm")]


def compare(seeds: tuple[int, ...] = (7, 11, 23)) -> dict:
    out = []
    for arm, label in ARMS:
        runs = [run_headless(s, arm) for s in seeds]
        avg = {k: round(statistics.mean(r[k] for r in runs), 1) for k in runs[0]}
        out.append({"arm": arm, "label": label, **avg})
    return {"seeds": list(seeds), "arms": out,
            "note": "Swarm arm here runs the agents in stub mode (rule-based answers). "
                    "Record live Gemini runs to compare the real model."}
