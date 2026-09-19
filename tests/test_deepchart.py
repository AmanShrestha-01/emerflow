import json

import pytest
from fastapi.testclient import TestClient

from backend.deepchart import match
from backend.deepchart.access import Session
from backend.deepchart.chart import merged
from backend.deepchart.portal import Forbidden, NotFound
from backend.deepchart.records import HOME, HOSP_B, HOSP_C, Identity
from backend.engine import Engine
from backend.main import app, engine as app_engine
from backend.sim.scenarios import build_hospital

DOC = Session("t", HOME, "doctor")
DOC_B = Session("tb", HOSP_B, "doctor")


@pytest.fixture
def eng():
    return Engine()


def _planted(eng, fact="anticoagulant"):
    return next(k["pid"] for k in eng.key if k.get("fact") == fact)


def _id(**kw):
    base = dict(name="Lena Cho", dob="1972-03-02", sex="F", phone4="4471", insurance_id="INS-1", address="1 Light St")
    base.update(kw)
    return Identity(**base)


# ---------- the board is untouched ----------
def test_board_scenario_output_is_unchanged(eng):
    h, key = build_hospital(7)
    assert [s.source_name for s in h.patients["IN-01"].sources] == ["Local intake", "Fells Point Heart - Cardiology"]
    assert [s.source_name for s in eng.h.patients["IN-01"].sources] == ["Local intake", "Fells Point Heart - Cardiology"]
    assert key == eng.key[:len(key)]


# ---------- matching ----------
def test_strong_needs_one_extra_identifier():
    assert match.tier(_id(), _id(insurance_id="X", address="Y")) == "strong"


def test_same_name_dob_sex_but_nothing_else_is_only_possible():
    assert match.tier(_id(), _id(phone4="0000", insurance_id="X", address="Y")) == "possible"


def test_name_only_is_not_shown():
    assert match.tier(_id(), _id(dob="1980-01-01")) is None


def test_normalizes_case_space_accents():
    assert match.tier(_id(name="  léna CHO "), _id()) == "strong"


# ---------- lookup, lookalikes, linking ----------
def test_lookup_needs_a_reason(eng):
    with pytest.raises(Forbidden):
        eng.portal.lookup(DOC, None, pid=_planted(eng))


def test_planted_patient_has_a_lookalike_shown_as_possible(eng):
    pid = _planted(eng)
    cands = eng.portal.lookup(DOC, "er", pid=pid)["candidates"]
    b = [c for c in cands if c["hospital"] == HOSP_B]
    c = [c for c in cands if c["hospital"] == HOSP_C and c["match"] == "possible"]
    assert b and b[0]["match"] == "strong" and b[0]["linked"]
    assert c and not c[0]["linked"] and set(c[0]["differs"]) == {"phone4", "insurance_id", "address"}


def test_nothing_links_without_a_human(eng):
    pid = _planted(eng)
    before = len(eng.h.patients[pid].sources)
    eng.portal.lookup(DOC, "er", pid=pid)
    assert len(eng.h.patients[pid].sources) == before


def test_confirming_a_lookalike_links_it_and_rejecting_hides_it(eng):
    pid = _planted(eng)
    look = next(c for c in eng.portal.lookup(DOC, "er", pid=pid)["candidates"] if c["match"] == "possible")
    eng.portal.confirm(DOC, pid, look["record_ref"], True, "er")
    assert len(eng.h.patients[pid].sources) == 3
    eng.portal.confirm(DOC, pid, look["record_ref"], False, "er")
    assert len(eng.h.patients[pid].sources) == 2
    refs = [c["record_ref"] for c in eng.portal.lookup(DOC, "er", pid=pid)["candidates"]]
    assert look["record_ref"] not in refs


def test_other_hospital_cannot_open_home_patients(eng):
    with pytest.raises(Forbidden):
        eng.portal.chart(DOC_B, _planted(eng), "er")


# ---------- merged chart ----------
def test_merged_groups_conflict_first_and_keeps_provenance(eng):
    pid = _planted(eng)
    facts = merged(eng.h.patients[pid])
    assert facts[0]["fact"] == "anticoagulant" and facts[0]["kind"] == "conflict"
    assert all(v["resource_id"] and v["source_name"] for f in facts for v in f["versions"])


