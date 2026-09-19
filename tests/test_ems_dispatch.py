"""EMS dispatcher: the AI ranks hospitals, code enforces the rules."""
import asyncio

from backend.agents.ems_dispatch import DispatchIn, DispatchPlan, GroupPlan, check, dispatch, rule_plan
from backend.agents.llm import LLM

H = [
    {"id": "st", "name": "Shock Trauma", "trauma": "Level I", "status": "busy", "drive_min": 6, "beds_free": 10},
    {"id": "jhh", "name": "Hopkins", "trauma": "Level I", "status": "critical", "drive_min": 9, "beds_free": 0},
    {"id": "mercy", "name": "Mercy", "status": "open", "drive_min": 5, "beds_free": 6},
    {"id": "harbor", "name": "Harbor", "status": "critical", "drive_min": 8, "beds_free": 0},
    {"id": "gbmc", "name": "GBMC", "status": "open", "drive_min": 20, "beds_free": 12},
]
REQ = DispatchIn(casualties=40, urgent=11, delayed=17, minor=12, hospitals=H)


def test_rule_plan_sends_urgent_only_to_trauma_centers():
    p = rule_plan(REQ)
    assert set(p.urgent.hospitals) <= {"st", "jhh"}
    assert "harbor" not in p.delayed.hospitals + p.minor.hospitals  # full while others are open


def test_check_drops_bad_ai_picks():
    bad = DispatchPlan(
        urgent=GroupPlan(hospitals=["mercy", "nope", "st"], why="x"),
        delayed=GroupPlan(hospitals=["harbor"], why="y"),
        minor=GroupPlan(hospitals=["gbmc", "gbmc"], why="z"),
        briefing="b",
    )
    p = check(bad, REQ)
    assert p.urgent.hospitals == ["st"]  # non-trauma and unknown ids removed
    assert "harbor" not in p.delayed.hospitals and p.delayed.hospitals  # refilled from the rules
    assert p.minor.hospitals == ["gbmc"]


def test_dispatch_works_offline():
    plan, how = asyncio.run(dispatch(LLM(mode="stub", fake_latency=False), REQ))
    assert how == "stub" and plan.urgent.hospitals and plan.briefing
