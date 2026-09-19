# EmerFlow

HopHacks 2026 (Johns Hopkins, Sept 18–20), team of 2. EmerFlow has these interfaces:
- **Hospital Swarm**: the staff command board. Eight department AI agents and a coordinator decide where patients go during a surge.
- **EMS map** (the homepage): how full every Baltimore ER is, nearest/fastest care, an ER report and a what-if mass-casualty simulator.
- **DeepChart**: a separate doctor portal for checking that a patient's records agree. It is **not** part of the Swarm's moves (the records check is off by default).

Build plan: `~/.claude/plans/alright-we-are-trying-stateful-scroll.md`. The API and event shapes are in `CONTRACT.md`.
Docs live in `docs/` (index: `docs/README.md`). `docs/archive/concord/` holds the planning docs for an earlier design ("Concord"); they're background only.

## Commands
```bash
EMERFLOW_STUB=1 .venv/bin/pytest                                   # tests (always force stub mode)
EMERFLOW_STUB=1 .venv/bin/uvicorn backend.main:app --port 8000 --timeout-graceful-shutdown 5     # backend, offline
cd web && npm run dev                                              # the site (Next.js) at :3100, proxies /api to :8000
cd web && npm run build                                            # static export to web/out; FastAPI serves it at :8000/ (rebuild after every web/ change)
cd web && node --test lib/emer/hospitals.test.mjs                  # EMS distance/ranking tests
cd frontend && npm run build                                       # classic app (DeepChart /doctor, patient links /p/<token>)
# add ?mock=1 to any board URL to run with no backend (in-browser practice data)
PROJECT=hop-hacks-509103 ./deploy.sh                               # Cloud Run
```
Settings come from `.env` (git-ignored; template in `.env.example`), loaded in `backend/__init__.py`. Real environment variables override `.env`.
- **Google Cloud project:** `hop-hacks-509103`. Gemini runs through Vertex AI with application default credentials; there are no API keys.
- **Live mode needs** `EMERFLOW_STUB=0` plus `gcloud auth application-default login` and the Vertex AI API enabled.
- **Records check** (DeepChart gate on every move) is off unless `EMERFLOW_RECORDS_CHECK=1`. Tests turn it on in `tests/conftest.py`.
- **Staff login** (one for the whole app): hospital → role → PIN `demo`. Commanders land on the board, doctors in DeepChart. Sessions are in memory, so a server restart logs everyone out.

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
  Speed is sim-minutes per real second: `SPEEDS = (0.25, 0.5, 1, 2, 5)`, default 0.5.
- `backend/main.py`: FastAPI (REST plus SSE at `/api/events`). Serves `web/out` first (its pages), then falls back to `frontend/dist` (DeepChart `/doctor`, `/p/<token>`). GET and HEAD.
- When the AI plan asks for no big action, the rules (`ladder.rule_plan(escalate=True)`) may still suggest one; it still needs a person's approval.

**Frontend: `web/`** (Next.js 16 app router, TypeScript, Tailwind v4, shadcn in `components/ui`). Pages:
- `/`: the EMS map (`app/ems/page.tsx`, also at `/ems`). Built on Robert's capacity-map UI vendored in `components/capacity/` (map, simulator, hooks, recorded Baltimore fixtures). The nearest/fastest list and the ER report are ours. `lib/emer/capacity.ts` overlays our live ER onto Johns Hopkins; every other hospital is simulated. Robert's live server is used only if `NEXT_PUBLIC_SWARM_URL` is set.
- `/board`: command board (needs login). KPI cards, bed wall (occupied / empty / getting ready / just arrived), big decisions, live AI chat, speed control, Bus crash / Busy night, and the 5-step **guided demo** (`/board?demo=1`, `components/emer/board/demo-story.tsx`).
- `/workflow`: the AI round on a 3D stage, live. `/overview`: the swarm landing page (hero, 3D agent sphere, meet the agents). `/login`.
- Data: `lib/emer/useEvents.js` + `api.js` + `mock.js` (copied from `frontend/src`), shared through `lib/emer/hospital.tsx` (`useHospital()`).
- Style: vanilla background (`#fbf6ea`), Inter only, solid dark cards (`.card-dark`) and plain white cards (`.glass`), no gradients or glow. Brand is written **EmerFlow**. Header: `components/ui/header.tsx`, rendered by `Nav`.
- Read `web/AGENTS.md`: Next 16 differs from older versions; check `web/node_modules/next/dist/docs/`.

**Classic frontend: `frontend/`** (React + Vite): the older board, the DeepChart doctor portal and the patient phone view. `src/useEvents.js` reduces SSE events into state; `src/mock.js` fakes the event stream.

**Who owns what** (several Claude sessions work here): DeepChart owns `backend/deepchart/*`, `frontend/src/deepchart/*`, `frontend/src/auth/*`. The EMS session owns `web/components/ems/*` and `web/lib/emer/hospitals.ts`. Tell the owner before editing their files.

## Rules that must not break
- **LLMs never do bed arithmetic** and never pick bed numbers. The coordinator picks units; code validates everything.
- **Every move goes through `pipeline.commit()`.** `because` is owned by code: extras can be added, never removed.
- **The software never says which record is correct.** Held patients show `VERIFICATION REQUIRED` / `sources disagree; a human must resolve`. No clinical instructions, anywhere.
- **Life-saving destinations (`RESUS`, `HALLWAY`) are flagged, not blocked,** by a records conflict. Severity 1 is never left unplaced.
- **Big actions need human approval:** cancelling electives, calling in staff, ambulance diversion, transfers out.
- **Every LLM call must have a rule-based fallback,** so the demo runs with the wifi off.
- **EMS suggestions are suggestions only:** the crew decides. Never suggest a hospital on diversion, or a full ER while an open one exists. Label live vs simulated numbers.
- **Don't claim the Swarm beats the rules without live runs.** In stub mode the Swarm and the ladder arm are the same logic.
- **All data is synthetic.** Conflicts are planted by us and written to an answer key.
- **Don't commit** unless asked. Hackathon rule: the first commit must be after kickoff (kickoff has happened).
