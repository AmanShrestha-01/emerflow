# Emer Flow · Hospital Swarm

A hospital command board for mass-casualty surges. Eight department AI agents and one coordinator negotiate
where patients go. Code enforces every hard rule, a records check (DeepChart) pauses any move whose facts
disagree across the patient's records, and one human approves the big actions.

**AI talks, code counts, a human approves big moves.**

## Run it (no cloud needed)
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
EMERFLOW_STUB=1 .venv/bin/uvicorn backend.main:app --port 8000 --timeout-graceful-shutdown 5   # backend, stub mode (works offline)
cd frontend && npm install && npm run dev                           # board at http://localhost:5173
```
Press **MASS CASUALTY**. `?mock=1` runs the board with a fake event stream and no backend.

Tests: `EMERFLOW_STUB=1 .venv/bin/pytest`

## Live Gemini (Vertex AI)
```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=<your-project> GOOGLE_CLOUD_LOCATION=global
export GEMINI_PRO_MODEL=<coordinator model> GEMINI_LITE_MODEL=<department model>   # check names in Model Garden
.venv/bin/uvicorn backend.main:app --port 8000 --timeout-graceful-shutdown 5
```
- **Every agent** (the 8 departments, the coordinator and radio intake) uses `gemini-3.6-flash`. Each department has its own persona, so they argue and negotiate differently.
- **Every call has a timeout.** After 3 failures, a circuit breaker switches to the rule-based answers, so the board never stops.
- **Live answers are recorded** to `backend/agents/replays/live.jsonl`.

## Deploy (Cloud Run)
Run `PROJECT=<your-project> ./deploy.sh`. It deploys one service with a single instance and the CPU always on. The Cloud Run service account needs the **Vertex AI User** role.
- **State lives in memory.** Redeploying resets the hospital, so never redeploy during judging.
- **Reset needs the demo key** (`EMERFLOW_DEMO_KEY`, default `demo`).

## How it works
| Kind | Who | Job |
|---|---|---|
| Department agents (8) | ER, ICU, STEPDOWN, OR, STAFFING, IMAGING, BLOODBANK, EMS | Each sees only its own unit and reports what it can free and what it needs |
| Coordinator (1) | Gemini 3.6 Flash | Reads all 8 reports, asks a question when code detects contention, writes one plan (units, not beds) |
| Rule-keepers (code) | fast lane, validator, DeepChart gate, escalation meter | Place critical patients instantly, reject impossible moves, pause moves whose records disagree, set the level |
| Human | incident commander | Approves big actions and resolves record conflicts |

Escalation levels:

| Level | Name | What it unlocks |
|---|---|---|
| 0 | NORMAL | Ordinary placement |
| 1 | MAKE ROOM | Discharge lounge, step-downs |
| 2 | STRETCH | Hallway beds, recovery room as overflow, cancel electives\*, call in staff\* |
| 3 | DIVERT | Ambulance diversion\*, transfers out\* |
| 4 | CRISIS | Human only |

\* needs human approval

## DeepChart portal
Open **`/doctor`** (PIN `demo`) and log in as **Emer Flow General**, the board hospital:
- The patient list puts held and conflicting patients first.
- Pick a reason for access, then use **Look up other hospitals** to pull the same patient's records from Hospital B
  (cardiology) and Hospital C (primary care). Hospital C also holds lookalikes: same name and birthday, but a different
  person. Those show as **POSSIBLE**, and nothing links without a click.
- The merged chart shows every value with its source and date: conflicts first, then agreements, then gaps.
- An order that relies on a disputed fact gets `VERIFICATION REQUIRED` and needs a written reason. It never blocks and never says which record is right.

Log in as **Hospital B** to transfer one of its patients. They arrive on the board with both records attached.

Each patient can get a private link at **`/p/<token>`**. It shows their status and who viewed their record, never clinical detail.

`GET /api/deepchart/score` checks the results against the answer key. After one 25-patient surge (seed 7) it's 11/11 record
conflicts and 11/11 lookalikes, with no false alarms. That's plain code checking conflicts we planted, so it isn't a claim about real-world records.

Spec: `09-deepchart-portal-spec.md` · Build notes: `10-deepchart-implementation-plan.md` · Routes: `CONTRACT.md` → "DeepChart portal".

## Honest notes
- **All patients are synthetic.** We planted the record conflicts ourselves, and keep an answer key, so what the records check catches can be measured.
- **The software never says which record is right.** Held patients show "sources disagree; a human must resolve".
- **`/api/compare` runs the same seeded surge three ways:** every department for itself, greedy placement plus the escalation rules in code, and the Swarm. In stub mode the Swarm uses the same rules as the second arm, so those two numbers match. Live Gemini runs are what the Swarm arm should be judged on.
