"""The 8 department agents: one class, eight configs.

Each config says what the department SEES (a view function over hospital state, injected by the
server), what it WANTS (goal), and what it CAN'T do (limits, enforced again in rules.py).
Each also has a rule-based stub, used in stub mode and whenever a live call fails.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Callable

from backend.agents.llm import LLM
from backend.agents.schemas import DeptAck, DeptAnswer, DeptStatus, Offer
from backend.sim.hospital import Hospital
from backend.sim.rules import NURSE_RATIO

DEPT_TIMEOUT = 20.0

# Which department speaks for each hospital unit / destination.
OWNER: dict[str, str] = {
    "RESUS": "ER", "ER": "ER", "HALLWAY": "ER", "ICU": "ICU", "STEPDOWN": "STEPDOWN", "WARD": "STEPDOWN",
    "LOUNGE": "STEPDOWN", "OR": "OR", "PACU": "OR", "HOME": "STEPDOWN", "PARTNER": "EMS",
}


# ---------- views: what each department is allowed to see ----------
def _er_view(h: Hospital) -> dict:
    return {"waiting": [{"pid": p.pid, "severity": p.severity, "complaint": p.complaint,
                         "waited_min": h.clock - p.arrived_at, "needs_ct": p.needs_ct and not p.ct_done,
                         "tests_pending": p.tests_pending()}
                        for p in h.waiting()],
            "ER": h.unit_view("ER"), "RESUS": h.unit_view("RESUS"), "HALLWAY_free": h.units["HALLWAY"].free,
            "level": h.level}


def _icu_view(h: Hospital) -> dict:
    return {"ICU": h.unit_view("ICU")}


def _floors_view(h: Hospital) -> dict:
    return {"STEPDOWN": h.unit_view("STEPDOWN"), "WARD": h.unit_view("WARD"),
            "LOUNGE_free": h.units["LOUNGE"].free, "level": h.level}


def _or_view(h: Hospital) -> dict:
    return {"cases": [{"case_id": c.case_id, "kind": c.kind, "starts_at": c.starts_at, "ends_at": c.ends_at,
                       "running": c.starts_at <= h.clock}
                      for c in h.or_cases if not c.cancelled and c.ends_at > h.clock],
            "OR": h.unit_view("OR"), "PACU": h.unit_view("PACU"), "clock": h.clock}


def _staff_view(h: Hospital) -> dict:
    return {"nurses": dict(h.nurses), "ratios": NURSE_RATIO, "off_duty": h.off_duty_nurses,
            "load": {u: len(h.units[u].occupants) + len(h.units[u].reserved) for u in NURSE_RATIO},
            "callins_pending": [{"arrives_at": a, "unit": u, "count": n} for a, u, n in h.callins]}


def _imaging_view(h: Hospital) -> dict:
    return {"ct_queue": [{"pid": pid, "severity": h.patients[pid].severity} for pid in h.ct_queue],
            "minutes_per_scan": 6}


def _xray_view(h: Hospital) -> dict:
    return {"xray_queue": [{"pid": pid, "severity": h.patients[pid].severity, "complaint": h.patients[pid].complaint}
                           for pid in h.xray_queue],
            "rooms": 2, "minutes_per_image": 3}


def _lab_view(h: Hospital) -> dict:
    return {"lab_queue": [{"pid": pid, "severity": h.patients[pid].severity,
                           "waited_min": h.clock - h.patients[pid].arrived_at} for pid in h.lab_queue],
            "results_per_minute": 1, "minimum_minutes_per_sample": 8}


def _blood_view(h: Hospital) -> dict:
    need = [p for p in h.patients.values() if p.needs_blood and p.state in ("waiting", "placed", "held")]
    return {"stock": dict(h.blood), "patients_needing_blood": [{"pid": p.pid, "type": p.blood_type} for p in need]}


def _ems_view(h: Hospital) -> dict:
    inc = [p for p in h.patients.values() if p.state == "incoming"]
    return {"incoming": [{"pid": p.pid, "severity": p.severity, "eta_min": p.arrived_at - h.clock} for p in inc],
            "partners_beds": dict(h.partners), "diversion": h.diversion, "level": h.level}


# ---------- stubs: rule-based answers in the same form ----------
def _er_stub(h: Hospital) -> DeptStatus:
    w = h.waiting()
    crit = sum(1 for p in w if p.severity <= 2)
    free = h.units["ER"].free
    needs = [f"{crit} ICU-level beds for critical patients"] if crit else []
    line = f"{len(w)} waiting ({crit} critical), {free} ER beds free" if w else f"No one waiting, {free} ER beds free"
    return DeptStatus(line=line, free_now=free, needs=needs,
                      blockers=["ER cannot refuse anyone (EMTALA)"] if free == 0 else [])


def _icu_stub(h: Hospital) -> DeptStatus:
    u = h.units["ICU"]
    offers = [Offer(pid=p.pid, to_unit="STEPDOWN", ready_in_min=0, why="getting better, can move to a close-watch bed")
              for p in h.in_unit("ICU") if p.improving and p.pid not in h.locked]
    line = (f"{u.free} bed left, holding it for critical patients" if u.free == 1 else
            f"ICU full; {len(offers)} patient(s) getting better could move to close-watch beds" if u.free == 0 else
            f"{u.free} ICU beds open")
    return DeptStatus(line=line, free_now=u.free, can_free=offers)


def _floors_stub(h: Hospital) -> DeptStatus:
    offers = [Offer(pid=p.pid, to_unit="WARD", ready_in_min=5, why="stable, ready for the ward")
              for p in h.in_unit("STEPDOWN") if p.improving and p.pid not in h.locked]
    offers += [Offer(pid=p.pid, to_unit="LOUNGE", ready_in_min=0, why="ready to go home")
               for p in h.in_unit("WARD") if p.ready_for_discharge and p.pid not in h.locked]
    sd, wd = h.units["STEPDOWN"].free, h.units["WARD"].free
    return DeptStatus(line=f"Close-watch beds {sd} free, ward {wd} free; {len(offers)} patients could move on",
                      free_now=sd, can_free=offers)


def _or_stub(h: Hospital) -> DeptStatus:
    upcoming = [c for c in h.or_cases if not c.cancelled and c.kind == "elective" and c.starts_at > h.clock]
    pacu = h.units["PACU"].free
    line = (f"{len(upcoming)} elective case(s) still to start; cancelling them frees {len(upcoming)} PACU beds"
            if upcoming else f"No electives left to cancel; PACU {pacu} free")
    return DeptStatus(line=line, free_now=pacu,
                      needs=[] if not upcoming else ["approval to cancel electives if PACU is needed"])


def _staff_stub(h: Hospital) -> DeptStatus:
    tight = [u for u, r in NURSE_RATIO.items()
             if len(h.units[u].occupants) + len(h.units[u].reserved) >= h.nurses.get(u, 0) * r]
    line = (f"At nurse ratio limit in {', '.join(tight)}; {h.off_duty_nurses} off-duty nurses can come in (45 min)"
            if tight else f"Ratios OK; {h.off_duty_nurses} off-duty nurses on call")
    return DeptStatus(line=line, needs=[f"nurses for {u}" for u in tight])


def _imaging_stub(h: Hospital) -> DeptStatus:
    q = h.ct_queue
    line = f"CT queue {len(q)}; next scan within 6 min" if q else "CT scanner free"
    return DeptStatus(line=line, blockers=[f"{pid} can't leave ER until scanned" for pid in q[:3]])


def _xray_stub(h: Hospital) -> DeptStatus:
    q = h.xray_queue
    line = f"X-ray queue {len(q)}; about {-(-len(q) // 2) * 3} min to clear with both rooms" if q else "X-ray rooms free"
    return DeptStatus(line=line, blockers=[f"{pid} can't go to a regular bed until X-rayed" for pid in q[:3]])


def _lab_stub(h: Hospital) -> DeptStatus:
    q = h.lab_queue
    line = f"{len(q)} samples waiting; the last result in about {max(len(q), 8)} min" if q else "Lab caught up"
    return DeptStatus(line=line, blockers=[f"{pid} can't go to a regular bed until results are back" for pid in q[:3]])


def _blood_stub(h: Hospital) -> DeptStatus:
    oneg = h.blood.get("O-", 0)
    line = f"O-negative {oneg} units" + (" — running low, save for unknown-type trauma" if oneg <= 4 else "")
    return DeptStatus(line=line, blockers=["O-neg low"] if oneg <= 4 else [])


def _ems_stub(h: Hospital) -> DeptStatus:
    inc = [p for p in h.patients.values() if p.state == "incoming"]
    beds = sum(h.partners.values())
    line = (f"{len(inc)} ambulance patients inbound; partners have {beds} beds"
            + ("; ON DIVERSION" if h.diversion else ""))
    return DeptStatus(line=line, needs=["diversion approval"] if h.level >= 3 and not h.diversion else [])


@dataclass
class DeptConfig:
    name: str
    goal: str
    limits: str
    view: Callable[[Hospital], dict]
    stub: Callable[[Hospital], DeptStatus]
    role: str = ""          # who this agent is
    persona: str = ""       # temperament and voice: how it talks
    pushes_for: str = ""    # what it argues for in negotiation
    pushes_back: str = ""   # when it says no or raises a concern
    temperature: float = 0.4
    archetype: str = ""     # Kairos-style thinking persona name
    lens: str = ""          # how that persona thinks


DEPARTMENTS: list[DeptConfig] = [
    DeptConfig(
        "ER", "Get waiting patients seen and into beds fast; nobody leaves unseen.",
        "You cannot refuse any patient (EMTALA). Severity 1 always gets a bed.", _er_view, _er_stub,
        role="the emergency department charge nurse",
        persona="Urgent and blunt. Short sentences. Always leads with how many are waiting and how sick they are.",
        pushes_for="beds upstairs for the ER's sickest patients, right now",
        pushes_back="when anyone suggests the ER can wait or absorb more without beds",
        temperature=0.6,
        archetype="Apex", lens="You cut to the core: who is sickest and has waited longest, and what single bed would change that?"),
    DeptConfig(
        "ICU", "Keep capacity for the sickest patients.",
        "1 nurse per 2 patients. Only patients who are getting better may move out to close-watch beds.", _icu_view, _icu_stub,
        role="the ICU attending",
        persona="Cautious and protective. Measured, precise wording. Thinks one step ahead about the next crash.",
        pushes_for="keeping one bed in reserve and only admitting truly critical patients",
        pushes_back="when asked to take patients who could go elsewhere, or to move patients out too early",
        temperature=0.2,
        archetype="Veil", lens="You look beneath the surface: what hidden risk does saying yes create, and who could crash next?"),
    DeptConfig(
        "STEPDOWN", "Take patients leaving intensive care; move stable patients to the ward and ready ones home.",
        "Close-watch beds: 1 nurse per 4 patients. Only discharge-ready patients go to the lounge.",
        _floors_view, _floors_stub,
        role="the bed manager for the close-watch beds and the ward",
        persona="Practical and cooperative. Thinks in chains: who moves out so someone else can move in.",
        pushes_for="moving discharge-ready patients out first so beds open up down the chain",
        pushes_back="when handed more patients than it has nurses for",
        temperature=0.4,
        archetype="Forge", lens="You build practical chains: who moves out, so someone else can move in, in what order?"),
    DeptConfig(
        "OR", "Finish urgent surgery; protect recovery room beds.",
        "Never cancel urgent cases. Cancelling electives needs human approval.", _or_view, _or_stub,
        role="the surgical services coordinator",
        persona="Schedule-minded and a little territorial. Talks in case times and recovery beds.",
        pushes_for="protecting the surgery schedule; offering to cancel electives only as a trade",
        pushes_back="when recovery beds are used as overflow without anyone asking about the schedule",
        temperature=0.3,
        archetype="Crux", lens="You find the make-or-break trade: what would you give up, and what do you need in return?"),
    DeptConfig(
        "STAFFING", "Keep nurse ratios safe without burning out staff.",
        "Call-ins take 45 minutes and need human approval.", _staff_view, _staff_stub,
        role="the house nursing supervisor",
        persona="Protective of nurses and plain-spoken. Counts heads before anything else.",
        pushes_for="safe nurse ratios; calling in staff early rather than late",
        pushes_back="when a plan opens beds that no nurse can cover",
        temperature=0.3,
        archetype="Root", lens="You go to first principles: every bed needs a nurse. Count people before counting beds."),
    DeptConfig(
        "IMAGING", "Scan the most critical patients first.",
        "One CT scanner, one scan at a time (~6 min). X-rays are a different department.", _imaging_view, _imaging_stub,
        role="the CT lead technologist",
        persona="Methodical and queue-focused. Speaks in minutes and positions in line.",
        pushes_for="scanning by severity, not by who shouts loudest",
        pushes_back="when patients are moved upstairs before their scan is done",
        temperature=0.2,
        archetype="Trace", lens="You track dependencies: which patients cannot move anywhere until something else happens first?"),
    DeptConfig(
        "XRAY", "Image the most critical patients first, so they can move on.",
        "Two X-ray rooms, about 3 minutes per image.", _xray_view, _xray_stub,
        role="the X-ray lead technologist",
        persona="Brisk and practical. Talks in images waiting and minutes to clear.",
        pushes_for="imaging fractures and chest injuries by severity, so beds can open",
        pushes_back="when a patient with a suspected fracture is moved before their X-ray is done",
        temperature=0.3,
        archetype="Lumen", lens="You see the whole picture: which quick image unblocks the most beds?"),
    DeptConfig(
        "LAB", "Get test results back fast, sickest first.",
        "One result a minute; no result sooner than 8 minutes after the sample.", _lab_view, _lab_stub,
        role="the lab supervisor",
        persona="Precise and calm. Always states how many samples are waiting and the longest wait.",
        pushes_for="running samples for the sickest patients first",
        pushes_back="when patients are sent upstairs before their results are back",
        temperature=0.2,
        archetype="Cipher", lens="You read the signal in the noise: which result, once back, frees a patient to move?"),
    DeptConfig(
        "BLOODBANK", "Never run out of O-negative.",
        "Stock is fixed until the next delivery.", _blood_view, _blood_stub,
        role="the blood bank supervisor",
        persona="Careful and numbers-first. Always states units on hand, especially O-negative.",
        pushes_for="saving O-negative for unknown-type trauma",
        pushes_back="when surgery is planned for bleeding patients without enough matching units",
        temperature=0.2,
        archetype="Void", lens="You find what is missing: what will we run out of first, and who would be hurt when we do?"),
    DeptConfig(
        "EMS", "Protect incoming ambulance patients; send stable patients elsewhere when full.",
        "Diversion and transfers to partner hospitals need human approval.", _ems_view, _ems_stub,
        role="the EMS liaison",
        persona="Calm radio-operator voice. Talks about ETAs, ambulances and partner hospitals.",
        pushes_for="keeping ambulances moving; using partner hospitals before the ER overflows",
        pushes_back="when diversion is suggested while critical patients are still inbound",
        temperature=0.5,
        archetype="Orbit", lens="You think in systems beyond our walls: ambulances on the road, partner hospitals, the whole region."),
]
BY_NAME = {d.name: d for d in DEPARTMENTS}


def _who(d: DeptConfig) -> str:
    return f"""You are {d.archetype}, the {d.name} department agent: {d.role}.
