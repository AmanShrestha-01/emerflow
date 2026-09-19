import asyncio
import random

from fastapi.testclient import TestClient

from backend.agents.cycle import Swarm
from backend.agents.llm import LLM
from backend.agents.schemas import Plan, PlanMove, plan_schema
from backend.engine import compare, run_headless
from backend.sim import fastlane
from backend.sim.clock import tick
from backend.sim.scenarios import build_hospital, mass_casualty


def _surged(minutes=12):
    h, key = build_hospital(7)
    mass_casualty(h, key, n=25)
    rng = random.Random(0)
    for _ in range(minutes):
        tick(h, rng, walkins=False)
        fastlane.run(h)
    return h, key


def _events():
    log = []
    return log, lambda t, d, **k: log.append((t, d, k))


def test_cycle_runs_all_eight_departments_then_one_plan():
    h, _ = _surged()
    log, emit = _events()
    asyncio.run(Swarm(LLM(mode="stub", fake_latency=False)).run_cycle(h, emit, "test"))
    statuses = [d["unit"] for t, d, _ in log if t == "agent.status"]
    assert sorted(statuses) == sorted(["ER", "ICU", "STEPDOWN", "OR", "STAFFING", "IMAGING", "BLOODBANK", "EMS"])
    assert [t for t, _, _ in log].count("coordinator.plan") == 1
    assert log[-1][0] == "cycle.end"
    assert all(k.get("cycle_id") for _, _, k in log)


def test_invalid_and_invented_moves_are_dropped_valid_ones_kept(monkeypatch):
    h, _ = _surged()
    waiting = h.waiting()
    good = PlanMove(pid=waiting[-1].pid, to_unit="ER", kind="admit") if waiting else None
    bad = [PlanMove(pid="NOBODY", to_unit="ICU"), PlanMove(pid=next(iter(h.patients)), to_unit="HOME")]
    plan = Plan(summary="test", moves=bad + ([good] if good else []))

    swarm = Swarm(LLM(mode="stub", fake_latency=False))

    async def fake_plan(*_a, **_k):
        return plan, "live"
    monkeypatch.setattr(swarm.coordinator, "plan", fake_plan)
    log, emit = _events()
    asyncio.run(swarm.run_cycle(h, emit, "test"))
    dropped = [d for t, d, _ in log if t == "move.dropped"]
    assert len(dropped) >= 2
    assert any("unknown patient" in d["reason"] for d in dropped)


def test_plan_schema_only_allows_live_patient_ids():
    schema = plan_schema(["MC-01", "MC-02"])
    import pydantic
    try:
        schema.model_validate({"summary": "x", "moves": [{"pid": "FAKE", "to_unit": "ICU"}]})
        raise AssertionError("invented id accepted")
    except pydantic.ValidationError:
        pass


def test_surge_produces_at_least_three_holds_and_little_fallback():
    r = run_headless(7, "swarm")
    assert r["held"] >= 3


def test_compare_reports_three_arms_with_numbers():
    c = compare(seeds=(7,))
    assert [a["arm"] for a in c["arms"]] == ["greedy", "ladder", "swarm"]
    for a in c["arms"]:
        assert a["avg_wait"] >= 0 and a["longest_wait"] >= 0


def test_api_state_surge_patient_and_protected_reset():
    from backend.main import app
    with TestClient(app) as client:
        s = client.get("/api/state").json()
        assert len(s["units"]) == 9 and "metrics" in s and s["level_name"]
        assert client.post("/api/surge", json={"n": 5}).json() == {"incoming": 5}
        pid = s["patients"][0]["pid"]
        d = client.get(f"/api/patient/{pid}").json()
        assert len(d["sources"]) == 2
        assert client.post("/api/control", json={"action": "reset", "key": "wrong"}).status_code == 403
        assert client.post("/api/control", json={"action": "reset", "key": "demo"}).status_code == 200
        r = client.post("/api/radio", json={"text": "bus crash, 6 patients, 2 critical, 10 min out"}).json()
        assert len(r["patients"]) == 6
        assert client.post(f"/api/radio/{r['draft_id']}/confirm").json()["incoming"] == 6


def test_circuit_breaker_recovers_after_cooldown(monkeypatch):
    from backend.agents import llm as L
    x = LLM(mode="live", fake_latency=False)
    x.failures, x.opened_at = L.BREAKER_AFTER, 1000.0
    monkeypatch.setattr(L.time, "monotonic", lambda: 1000.0 + L.BREAKER_COOLDOWN - 1)
    assert x.breaker_open
    monkeypatch.setattr(L.time, "monotonic", lambda: 1000.0 + L.BREAKER_COOLDOWN + 1)
    assert not x.breaker_open  # half-open: Gemini gets another chance
