# DeepChart Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A doctor portal where a doctor at one hospital pulls, or receives by transfer, the same
patient's records from other hospitals. The doctor sees them merged with every value's source
shown, and gets a non-blocking DeepChart warning when an order relies on a fact the records
disagree about.

> **Status (2026-09-19): built.** All tasks are done except the offline `mock.js` routes for the portal (Task 7). `mock.js`
> belongs to the board, so the portal needs the backend. Where the build differs from the plan below:
> - **Source names and scenarios are unchanged.** The board's `Local intake` / `Hospital B - Cardiology` sources stay as they are.
>   The demo hospitals are **Emer Flow General** (the board), **Hospital B** (cardiology, sends transfers), and **Hospital C** (primary care, lookalikes).
>   Identity details live in `backend/deepchart/records.py`, not on `Patient`, so `models.py` and `scenarios.py` are untouched.
> - **Modules:** `backend/deepchart/{records,match,chart,access,portal}.py`, with no `backend/sim/records.py`.
> - **The board routes stay open.** There's no `EMERFLOW_AUTH` flag. Sessions guard only the portal routes.
> - **Extra routes:** `/api/portal/patients`, `/api/patient-link`, and `/api/deepchart/score`. There's also an event `record.unlinked`.
> - **The patient log** uses a separate patient-safe `public` text for each entry.

**Spec:** `docs/deepchart/spec.md`. **Contract:** `CONTRACT.md`, section "DeepChart portal".

**Architecture:** Nothing new at the core. The portal feeds more `SourceRecord`s into
`Patient.sources` and calls the existing `gate.check` from new places:
- **Records:** each demo hospital holds its own records. Looking a patient up or receiving a
  transfer links another hospital's record onto the patient as one more source.
- **Access:** sessions, the access log, and patient tokens live in memory, in one small module.
- **Frontend:** one React app with three routes, `/board`, `/doctor`, and `/p/:token`.

**Tech stack:** unchanged (FastAPI, pytest, React + Vite). No database. No auth library.

## Global Constraints

- **The code is the authority on vocabulary.** Facts are exactly `backend/sim/models.py:FACTS`
  (`anticoagulant`, `penicillin_allergy`, `vitals_stable`, `icu_need`, `on_pressors`, `blood_type`).
  Claim status is `present | active | stopped | absent`. `docs/archive/concord/implementation-plan.md` has an older
  list of facts, so don't copy from it.
- **Safety copy:** `VERIFICATION REQUIRED` and `sources disagree; a human must resolve`, exactly. No response may
  say which version is correct or tell a doctor to do or not do something.
- **Reuse the gate; don't fork it.** Conflicts come only from `backend/gate.py` (`check`, `_disagree`).
  A fact in `Patient.verified` is already human-checked, and the gate skips it. Keep that behavior.
- **Nothing merges without a human.** Identity links are created only by `POST /api/lookup/confirm`
  or by a transfer.
