"""The forms each kind of agent must answer in. A reply that doesn't fit its form is rejected."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, create_model

Dest = Literal["RESUS", "ER", "HALLWAY", "ICU", "STEPDOWN", "WARD", "OR", "PACU", "LOUNGE", "HOME", "PARTNER"]
Action = Literal["cancel_elective", "call_in_staff", "divert_ambulances", "transfer_out"]


class Offer(BaseModel):
    pid: str
    to_unit: Dest
    ready_in_min: int = 0
    why: str = ""


class DeptStatus(BaseModel):
    """Department form."""
    line: str = Field(description="one short plain-English status sentence for the board")
    free_now: int = 0
    can_free: list[Offer] = []
    needs: list[str] = []
    blockers: list[str] = []


Dept = Literal["ER", "ICU", "STEPDOWN", "OR", "STAFFING", "IMAGING", "BLOODBANK", "EMS"]


class DeptAnswer(BaseModel):
    answer: str = Field(description="one or two plain sentences answering the question")
    can_free: list[Offer] = []
    ask_unit: Dept | None = Field(None, description="another department you need something from, if any")
    ask_text: str = Field("", description="your short question to that department")


class DeptAck(BaseModel):
    ok: bool = Field(description="true if your department can do its part of the plan")
    text: str = Field(description="one short sentence confirming, or naming your concern")


class PlanEscalation(BaseModel):
    action: Action
    reason: str
    case_ids: list[str] = []
    pids: list[str] = []
    unit: str | None = None
    count: int = 0


class PlanMove(BaseModel):
    pid: str
    to_unit: Dest
    kind: Literal["admit", "transfer", "discharge", "transfer_out"] = "admit"
    reason: str = ""


class Plan(BaseModel):
    """Coordinator form."""
    summary: str = Field(description="one or two sentences explaining the plan to the incident commander")
    moves: list[PlanMove] = []
    escalations: list[PlanEscalation] = []


class RadioPatient(BaseModel):
    complaint: str
    severity: int = Field(ge=1, le=5)
    eta: int = Field(ge=0, le=120, description="minutes until arrival")


class RadioParse(BaseModel):
    patients: list[RadioPatient]


def plan_schema(pids: list[str]) -> type[BaseModel]:
    """Plan form whose patient ids are an enum of live ids, so the model can't invent patients."""
    if not pids:
        return Plan
    Pid = Literal[tuple(pids)]  # type: ignore[valid-type]
    Move = create_model("PlanMove", pid=(Pid, ...), to_unit=(Dest, ...),
                        kind=(Literal["admit", "transfer", "discharge", "transfer_out"], "admit"),
                        reason=(str, ""))
    return create_model("Plan", summary=(str, ...), moves=(list[Move], []),
                        escalations=(list[PlanEscalation], []))
