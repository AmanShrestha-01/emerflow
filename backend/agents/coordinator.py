"""The head agent: reads every department's report and writes one plan for the whole hospital.

It picks units, never bed numbers, and never approves its own big actions.
Fallback (stub mode, timeout, bad answer): the rule-based ladder planner.
"""
from __future__ import annotations

import json

from backend.agents.llm import LLM
from backend.agents.schemas import DeptAnswer, DeptStatus, Plan, plan_schema
from backend.sim import escalation
from backend.sim.hospital import Hospital
from backend.sim.ladder import rule_plan
from backend.sim.models import DESTINATIONS, Move
from backend.sim.rules import ESCALATION_ACTIONS, check_move

COORD_TIMEOUT = 30.0


def movable_pids(h: Hospital) -> list[str]:
    return [p.pid for p in h.patients.values()
            if p.state in ("waiting", "placed") and p.pid not in h.locked]


CAPACITY_ONLY = ("is full", "no nurse free")


def options_for(h: Hospital, pid: str) -> list[str]:
    """Destinations this patient may go to right now if a bed were free (code decides; capacity aside)."""
    p = h.patients[pid]
    out = []
    for dest in DESTINATIONS:
        if dest == p.unit:
            continue
        r = check_move(Move("menu", pid, p.unit, dest, "admit"), h)
        if r is None or r.endswith(CAPACITY_ONLY):
            out.append(dest)
    return out


def plan_prompt(h: Hospital, statuses: dict[str, DeptStatus], answers: dict[str, DeptAnswer]) -> str:
    allowed = [a for a, lvl in ESCALATION_ACTIONS.items() if h.level >= lvl]
    units = {n: {"beds": u.beds, "free": u.free} for n, u in h.units.items()}
    waiting = [{"pid": p.pid, "severity": p.severity, "complaint": p.complaint, "needs": p.need,
                "waited_min": h.clock - p.arrived_at, "may_go_to": options_for(h, p.pid)}
               for p in h.waiting()]
    movable = [{"pid": p.pid, "in": p.unit, "severity": p.severity,
                "why": "improving" if p.improving else "ready for discharge",
                "may_go_to": [d for d in options_for(h, p.pid) if d in ("STEPDOWN", "WARD", "LOUNGE", "HOME")]}
               for u in ("ICU", "STEPDOWN", "WARD") for p in h.in_unit(u)
               if p.pid not in h.locked and (p.improving or p.ready_for_discharge)]
    from backend.sim.ladder import ADMIT_TO, boarders, surgical
    movable += [{"pid": p.pid, "in": p.unit or "waiting room", "severity": p.severity,
                 "why": f"needs surgery ({p.complaint})",
                 "may_go_to": [d for d in options_for(h, p.pid) if d == "OR"]}
                for p in surgical(h)]
    movable += [{"pid": p.pid, "in": p.unit, "severity": p.severity, "why": "admitted, waiting in an ER bed",
                 "may_go_to": [d for d in options_for(h, p.pid) if d in ADMIT_TO.get(p.severity, [])]}
                for p in boarders(h)]
    movable = [m for m in movable if m["may_go_to"]]
    return f"""You are Prism, the hospital coordinator and the incident commander's right hand during a surge.
Your thinking style (Prism): you refract one crisis into every department's perspective, then choose.
Personality and voice: calm, decisive and fair. You weigh every department's case, name the trade-off you
are making, and never take sides on whose need is louder, only on who is sicker.
Escalation level: {h.level} ({escalation.NAMES[h.level]}). Escalation actions allowed now: {allowed or "none"}.

Department reports:
{json.dumps({k: v.model_dump() for k, v in statuses.items()})}
{"Answers to your questions: " + json.dumps({k: v.model_dump() for k, v in answers.items()}) if answers else ""}

Waiting patients, most critical first. "may_go_to" is the ONLY list of units each may use (code already
applied severity, CT-scan and level rules; capacity is shown separately):
{json.dumps(waiting)}

Inpatients who can move on to make room, and admitted ER patients waiting for an upstairs bed
("may_go_to" is their only allowed list):
{json.dumps(movable)}

Free beds per unit right now: {json.dumps(units)}

Write ONE plan:
1. Place the most critical waiting patients first, in the best unit from their "may_go_to".
2. If that unit is full, FIRST move an inpatient out of it to free a bed (e.g. an improving ICU patient to
   STEPDOWN), then place the patient. A make-room move must come BEFORE the move that uses the bed.
   Freeing a proper bed is better than a HALLWAY bed; use HALLWAY/PACU only when nothing can be freed.
3. Never move a patient to a unit outside their "may_go_to". Never exceed free beds (count freed beds).
4. Escalations: only from the allowed list, only when clearly needed; a human approves them.
5. summary: one or two short sentences a person with no medical background understands. Everyday words only
   (say "moving patients out", not "decanting"; "close-watch beds", never "step-down"; "intensive care", not "ICU capacity").
   The unit called STEPDOWN in the data is the "close-watch beds": patients who no longer need intensive care but still need watching.
   Refer to patients by name if at all, never by id.
Use only patient ids listed above. Choose units, never bed numbers. Code re-checks every move, and a records
check compares each patient's records on the facts the move relies on. Never state which record is correct
and never give clinical instructions."""


def question_for(h: Hospital) -> tuple[str, str] | None:
    """Code detects contention and writes the coordinator's question. None = no question round."""
    crit = [p for p in h.waiting() if p.severity <= 2]
    icu_free = h.units["ICU"].free
    if len(crit) > icu_free:
        return "ICU", (f"{len(crit)} critical patients need ICU-level beds and you have {icu_free} free. "
                       f"Who could move to the close-watch beds in the next 15 minutes?")
    if len(h.waiting()) >= 5 and h.units["STEPDOWN"].free == 0:
        return "STEPDOWN", "The close-watch beds are full and more people are waiting. Who can move to the ward or go home?"
    return None


class Coordinator:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm

    async def plan(self, h: Hospital, statuses: dict[str, DeptStatus],
                   answers: dict[str, DeptAnswer]) -> tuple[Plan, str]:
        schema = plan_schema(movable_pids(h))
        out, how = await self.llm.call("coordinator", "pro", plan_prompt(h, statuses, answers), schema,
                                       lambda: rule_plan(h), COORD_TIMEOUT)
        return Plan.model_validate(out.model_dump()), how