- **Board behavior must not change.** Every existing test in `tests/` keeps passing after every task.
- **Stub mode:** everything here is deterministic code with no Gemini calls, so `EMERFLOW_STUB=1` covers it.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/sim/models.py` (edit) | Add `dob`, `sex`, `phone4`, `home_hospital` to `Patient`. Add `hospital` to `SourceRecord` |
| `backend/sim/records.py` (new) | `RecordStore`: each hospital's records by patient identity. `link(patient, record)` |
| `backend/sim/scenarios.py` (edit) | `give_records` writes into stores for Hospitals A, B, and C. Plant one lookalike patient per scenario |
| `backend/deepchart/__init__.py` (new) | Package |
| `backend/deepchart/match.py` (new) | `find(stores, name, dob, sex, extra)` returns candidates tagged `strong` or `possible` |
| `backend/deepchart/chart.py` (new) | `merged(patient)` returns facts grouped as conflict, agree, or gap. `check_order(patient, because)` |
| `backend/deepchart/access.py` (new) | Sessions, roles, access log, patient tokens |
| `backend/engine.py` (edit) | Owns stores, orders, and access. Emits the new events |
| `backend/main.py` (edit) | New routes (see `CONTRACT.md`) |
| `frontend/src/App.jsx` (replace) | Router: `/board`, `/doctor`, `/p/:token`, and login |
| `frontend/src/hospital/ApprovalDrawer.jsx`, `PatientDetail.jsx` (new) | Missing today. `Board.jsx` imports them |
| `frontend/src/deepchart/*.jsx` (new) | `Login`, `Search`, `MatchReview`, `Chart`, `OrderBox`, `Inbox`, `PatientLink` |
| `frontend/src/api.js` (edit) | New helpers. Send the `X-Session` header |
| `tests/test_deepchart.py` (new) | Tasks 1 through 6 |

---

## Task 0: Get the board running again (prerequisite)

**Why:** `frontend/src/App.jsx` is still the Vite template, and `Board.jsx` imports two files that don't exist.

- [ ] Replace `App.jsx` so it renders `<Board />`. Keep `?mock=1` working.
- [ ] Create `ApprovalDrawer.jsx` (lists `state.approvals` with approve and deny buttons) and `PatientDetail.jsx`
      (renders `GET /api/patient/{pid}`: sources, conflicts, and the resolve buttons).
- [ ] `npm run build` passes, and the board loads at `:5173` with **MASS CASUALTY** working.
- [ ] Commit.

## Task 1: Hospitals hold their own records

**Files:** `models.py`, `records.py`, `scenarios.py`, `tests/test_deepchart.py`

**Interfaces:**
- `RecordStore.records(hospital) -> list[HeldRecord]`, where `HeldRecord` = identity (`name`, `dob`, `sex`, `phone4`, `insurance_id`) plus a `SourceRecord`
- `link(p: Patient, rec: SourceRecord) -> None` appends to `p.sources`, and does nothing if the record is already linked

- [ ] **Test first**
```python
def test_outside_records_are_not_on_the_patient_until_linked():
    h, key, stores = build_scenario(seed=7)
    p = h.patients["MC-03"]
    assert [s.source_name for s in p.sources] == ["Hospital B intake"]
    rec = stores.find_exact("Hospital A", p)          # test helper
    link(p, rec)
    assert len(p.sources) == 2 and link(p, rec) is None and len(p.sources) == 2
```
- [ ] Build it. Rename the local source to `Hospital B intake`, and rename the outside source to
      `Hospital A - Cardiology`, keeping the same claims and dates as `give_records` produces today.
      **Board mode keeps linking A automatically** so the surge demo and `/api/compare` are
      unchanged. Only doctor-portal patients start unlinked.
- [ ] Plant one **lookalike** in Hospital C per scenario: same name, date of birth, and sex as a
      surge patient, but a different phone, insurance ID, address, and claims. Add it to the answer key as
      `{"pid", "kind": "identity", "hospital": "Hospital C"}`.
- [ ] Run the full `pytest`, including every existing test. Commit.

## Task 2: Identity matching

**Files:** `backend/deepchart/match.py`, tests

- [ ] **Test first**
```python
def test_strong_needs_one_extra_identifier():
    assert tier(q(name="Lena Cho", dob="1972-03-02", sex="F", phone4="4471"), held_A) == "strong"
def test_lookalike_is_only_possible():
    assert tier(q(name="Lena Cho", dob="1972-03-02", sex="F", phone4="4471"), held_C) == "possible"
def test_name_only_is_not_shown():
    assert find(stores, name="Lena Cho", dob="1980-01-01", sex="F") == []
def test_normalizes_case_space_accents():
    assert tier(q(name="  léna CHO ", ...), held_A) == "strong"
```
- [ ] Build it, following the rules in spec §6. Each candidate carries `differs: [field]`.
- [ ] Commit.

## Task 3: Merged chart

**Files:** `backend/deepchart/chart.py`, tests

- [ ] **Test first**
```python
def test_merged_groups_conflict_agree_gap():
    m = merged(p_with_planted_anticoagulant_and_missing_blood_type)
    assert m["anticoagulant"]["kind"] == "conflict"
    assert m["blood_type"]["kind"] == "gap"
    assert all(v["resource_id"] for f in m.values() for v in f["versions"])
def test_merged_never_names_a_winner():
    assert "correct" not in json.dumps(merged(p)).lower()
```
- [ ] Build `merged(p)` over all `FACTS`. For each fact, a conflict is exactly what `gate._disagree` returns for some
      pair. A gap means at least one source has no claim. Every version carries `source_name`,
      `recorded_date`, `value`, `status`, and `resource_id`.
- [ ] Commit.

## Task 4: Orders and warnings

**Files:** `chart.py` (`check_order`), `engine.py`, tests

- [ ] **Test first**
```python
def test_order_on_conflicting_fact_warns_but_does_not_block():
    o = engine.order(pid, text="start heparin drip", because=["anticoagulant"], session=doc_b)
    assert o["warnings"] and o["status"] == "needs_ack"
def test_ack_requires_reason_and_saves():
    with pytest.raises(ValueError): engine.ack(o["order_id"], reason="", session=doc_b)
    assert engine.ack(o["order_id"], reason="called Hospital A", session=doc_b)["status"] == "saved"
def test_order_on_verified_fact_is_clear():
    p.verified.add("anticoagulant"); assert engine.order(...)["warnings"] == []
```
- [ ] `check_order` = `gate.check(p, because, p.unit or "ER").conflicts`, ignoring `blocking`.
- [ ] Emit `order.warning` and `order.acknowledged`. The acknowledgement adds the fact to `p.verified`,
      the same way `resolve_hold("proceed")` does.
- [ ] Commit.

## Task 5: Sessions, roles, access log, patient tokens

**Files:** `backend/deepchart/access.py`, tests

- [ ] **Test first**
```python
def test_wrong_pin_rejected():            ...
def test_doctor_cannot_open_chart_without_reason(): ...
def test_every_lookup_and_open_is_logged(): ...
def test_doctor_at_A_cannot_see_B_only_patients(): ...
def test_patient_token_view_has_no_conflicts_or_values():
    v = access.patient_view(token)
    assert set(v) == {"first_name", "status_line", "access_log"}
```
- [ ] The PIN comes from `EMERFLOW_DEMO_KEY` (default `demo`, as for reset). Tokens are `secrets.token_urlsafe(8)`.
- [ ] Roles: `commander` has the existing board routes. `doctor` has the portal routes plus `holds/resolve`.
- [ ] **Keep the existing board routes open when `EMERFLOW_AUTH=0`**, the default for the first pass, so
      `?mock=1` and the current demo never break.
- [ ] Commit.

## Task 6: API routes

**Files:** `backend/main.py`, `tests/test_deepchart.py` (with FastAPI `TestClient`)

- [ ] Add each route from `CONTRACT.md` → "DeepChart portal". Use `404` for an unknown pid or order, `403` for the wrong role or a missing
      reason, and `400` for a bad body.
- [ ] An end-to-end test follows the demo script: log in as Dr. B, look up MC-03, confirm A, reject C, get the chart
      (one conflict), order, see the warning, acknowledge, resolve the hold with "proceed", and check that the patient link shows 3 log rows.
- [ ] Commit.

## Task 7: Frontend

**Files:** `App.jsx`, `frontend/src/deepchart/*`, `api.js`

- [ ] A small hand-rolled router (`location.pathname` + `popstate`), with no new dependency.
- [ ] Doctor screens follow spec §4, including the ASCII layouts. Conflicts use amber and the exact safety copy.
      Clicking a value shows its `resource_id`.
- [ ] `/doctor` listens to `/api/events` for `hold.resolved`, `transfer.received`, and `move.held`, so the board and portal stay in sync.
- [ ] Add portal routes to `mock.js` so `?mock=1` demos the portal offline.
- [ ] Commit.

## Task 8: Scoring (never cut)

- [ ] Extend the score to count **identity conflicts**: a lookalike shown as `possible` counts as caught,
      and a lookalike shown as `strong` or merged without a click counts as missed.
- [ ] Report precision and recall for record conflicts and identity conflicts separately. Put the numbers in the README.
- [ ] Commit.

---

## Two-person split

| Person | Tasks |
|---|---|
| Backend | 1 → 2 → 3 → 4 → 5 → 6 → 8 |
| Frontend | 0 → 7 (build against `mock.js` until Task 6 lands) |

Agree on the `CONTRACT.md` portal section **before** starting. It's the only shape you both depend on.

## Cut order (if time runs out, cut from the top)

1. Patient link `/p/:token` (the access log still exists and shows on the doctor screen)
2. Push transfer and the inbox (the pull lookup alone tells the story)
3. PIN login (keep a role and hospital picker with no PIN)
4. Order warnings (fall back to resolving board holds from the doctor screen)

**Never cut:** the merged chart with every source shown, the lookalike identity check, and scoring (Task 8).
