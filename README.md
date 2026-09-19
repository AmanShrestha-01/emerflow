# Emer Flow · Hospital Swarm

A hospital command board for mass-casualty surges. Eight department AI agents and one coordinator negotiate
where patients go. Code enforces every hard rule, a records check (DeepChart) pauses any move whose facts
disagree across the patient's records, and one human approves the big actions.

**AI talks, code counts, a human approves big moves.**

## Where things live
| Path | What's there |
|---|---|
| `backend/sim/` | The simulated hospital: state, rules, the one move pipeline, escalation, scenarios |
| `backend/agents/` | The department agents, coordinator, Gemini client, recorded replays |
| `backend/deepchart/` | DeepChart portal: records per hospital, identity matching, merged chart, sessions |
| `backend/gate.py`, `engine.py`, `main.py` | The records check, the running loop, and the FastAPI app |
| `frontend/src/hospital/` | The command board screens |
| `web/app/doctor/`, `web/app/p/` | DeepChart in the Next.js site: the doctor portal (`/doctor`) and the patient link (`/p/<token>`) |
| `frontend/src/deepchart/` | The older Vite DeepChart screens (still build; no longer served at `/doctor` or `/p/`) |
| `frontend/agent-workflow/` | Vendored agent-workflow UI package (see its `SOURCE.md`) |
| `tests/` | pytest suite (`EMERFLOW_STUB=1 .venv/bin/pytest`) |
| `tools/` | One-off scripts, such as recording a 20-patient run |
| `docs/` | Pitch, DeepChart spec, demos, screenshots, and the archived "Concord" planning docs (index: `docs/README.md`) |
| `CONTRACT.md` | The backend ↔ frontend API and event shapes |

## Run it (no cloud needed)
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
EMERFLOW_STUB=1 .venv/bin/uvicorn backend.main:app --port 8000 --timeout-graceful-shutdown 5   # backend, stub mode (works offline)
cd web && npm install && npm run dev                                # the site at http://localhost:3100 (proxies /api to :8000)
```
Or build the site once (`cd web && npm run build`) and open http://localhost:8000: FastAPI serves `web/out`. Rebuild after every `web/` change.

Log in at `/login` (PIN `demo`), open the board and press **Bus crash**. `/board?mock=1` runs the board with a fake event stream and no backend.
Add `EMERFLOW_RECORDS_CHECK=1` to the backend command to have DeepChart hold moves whose records disagree.

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

## Logging in
One staff login for the whole app at `/login` (PIN `demo`): pick the hospital, then a role.
- **Hospital** (commander) lands on the command board (`/board`).
- **Doctor** lands in DeepChart (`/doctor`).
- **Patients** never get a staff login. They get a private link (`/p/<token>`) and confirm their date of birth to open it.

`/board?mock=1` skips the login for the offline demo.

## DeepChart portal
DeepChart checks that a patient's records agree. Moves are only held for it when the records check is on:
`EMERFLOW_RECORDS_CHECK=1` (it's off by default).

Log in as a **doctor** at **Johns Hopkins Hospital**, the board hospital, and pick your name (e.g. Dr. Amara Whitfield). The hospitals, doctors and patients are all fictional. Your name goes on everything you do:
- The patient list puts held and conflicting patients first.
- Pick a reason for access, then use **Look up other hospitals** to pull the same patient's records from Fells Point Heart Institute
  (cardiology) and Hampden Family Health (primary care). Hampden also holds lookalikes: same name and birthday, but a different
  person. Those show as **Possible match**, and nothing links without a click.
- The merged chart shows every value with its source and date: conflicts first, then agreements, then gaps.
- **Add to the record** saves the doctor's own finding as one more source ("Johns Hopkins Hospital - Doctor's entry"). It sits next to
  the other versions and never replaces or hides them.
- An order that relies on a disputed fact gets `VERIFICATION REQUIRED` and needs a written reason. It never blocks and never says which record is right.
- A move the board is holding shows on the chart with **Records checked: move** and **Don't move**. On the board, the same hold is a
  card under "Big decisions for you" with **Check records in DeepChart**.

Log in as a doctor at **Fells Point Heart Institute** (e.g. Dr. Samuel Achebe) to transfer one of its patients. They arrive on the board with both records attached.

Each patient can get a private link at **`/p/<token>`**. The patient confirms their date of birth first; five wrong tries lock the link,
and the doctor makes a new one. It shows their status, which hospitals' records are in use (names and dates only), and who opened their
record. It never shows clinical detail.

`GET /api/deepchart/score` checks the results against the answer key. After one 25-patient surge (seed 7) it's 11/11 record
conflicts and 11/11 lookalikes, with no false alarms. That's plain code checking conflicts we planted, so it isn't a claim about real-world records.

Can this be built for real? See `docs/deepchart/legal.md` (research with sources, not legal advice).

Spec: `docs/deepchart/spec.md` · Build notes: `docs/deepchart/build-plan.md` · Routes: `CONTRACT.md` → "DeepChart portal".

## Honest notes
- **All patients are synthetic.** We planted the record conflicts ourselves, and keep an answer key, so what the records check catches can be measured.
- **The software never says which record is right.** Held patients show "sources disagree; a human must resolve".
- **`/api/compare` runs the same seeded surge three ways:** every department for itself, greedy placement plus the escalation rules in code, and the Swarm. In stub mode the Swarm uses the same rules as the second arm, so those two numbers match. Live Gemini runs are what the Swarm arm should be judged on.