def test_gap_is_never_a_conflict(eng):
    p = next(p for p in eng.h.patients.values()
             if len(p.sources) == 2 and set(p.sources[0].claims) - set(p.sources[1].claims)
             and p.pid not in {k["pid"] for k in eng.key})
    kinds = {f["fact"]: f["kind"] for f in merged(p)}
    for fact in set(p.sources[0].claims) - set(p.sources[1].claims):
        assert kinds[fact] == "gap"


def test_chart_never_names_a_winner(eng):
    text = json.dumps(eng.portal.chart(DOC, _planted(eng), "er")).lower()
    for word in ("correct", "recommend", "should", "do not"):
        assert word not in text


# ---------- orders ----------
def test_order_on_conflicting_fact_warns_and_needs_a_reason(eng):
    pid = _planted(eng)
    o = eng.portal.order(DOC, pid, "start heparin drip", ["anticoagulant"])
    assert o["status"] == "needs_ack" and o["warnings"][0]["fact"] == "anticoagulant"
    with pytest.raises(ValueError):
        eng.portal.ack(DOC, o["order_id"], "  ")
    assert eng.portal.ack(DOC, o["order_id"], "called Fells Point Heart Institute")["status"] == "saved"
    assert "anticoagulant" in eng.h.patients[pid].verified
    assert eng.portal.order(DOC, pid, "again", ["anticoagulant"])["warnings"] == []


def test_order_on_agreeing_fact_is_saved(eng):
    pid = _planted(eng)
    assert eng.portal.order(DOC, pid, "type and screen", ["blood_type"])["status"] == "saved"


def test_order_rejects_unknown_facts(eng):
    with pytest.raises(ValueError):
        eng.portal.order(DOC, _planted(eng), "x", ["made_up"])


# ---------- transfers ----------
def test_transfer_arrives_on_the_board_with_records_and_a_planted_conflict(eng):
    t = eng.portal.transfer(DOC_B, "HB-01", HOME)
    p = eng.h.patients[t["pid"]]
    assert p.state == "incoming" and len(p.sources) == 2
    assert eng.portal.inbox(DOC)[0]["conflicts"] >= 1
    assert {"pid": t["pid"], "fact": "anticoagulant", "kind": "existence"} in eng.key
    with pytest.raises(ValueError):
        eng.portal.transfer(DOC_B, "HB-01", HOME)


def test_only_hospital_b_sends_transfers(eng):
    with pytest.raises(Forbidden):
        eng.portal.transfer(DOC, "HB-01", HOME)


# ---------- demo doctors ----------
def test_doctors_log_in_by_name_and_the_name_is_logged(eng):
    from backend.deepchart.access import DOCTORS, Access
    acc = Access()
    doc = acc.login(HOME, "doctor", "demo", DOCTORS[HOME][1])
    assert doc.name == DOCTORS[HOME][1]
    assert acc.login(HOME, "doctor", "demo").name == DOCTORS[HOME][0]  # no pick: the first doctor
    assert acc.login(HOME, "commander", "demo").name == ""
    with pytest.raises(ValueError):
        acc.login(HOME, "doctor", "demo", DOCTORS[HOSP_B][0])  # not a doctor at this hospital
    pid = _planted(eng)
    eng.portal.chart(doc, pid, "er")
    assert eng.portal.access_log(doc, pid)[-1]["name"] == DOCTORS[HOME][1]
    link = eng.portal.patient_link(doc, pid)
    v = eng.portal.patient_view(link["token"], eng.portal.reg.identity(pid).dob)
    assert v["access_log"][-1]["name"] == DOCTORS[HOME][1]


def test_demo_doctors_never_share_a_name_with_a_patient():
    from backend.deepchart.access import DOCTORS
    from backend.sim.scenarios import FIRST, LAST
    for names in DOCTORS.values():
        for n in names:
            first, last = n.removeprefix("Dr. ").split()
            assert first not in FIRST and last not in LAST


