# Emer Flow

HopHacks 2026 (Johns Hopkins, Sept 18–20), team of 2. Emer Flow has two interfaces:
- **Hospital Swarm** (being built now): the staff command board. Department AI agents and a coordinator decide where patients go during a surge.
- **DeepChart** (next): checks that a patient's records agree before a move. A patient phone view comes later.

Build plan: `~/.claude/plans/alright-we-are-trying-stateful-scroll.md`. The API and event shapes are in `CONTRACT.md`.
The numbered `0x-*.md` files and `08-visual-explainer.html` are the planning docs for an earlier design ("Concord"). They're background only.

## Commands
```bash
EMERFLOW_STUB=1 .venv/bin/pytest                                   # tests (always force stub mode)
EMERFLOW_STUB=1 .venv/bin/uvicorn backend.main:app --port 8000 --timeout-graceful-shutdown 5     # backend, offline
cd frontend && npm run dev                                         # board at :5173 (proxies /api to :8000)
# open http://localhost:5173/?mock=1 for the board with no backend
PROJECT=hop-hacks-509103 ./deploy.sh                               # Cloud Run
```
Settings come from `.env` (git-ignored; template in `.env.example`), loaded in `backend/__init__.py`. Real environment variables override `.env`.
- **Google Cloud project:** `hop-hacks-509103`. Gemini runs through Vertex AI with application default credentials; there are no API keys.
- **Live mode needs** `EMERFLOW_STUB=0` plus `gcloud auth application-default login` and the Vertex AI API enabled.

## Architecture: "AI talks, code counts, a human approves big moves"
**Simulation** (`backend/sim/`):
- `hospital.py`: the blackboard. All state lives here.
- `rules.py`: the validator, and `REQUIRED_FACTS` (the `because` lists).
- `pipeline.commit()`: the ONLY path a move takes: rules check → DeepChart gate → hold or apply.
- `fastlane.py`: places obvious cases instantly.
- `ladder.py`: the rule-based planner. It serves as the coordinator's fallback and as the baseline arm.
- `escalation.py`: levels 0–4, with hysteresis.
- `approvals.py`: the big actions that need a human.
- `clock.py`: one simulated minute.
- `scenarios.py`: the seeded hospital, the mass-casualty surge, planted record conflicts and the answer key.

**The records check:** `backend/gate.py` is DeepChart. For now it's a deterministic comparison of the `because` facts across record sources.

**Agents** (`backend/agents/`):
- `departments.py`: 8 department agents. One class, 8 configs (view, goal, limits, rule-based stub).
- `coordinator.py`: one Gemini call per cycle; code writes its contention question.
- **All agents use `gemini-3.6-flash`** (set in `.env`). Each department has its own persona (role, voice, what it pushes for / back on) and temperature in `departments.py`.
- `cycle.py`: status (parallel) → optional question → plan → apply at live state → approvals → fallback.
- `llm.py`: the Vertex client, timeouts, circuit breaker, stub mode, and recording to `replays/live.jsonl`.
- `schemas.py`: the answer form each agent kind must use.

**Engine and API:**
- `backend/engine.py`: the running loop, cycle triggers, radio intake, metrics, and the headless three-arm `compare()`.
- `backend/main.py`: FastAPI (REST plus SSE at `/api/events`). It serves `frontend/dist` when built.

**Frontend:** `frontend/` is React + Vite. `src/useEvents.js` reduces SSE events into state; `src/mock.js` fakes the event stream. The components are in `src/hospital/`.

## Rules that must not break
- **LLMs never do bed arithmetic** and never pick bed numbers. The coordinator picks units; code validates everything.
- **Every move goes through `pipeline.commit()`.** `because` is owned by code: extras can be added, never removed.
- **The software never says which record is correct.** Held patients show `VERIFICATION REQUIRED` / `sources disagree; a human must resolve`. No clinical instructions, anywhere.
- **Life-saving destinations (`RESUS`, `HALLWAY`) are flagged, not blocked,** by a records conflict. Severity 1 is never left unplaced.
- **Big actions need human approval:** cancelling electives, calling in staff, ambulance diversion, transfers out.
- **Every LLM call must have a rule-based fallback,** so the demo runs with the wifi off.
- **Don't claim the Swarm beats the rules without live runs.** In stub mode the Swarm and the ladder arm are the same logic.
- **All data is synthetic.** Conflicts are planted by us and written to an answer key.
- **Don't commit** unless asked. Hackathon rule: the first commit must be after kickoff (kickoff has happened).