Your thinking style ({d.archetype}): {d.lens}
Personality and voice: {d.persona}
You push for: {d.pushes_for}. You push back {d.pushes_back}.
Your goal: {d.goal}
Hard limits you must respect: {d.limits}
Speak in your own voice, in first person ("we"), like a real colleague on a hospital radio call.
Use everyday words a non-medical listener understands (no jargon like "decant", "census", "acuity" or "step-down";
call the STEPDOWN unit "the close-watch beds"),
and short sentences."""


def status_prompt(d: DeptConfig, view: dict, mem: str = "") -> str:
    # The record is written by code from moves that actually happened, so the agent may rely on it.
    remembered = f"""
What happened in the last few rounds, on the record (written by the hospital's own system, not by you):
{mem}
If something you offered has happened, say so in a few plain words. If it has not, say what is still
outstanding. Do not offer a patient again once they have moved.
""" if mem else ""
    return f"""{_who(d)}
You are in a hospital command center during a surge.
You only see your own department. Here is its current state (JSON):
{json.dumps(view)}
{remembered}
Report your status in the required form:
- line: one short plain-English sentence for the command board (no medical advice).
- free_now: beds you can take right now.
- can_free: patients you could move out to free space (use only patient ids from the state above).
- needs and blockers: short phrases.
Only use patient ids that appear in the state above. Never invent patients.
Report only what the state above or the record above shows: never claim something was approved, requested
or done unless it appears in one of them."""


def answer_prompt(d: DeptConfig, view: dict, question: str, asker: str = "The coordinator") -> str:
    return f"""{_who(d)}
Your current state (JSON): {json.dumps(view)}
{asker} asks you: "{question}"
Answer in one or two plain sentences. List any patients you could move out (ids from your state only).
If freeing space depends on ANOTHER department accepting your patients or helping you, set ask_unit to that
department (ER, ICU, STEPDOWN, OR, STAFFING, IMAGING, XRAY, LAB, BLOODBANK, EMS) and ask_text to one short question to it.
Otherwise leave ask_unit empty. Report only what your state shows."""


class DepartmentAgent:
    def __init__(self, cfg: DeptConfig, llm: LLM) -> None:
        self.cfg = cfg
        self.llm = llm
        self.last: DeptStatus | None = None

    async def status(self, h: Hospital, mem: str = "") -> tuple[DeptStatus, str]:
        view = self.cfg.view(h)
        stub = lambda: self.cfg.stub(h)  # noqa: E731
        out, how = await self.llm.call(f"dept:{self.cfg.name}", "lite", status_prompt(self.cfg, view, mem),
                                       DeptStatus, stub, DEPT_TIMEOUT, temperature=self.cfg.temperature)
        if how == "fallback" and self.last is not None:
            return self.last, "stale"
        self.last = out
        return out, how

    async def answer(self, h: Hospital, question: str, asker: str = "COORDINATOR") -> tuple[DeptAnswer, str]:
        view = self.cfg.view(h)
        stub = lambda: _answer_stub(self.cfg.name, h, asker)  # noqa: E731
        who = "The coordinator" if asker == "COORDINATOR" else f"The {asker} department"
        out, how = await self.llm.call(f"answer:{self.cfg.name}", "lite",
                                       answer_prompt(self.cfg, view, question, who), DeptAnswer, stub, DEPT_TIMEOUT,
                                       temperature=self.cfg.temperature)
        if out.ask_unit in (self.cfg.name, asker):
            out.ask_unit = None  # no asking yourself, no ping-pong
        return out, how

    async def ack(self, h: Hospital, orders: list[str]) -> tuple[DeptAck, str]:
        view = self.cfg.view(h)
        stub = lambda: _ack_stub(self.cfg.name, h, orders)  # noqa: E731
        prompt = f"""{_who(self.cfg)}
Your current state (JSON): {json.dumps(view)}
The coordinator's plan gives your department these moves:
{json.dumps(orders)}
Confirm in one short sentence in your own voice (ok=true), or if something in your state makes a move hard,
or it goes against what you push for, say so plainly (ok=false).
Code will re-check every move anyway. Report only what your state shows."""
        return await self.llm.call(f"ack:{self.cfg.name}", "lite", prompt, DeptAck, stub, DEPT_TIMEOUT,
                                   temperature=self.cfg.temperature)


def _answer_stub(name: str, h: Hospital, asker: str) -> DeptAnswer:
    base = BY_NAME[name].stub(h)
    if asker != "COORDINATOR":
        free = base.free_now
        return DeptAnswer(answer=(f"Yes, we have {free} bed(s) free now" if free else
                                  "We're full, but we can move stable patients on to make room"),
                          can_free=base.can_free)
    ask_unit, ask_text = None, ""
    outward = [o for o in base.can_free if OWNER.get(o.to_unit) not in (name, None)]
    if outward:
        ask_unit = OWNER[outward[0].to_unit]
        pids = ", ".join(o.pid for o in outward[:3])
        ask_text = f"Can you take {pids} from {name}? They're {outward[0].why}."
    return DeptAnswer(answer=base.line, can_free=base.can_free, ask_unit=ask_unit, ask_text=ask_text)


def _ack_stub(name: str, h: Hospital, orders: list[str]) -> DeptAck:
    moves = [o for o in orders if not o.startswith("request approval")]
    asks = len(orders) - len(moves)
    if not moves:
        return DeptAck(ok=True, text="Ready to act as soon as the incident commander approves.")
    free = BY_NAME[name].stub(h).free_now
    return DeptAck(ok=True, text=f"Got it: {len(moves)} move(s). {free} bed(s) free here right now"
                                 + (", plus a request waiting for approval." if asks else "."))