# ---------- a doctor's own record entry ----------
def test_doctor_entry_is_one_more_source_and_never_hides_the_others(eng):
    pid = _planted(eng)
    before = next(f for f in merged(eng.h.patients[pid]) if f["fact"] == "anticoagulant")
    r = eng.portal.add_entry(DOC, pid, "anticoagulant", "warfarin 5mg", "active", "er")
    assert r["source_name"] == f"{HOME} - Doctor's entry"
    after = next(f for f in merged(eng.h.patients[pid]) if f["fact"] == "anticoagulant")
    assert len(after["versions"]) == len(before["versions"]) + 1
    assert after["kind"] == "conflict"  # adding a version never settles a disagreement on its own
    eng.portal.add_entry(DOC, pid, "blood_type", "O+", "present", "er")
    assert len([s for s in eng.h.patients[pid].sources if s.source_id == "doctor"]) == 1  # one entry source
    chart = eng.portal.chart(DOC, pid, "er")
    assert any(s["hospital"] == HOME and s["source_name"].endswith("Doctor's entry") for s in chart["sources"])


def test_doctor_entry_needs_a_reason_and_a_known_fact(eng):
    pid = _planted(eng)
    with pytest.raises(Forbidden):
        eng.portal.add_entry(DOC, pid, "blood_type", "O+", "present", None)
    with pytest.raises(ValueError):
        eng.portal.add_entry(DOC, pid, "shoe_size", "9", "present", "er")
    with pytest.raises(ValueError):
        eng.portal.add_entry(DOC, pid, "blood_type", "  ", "present", "er")
    with pytest.raises(Forbidden):
        eng.portal.add_entry(DOC_B, pid, "blood_type", "O+", "present", "er")
    assert eng.portal.add_entry(DOC, pid, "penicillin_allergy", "", "absent", "er")["ok"]


# ---------- access log and patient link ----------
def test_patient_view_has_log_but_no_clinical_detail(eng):
    pid = _planted(eng)
    eng.portal.chart(DOC, pid, "er")
    eng.portal.chart(DOC, pid, "er")  # same access twice is logged once
    o = eng.portal.order(DOC, pid, "start heparin drip", ["anticoagulant"])
    eng.portal.ack(DOC, o["order_id"], "called Fells Point Heart Institute about warfarin")
    link = eng.portal.patient_link(DOC, pid)
    v = eng.portal.patient_view(link["token"], eng.portal.reg.identity(pid).dob)
    assert set(v) == {"first_name", "status_line", "records", "access_log"}
    assert all(set(r) == {"hospital", "kind", "recorded_date"} for r in v["records"])  # where, never what
    assert v["access_log"][0]["reason"] == "Treating in the ER"
    text = json.dumps(v).lower()
    for word in ("warfarin", "disagree", "conflict", "anticoagulant", "heparin"):
        assert word not in text
    assert [e["action"] for e in v["access_log"]].count("opened the merged chart") == 1
    with pytest.raises(NotFound):
        eng.portal.patient_view("nope", "2000-01-01")


def test_patient_link_needs_date_of_birth_and_locks_after_wrong_tries(eng):
    pid = _planted(eng)
    dob = eng.portal.reg.identity(pid).dob
    token = eng.portal.patient_link(DOC, pid)["token"]
    with pytest.raises(Forbidden):
        eng.portal.patient_view(token, "")  # the link alone shows nothing, not even a first name
    for _ in range(5):
        with pytest.raises(Forbidden):
            eng.portal.patient_view(token, "1900-01-01")
    with pytest.raises(Forbidden):
        eng.portal.patient_view(token, dob)  # locked, even with the right date
    fresh = eng.portal.patient_link(DOC, pid)["token"]
    assert fresh != token
    with pytest.raises(NotFound):
        eng.portal.patient_view(token, dob)  # the locked link is gone
    assert eng.portal.patient_view(fresh, dob)["first_name"]
    assert eng.portal.patient_link(DOC, pid)["token"] == fresh  # a working link is reused


# ---------- scoring ----------
def test_score_catches_every_planted_conflict_and_lookalike(eng):
    s = eng.portal.score()
    assert s["records"]["recall"] == 1.0 and s["records"]["precision"] == 1.0
    assert s["identity"]["lookalikes"] >= 3 and s["identity"]["recall"] == 1.0
    assert s["identity"]["true_shown_possible"] == 0


