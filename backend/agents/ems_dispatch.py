"""EMS dispatcher agent for the EMS map's crash simulator.

"AI talks, code counts": Gemini ranks hospitals for each triage group and writes a plain briefing.
It never counts beds or picks times. Code checks every pick (urgent patients only to trauma centers,
no full ER while an open one exists, only real hospital ids) and the browser works out beds and waits.
With Gemini off or failing, rule_plan() gives the same shape.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

GROUPS = ("urgent", "delayed", "minor")
TIMEOUT = 12.0


class HospitalIn(BaseModel):
    id: str
    name: str
    trauma: str | None = None
    status: Literal["open", "busy", "critical"]
    drive_min: int
    beds_free: int = 0
    level: int | None = None  # live MIEMSS ED crowding level, 1-4, when known


class DispatchIn(BaseModel):
    casualties: int
    urgent: int
    delayed: int
    minor: int
    place: str = ""
    hospitals: list[HospitalIn]


class GroupPlan(BaseModel):
    hospitals: list[str] = Field(description="hospital ids, best first, 2 to 4 of them")
    why: str = Field(description="one short plain sentence: why these hospitals for this group")


class DispatchPlan(BaseModel):
    urgent: GroupPlan
    delayed: GroupPlan
    minor: GroupPlan
    briefing: str = Field(description="two or three plain sentences for the public: what happens to the injured")


def _ok(h: HospitalIn, group: str) -> bool:
    return bool(h.trauma) if group == "urgent" else True


def rule_plan(req: DispatchIn) -> DispatchPlan:
    """No AI: urgent to the closest trauma centers; the rest to the closest ERs that aren't full,
    with minor injuries sent a little further out so the closest beds stay free for sicker people."""
    def ranked(group: str) -> list[str]:
        pool = [h for h in req.hospitals if _ok(h, group)] or req.hospitals
        open_ = [h for h in pool if h.status != "critical"] or pool
        key = (lambda h: h.drive_min) if group != "minor" else (lambda h: (h.status != "open", h.drive_min))
        order = sorted(open_, key=key)
        if group == "minor" and len(order) > 3:
            order = order[1:4] + order[:1]  # skip the very closest
        return [h.id for h in order[:4]]
    names = {h.id: h.name for h in req.hospitals}
    u, d, m = ranked("urgent"), ranked("delayed"), ranked("minor")
    return DispatchPlan(
        urgent=GroupPlan(hospitals=u, why="The closest trauma centers, because these patients need surgery-ready care fast."),
        delayed=GroupPlan(hospitals=d, why="The closest emergency rooms that still have room."),
        minor=GroupPlan(hospitals=m, why="Emergency rooms a little further away, so the closest beds stay free for sicker patients."),
        briefing=(f"{req.urgent} badly hurt people go first, to trauma centers such as {names.get(u[0], 'the nearest one') if u else 'the nearest one'}. "
                  f"{req.delayed} people who can wait a little and {req.minor} with minor injuries are spread over other nearby ERs "
                  "so no single hospital is swamped."),
    )


def check(plan: DispatchPlan, req: DispatchIn) -> DispatchPlan:
    """Code owns the rules: drop unknown ids and non-trauma picks for urgent patients, avoid full ERs
    while open ones exist, and fill any empty group from the rule plan."""
    by_id = {h.id: h for h in req.hospitals}
    fallback = rule_plan(req)
    any_open = any(h.status != "critical" for h in req.hospitals)
    out = {}
    for g in GROUPS:
        picks = [i for i in dict.fromkeys(getattr(plan, g).hospitals) if i in by_id and _ok(by_id[i], g)]
        if any_open and g != "urgent":
            picks = [i for i in picks if by_id[i].status != "critical"]
        why = getattr(plan, g).why
        if not picks:
            picks, why = getattr(fallback, g).hospitals, getattr(fallback, g).why
        out[g] = GroupPlan(hospitals=picks[:4], why=why)
    return DispatchPlan(**out, briefing=plan.briefing or fallback.briefing)


def prompt(req: DispatchIn) -> str:
    rows = "\n".join(
        f"- {h.id}: {h.name} | {h.drive_min} min drive | ER {h.status}"
        f"{f', crowding level {h.level}/4' if h.level else ''} | {h.beds_free} beds free"
        f"{f' | trauma center {h.trauma}' if h.trauma else ''}"
        for h in req.hospitals)
    return f"""You are the EMS dispatcher for a mass-casualty crash in Baltimore{f' ({req.place})' if req.place else ''}.
{req.casualties} people are hurt:
- urgent (needs care now, life-threatening): {req.urgent}
- delayed (serious, can wait a little): {req.delayed}
- minor (walking wounded): {req.minor}

Hospitals (drive time from the crash, how full the ER is right now):
{rows}

For each group, list 2 to 4 hospital ids, best first. Rules:
- Urgent patients go only to trauma centers.
- Avoid ERs marked critical while others are open.
- Spread people out so no one ER is swamped; keep the closest beds for the sickest.
Do not count beds or give times: software does that. Then write a two or three sentence briefing
in plain words anyone can follow: say which hospitals take the urgent patients and where the others go,
by hospital name. No medical instructions."""


async def dispatch(llm, req: DispatchIn) -> tuple[DispatchPlan, str]:
    plan, how = await llm.call("ems-dispatch", "lite", prompt(req), DispatchPlan, lambda: rule_plan(req), TIMEOUT)
    return check(plan, req), how
