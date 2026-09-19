"""One swarm cycle, as a real conversation between agents.

 1. STATUS    every department reports to the coordinator (8 in parallel)
 2. QUESTION  on contention, the coordinator asks a department; that department may ask ANOTHER
              department directly (e.g. ICU → STEPDOWN "can you take IN-15?"), up to 2 hops
 3. PLAN      the coordinator announces one plan, to everyone and to each affected department
 4. ACK       affected departments confirm or object (code still decides)
 5. APPLY     every move re-checked at live state; VALIDATOR and DEEPCHART speak when they reject/hold
The hospital keeps ticking while agents talk; that's why every move is re-validated at apply time.
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable

from backend.agents.coordinator import Coordinator, question_for
from backend.agents.departments import BY_NAME, DEPARTMENTS, OWNER, DepartmentAgent
from backend.agents.llm import LLM
from backend.agents.schemas import DeptAnswer, DeptStatus, Plan
from backend.sim import approvals, fastlane
from backend.sim.hospital import Hospital
from backend.sim.models import Move
from backend.sim.pipeline import commit
from backend.sim.words import plain

MAX_HOPS = 2
PERSONA = {d.name: d.archetype for d in DEPARTMENTS} | {"COORDINATOR": "Prism"}
ESC_OWNER = {"cancel_elective": "OR", "call_in_staff": "STAFFING", "divert_ambulances": "EMS", "transfer_out": "EMS"}
UNIT_WORDS = {"STEPDOWN": "the close-watch beds", "LOUNGE": "discharge lounge", "HOME": "home", "PARTNER": "a partner hospital",
              "HALLWAY": "a hallway bed", "PACU": "recovery (PACU)", "RESUS": "resus"}


def _where(unit: str) -> str:
    return UNIT_WORDS.get(unit, unit)


class Swarm:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm
        self.depts = {d.name: DepartmentAgent(d, llm) for d in DEPARTMENTS}
        self.coordinator = Coordinator(llm)
        self.cycles = 0
        self._msg = 0

    async def run_cycle(self, h: Hospital, emit: Callable, trigger: str) -> dict:
        self.cycles += 1
        cid = f"cy{self.cycles}"
        started = time.monotonic()

        def ev(type_, data, round_=None):
            emit(type_, data, cycle_id=cid, round_=round_)

        def say(frm: str, to: list[str], kind: str, text: str, round_: str, pids=(), how: str = "code"):
            self._msg += 1
            ev("agent.message", {"msg_id": f"{cid}-{self._msg}", "from": frm, "to": to, "kind": kind,
                                 "persona": PERSONA.get(frm, ""), "text": plain(text, h),
                                 "pids": [p for p in pids if p], "how": how}, round_)

        def thinking(frm: str, to: list[str], round_: str):
            ev("agent.thinking", {"from": frm, "to": to}, round_)

        ev("cycle.start", {"cycle_id": cid, "trigger": trigger})

        # 1. STATUS: every department reports, in parallel; each line appears as soon as it's ready.
        statuses: dict[str, DeptStatus] = {}

        async def one(name: str, agent: DepartmentAgent) -> None:
            thinking(name, ["COORDINATOR"], "status")
            st, how = await agent.status(h)
            statuses[name] = st
            ev("agent.status", {"unit": name, **st.model_dump(), "stale": how == "stale", "how": how}, "status")
            say(name, ["COORDINATOR"], "status", st.line, "status", [o.pid for o in st.can_free], how)

        await asyncio.gather(*(one(n, a) for n, a in self.depts.items()))

        # 2. QUESTION (only on contention): coordinator asks; departments may ask each other directly.
        answers: dict[str, DeptAnswer] = {}
        q = question_for(h)
        if q:
            unit, question = q
            ev("coordinator.question", {"unit": unit, "question": question}, "question")
            say("COORDINATOR", [unit], "ask", question, "question")
            asker, target, text = "COORDINATOR", unit, question
            for _hop in range(MAX_HOPS + 1):
                thinking(target, [asker], "question")
                ans, how = await self.depts[target].answer(h, text, asker)
                answers[target] = ans
                ev("agent.answer", {"unit": target, "answer": ans.answer}, "question")
                say(target, [asker], "reply", ans.answer, "question", [o.pid for o in ans.can_free], how)
                nxt = ans.ask_unit
                if not nxt or nxt in answers or nxt not in self.depts or not ans.ask_text:
                    break
                say(target, [nxt], "ask", ans.ask_text, "question", [o.pid for o in ans.can_free], how)
                asker, target, text = target, nxt, ans.ask_text

        # 3. PLAN: one coordinator call; announced to everyone and to each affected department.
        thinking("COORDINATOR", ["ALL"], "plan")
        plan, how = await self.coordinator.plan(h, statuses, answers)
        ev("coordinator.plan", {"summary": plan.summary, "how": how,
                                "moves": [m.model_dump() for m in plan.moves],
                                "escalations": [e.model_dump() for e in plan.escalations]}, "plan")
        say("COORDINATOR", ["ALL"], "plan", plan.summary, "plan", [m.pid for m in plan.moves], how)
        orders = self._orders(h, plan)
        for dept, lines in orders.items():
            say("COORDINATOR", [dept], "plan", "; ".join(lines[:6]) + ("; …" if len(lines) > 6 else ""), "plan",
                [ln.split(" ")[0] for ln in lines], how)

        # 4. ACK: affected departments confirm or object, in parallel. Code still decides.
        async def ack(dept: str, lines: list[str]) -> None:
            thinking(dept, ["COORDINATOR"], "plan")
            a, ahow = await self.depts[dept].ack(h, lines)
            say(dept, ["COORDINATOR"], "ack" if a.ok else "object", a.text, "plan", (), ahow)

        await asyncio.gather(*(ack(d, ls) for d, ls in orders.items() if d in self.depts))

        # 5. APPLY at live state. Rule-keepers speak up when they reject or hold.
        counts = {"applied": 0, "flagged": 0, "held": 0, "dropped": 0}
        held_from: dict[str, str] = {}

        def on_event(m: Move):
            def hook(t, d, **_):
                d = _explain(d, m, t)
                ev(t, d, "apply")
                if t == "move.dropped":
                    say("VALIDATOR", ["COORDINATOR"], "system",
                        f"Rejected {m.pid} → {_where(m.to_unit)}: {d['reason']}.", "apply", [m.pid])
                elif t == "move.held":
                    facts = ", ".join(c["fact"].replace("_", " ") for c in d["conflicts"])
                    say("DEEPCHART", ["COORDINATOR", OWNER.get(m.to_unit, "ER")], "system",
                        f"Holding {m.pid} → {_where(m.to_unit)}: records disagree on {facts}. "
                        f"Sources disagree; a human must resolve.", "apply", [m.pid])
                elif t == "move.flagged":
                    facts = ", ".join(c["fact"].replace("_", " ") for c in d["conflicts"])
                    say("DEEPCHART", ["COORDINATOR", OWNER.get(m.to_unit, "ER")], "system",
                        f"{m.pid} placed in {_where(m.to_unit)} (life-saving), but records disagree on {facts}. "
                        f"Flagged for human review.", "apply", [m.pid])
            return hook

        for pm in plan.moves:
            p = h.patients.get(pm.pid)
            from_unit = p.unit if p else None
            m = Move(h.next_id("M"), pm.pid, from_unit, pm.to_unit, pm.kind, source="swarm", reason=pm.reason)
            if pm.to_unit in held_from:
                m.depends_on = [held_from[pm.to_unit]]
            result = commit(h, m, on_event(m))
            counts[result] += 1
            if result == "held" and from_unit:
                held_from[from_unit] = pm.pid

        for e in plan.escalations:
            a = approvals.request(h, e, lambda t, d, **_: ev(t, d, "apply"))
            if a:
                say("ESCALATION", [ESC_OWNER[e.action], "COORDINATOR"], "system",
                    f"Needs the incident commander's approval: {a.detail}.", "apply")

        # Anyone still waiting whose natural bed is free gets it (code fallback).
        placed = []
        for p in h.waiting():
            r = fastlane.place_one(h, p, lambda t, d, **_: ev(t, d, "apply"), source="fallback")
            if r:
                counts[r] += 1
                placed.append(p.pid)
        if placed:
            say("FASTLANE", ["ER"], "system", f"Placed {len(placed)} more waiting patient(s) in free beds: "
                f"{', '.join(placed[:5])}.", "apply", placed[:5])

        ms = round(1000 * (time.monotonic() - started))
        ev("cycle.end", {"cycle_id": cid, **counts, "ms": ms, "how": how})
        return counts

    @staticmethod
    def _orders(h: Hospital, plan: Plan) -> dict[str, list[str]]:
        """Group the plan's moves by department: the one sending the patient and the one receiving."""
        out: dict[str, list[str]] = {}
        for m in plan.moves:
            p = h.patients.get(m.pid)
            src = OWNER.get(p.unit, "ER") if p and p.unit else "ER"
            dst = OWNER.get(m.to_unit, "ER")
            line = f"{m.pid} → {_where(m.to_unit)}" + (f" ({m.reason})" if m.reason else "")
            for d in dict.fromkeys([src, dst]):
                out.setdefault(d, []).append(line)
        for e in plan.escalations:
            out.setdefault(ESC_OWNER[e.action], []).append(f"request approval: {e.action.replace('_', ' ')}")
        return out


def _explain(d: dict, m: Move, type_: str) -> dict:
    if type_ == "move.dropped" and m.depends_on and "full" in d.get("reason", ""):
        d = {**d, "reason": f"{d['reason']} — waiting on held move for {m.depends_on[0]}"}
    return d


__all__ = ["Swarm", "BY_NAME"]