# ---------- HTTP, following the demo script ----------
def test_http_demo_flow():
    app_engine.reset(7)
    c = TestClient(app)
    assert c.get("/api/portal/patients").status_code == 401
    assert c.post("/api/login", json={"hospital": HOME, "role": "doctor", "pin": "wrong"}).status_code == 403
    hs = c.get("/api/hospitals").json()
    assert all(len(h["doctors"]) == 3 for h in hs)
    who = next(h for h in hs if h["name"] == HOME)["doctors"][2]
    r = c.post("/api/login", json={"hospital": HOME, "role": "doctor", "pin": "demo", "doctor": who}).json()
    assert r["name"] == who
    tok = r["token"]
    assert c.get("/api/me", headers={"X-Session": tok}).json()["name"] == who
    hd = {"X-Session": tok}
    pid = _planted(app_engine)
    assert c.get(f"/api/chart/{pid}", headers=hd).status_code == 403  # no reason for access
    cands = c.get("/api/lookup", params={"pid": pid, "reason": "er"}, headers=hd).json()["candidates"]
    look = next(x for x in cands if x["match"] == "possible")
    assert c.post("/api/lookup/confirm", headers=hd, json={"pid": pid, "record_ref": look["record_ref"],
                                                            "same_person": False, "reason": "er"}).json()["ok"]
    chart = c.get(f"/api/chart/{pid}", params={"reason": "er"}, headers=hd).json()
    assert chart["facts"][0]["kind"] == "conflict" and chart["notice"] == "sources disagree; a human must resolve"
    o = c.post("/api/orders", headers=hd, json={"pid": pid, "text": "start heparin drip",
                                                "because": ["anticoagulant"]}).json()
    assert o["status"] == "needs_ack"
    assert c.post(f"/api/orders/{o['order_id']}/ack", headers=hd, json={"reason": "called"}).json()["status"] == "saved"
    link = c.post("/api/patient-link", headers=hd, json={"pid": pid}).json()
    assert c.get(f"/api/p/{link['token']}").status_code in (404, 405)  # never by GET: the date of birth stays out of URLs
    assert c.post(f"/api/p/{link['token']}", json={"dob": ""}).status_code == 403
    view = c.post(f"/api/p/{link['token']}", json={"dob": app_engine.portal.reg.identity(pid).dob}).json()
    assert len(view["access_log"]) >= 4
    assert c.get("/api/deepchart/score").json()["records"]["recall"] == 1.0


# ---------- resolving the board's hold from the chart ----------
def _held(eng):
    from backend.sim.models import Move
    from backend.sim.pipeline import commit
    p = eng.h.patients["IN-36"]  # planted anticoagulant conflict, seed 7
    assert commit(eng.h, Move(eng.h.next_id("M"), p.pid, p.unit, "HOME", "discharge")) == "held"
    return p.pid, next(iter(eng.h.holds))


def test_doctor_resolves_hold_from_chart_and_it_is_logged(eng):
    pid, hid = _held(eng)
    assert eng.portal.chart(DOC, pid, "er")["hold"]["hold_id"] == hid
    with pytest.raises(Forbidden):
        eng.portal.resolve_hold(DOC, pid, hid, "proceed", None)  # reason for access required
    r = eng.portal.resolve_hold(DOC, pid, hid, "proceed", "er")
    assert r["ok"] and r["detail"] and hid not in eng.h.holds
    assert eng.portal.chart(DOC, pid, "er")["hold"] is None
    log = eng.portal.access_log(DOC, pid)
    assert any("let the move to home go ahead" in e["action"] and e["reason"] == "Treating in the ER" for e in log)
    with pytest.raises(NotFound):
        eng.portal.resolve_hold(DOC, pid, hid, "proceed", "er")


def test_hold_resolve_rejects_wrong_patient(eng):
    pid, hid = _held(eng)
    with pytest.raises(NotFound):
        eng.portal.resolve_hold(DOC, "IN-01", hid, "cancel", "er")


# ---------- one login for the whole app ----------
def test_me_reports_the_session_and_401s_when_stale():
    c = TestClient(app)
    assert c.get("/api/me").status_code == 401
    assert c.get("/api/me", headers={"X-Session": "stale"}).status_code == 401
    tok = c.post("/api/login", json={"hospital": HOME, "role": "commander", "pin": "demo"}).json()["token"]
    assert c.get("/api/me", headers={"X-Session": tok}).json() == {"hospital": HOME, "role": "commander", "name": ""}


def test_commander_only_at_the_board_hospital():
    c = TestClient(app)
    r = c.post("/api/login", json={"hospital": HOSP_B, "role": "commander", "pin": "demo"})
    assert r.status_code == 400
