"""FastAPI app: REST + Server-Sent Events. See CONTRACT.md."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.engine import Engine, compare

engine = Engine()
HEARTBEAT_SECS = 15
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
WEB = Path(__file__).resolve().parent.parent / "web" / "out"  # the Next.js site (static export)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    engine.start()
    yield
    engine.bus.close()


app = FastAPI(title="Emer Flow · Hospital Swarm", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"],
                   allow_headers=["*"])


class SurgeIn(BaseModel):
    kind: str = "bus"  # "bus" (mass casualty) or "busy" (a busy night of everyday patients)
    n: int = 25
    incident: str = ""  # what to call it on the board, e.g. "Orleans St bus crash" (EMS map hands this over)


class RadioIn(BaseModel):
    text: str


class ApproveIn(BaseModel):
    approve: bool


class ResolveIn(BaseModel):
    outcome: str


class ControlIn(BaseModel):
    action: str
    speed: float | None = None
    key: str | None = None


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": engine.llm.mode}


@app.get("/api/state")
def state():
    return engine.state()


@app.get("/api/events")
async def events(request: Request):
    async def stream():
        q = engine.bus.subscribe()
        engine.watch()  # the hospital runs while at least one browser has this open
        try:
            snap = {"id": 0, "type": "snapshot", "clock": engine.h.clock, "cycle_id": None, "round": None,
                    "data": engine.state()}
            yield f"data: {json.dumps(snap)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_SECS)
                    if ev is None:  # server shutting down
                        break
                    yield f"id: {ev['id']}\ndata: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            engine.bus.unsubscribe(q)
            engine.unwatch()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/surge")
async def surge(body: SurgeIn | None = None):
    body = body or SurgeIn()
    if body.kind == "busy":
        return {"busy_until": engine.busy_night()}
    if body.kind != "bus":
        raise HTTPException(400, "kind must be bus or busy")
    incoming = engine.surge(max(1, min(body.n, 60)), body.incident or "")
    engine.kick_cycle(engine.surge_trigger(incoming))  # the agents start talking about them at once
    return {"incoming": incoming}


@app.post("/api/radio")
async def radio(body: RadioIn):
    if not body.text.strip():
        raise HTTPException(400, "empty radio message")
    return await engine.radio(body.text)


@app.post("/api/radio/{draft_id}/confirm")
def radio_confirm(draft_id: str):
    if draft_id not in engine.drafts:
        raise HTTPException(404, "unknown or already confirmed draft")
    return {"incoming": engine.confirm_radio(draft_id)}


@app.post("/api/approvals/{approval_id}")
def approve(approval_id: str, body: ApproveIn):
    try:
        return {"ok": True, "detail": engine.approve(approval_id, body.approve)}
    except KeyError:  # someone else resolved it, or the clock expired it, between the click and here
        raise HTTPException(404, "approval no longer pending")


@app.post("/api/holds/{hold_id}/resolve")
def resolve(hold_id: str, body: ResolveIn):
    if body.outcome not in ("proceed", "cancel"):
        raise HTTPException(400, "outcome must be proceed or cancel")
    try:
        return {"ok": True, "detail": engine.resolve_hold(hold_id, body.outcome)}
    except KeyError:  # the board and DeepChart can both resolve a hold
        raise HTTPException(404, "hold no longer pending")


@app.post("/api/control")
def control(body: ControlIn):
    try:
        engine.control(body.action, body.speed, body.key)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"ok": True}


@app.get("/api/patient/{pid}")
def patient(pid: str):
    if pid not in engine.h.patients:
        raise HTTPException(404, "unknown patient")
    return engine.patient_detail(pid)


@app.get("/api/compare")
def compare_endpoint():
    return compare()


@app.get("/api/results")
def results():
    return engine.results()


@app.get("/api/edas")
async def edas_status():
    """Live ER crowding and ambulance counts for Maryland (MIEMSS EDAS), for the EMS map."""
    from backend import edas
    return await edas.status()


from backend.agents.ems_dispatch import DispatchIn  # noqa: E402


@app.post("/api/ems/dispatch")
async def ems_dispatch(body: DispatchIn):
    """The EMS map's crash simulator: Gemini ranks hospitals per triage group; code checks the picks."""
    from backend.agents import ems_dispatch as d
    if not body.hospitals:
        raise HTTPException(400, "no hospitals")
    plan, how = await d.dispatch(engine.llm, body)
    return {"how": how, **plan.model_dump()}


@app.get("/api/memory")
def agent_memory():
    """What each agent is holding in mind right now: short notes written by code, newest first."""
    from backend.agents import memory as mem
    return mem.as_json(engine.swarm.memory, engine.h)


@app.get("/api/audit")
def audit():
    return engine.audit


@app.get("/api/audit.csv")
def audit_csv():
    import csv
    import io
    buf = io.StringIO()
    cols = ["time", "round", "event", "patient", "from", "to", "decided_by", "relied_on", "records_disagree", "detail"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(engine.audit)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=emerflow-audit.csv"})


# ---------- DeepChart portal (see CONTRACT.md, "DeepChart portal") ----------
from backend.deepchart.access import Session  # noqa: E402
from backend.deepchart.portal import Forbidden, NotFound  # noqa: E402
from backend.deepchart.access import DOCTORS  # noqa: E402
from backend.deepchart.records import HOSPITALS  # noqa: E402


class LoginIn(BaseModel):
    hospital: str
    role: str
    pin: str
    doctor: str | None = None  # one of the hospital's demo doctors (GET /api/hospitals)


class ConfirmIn(BaseModel):
    pid: str
    record_ref: str
    same_person: bool
    reason: str | None = None


class OrderIn(BaseModel):
    pid: str
    text: str
    because: list[str] = []


class AckIn(BaseModel):
    reason: str = ""


class TransferIn(BaseModel):
    pid: str
    to_hospital: str


class LinkIn(BaseModel):
    pid: str


def _session(token: str | None) -> Session:
    s = engine.access.get(token)
    if s is None:
        raise HTTPException(401, "log in first")
    return s


def _portal(fn):
    """Maps portal errors onto HTTP codes."""
    try:
        return fn()
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except (Forbidden, PermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/login")
def login(body: LoginIn):
    s = _portal(lambda: engine.access.login(body.hospital, body.role, body.pin, body.doctor))
    return {"token": s.token, "hospital": s.hospital, "role": s.role, "name": s.name}


@app.get("/api/me")
def me(x_session: str | None = Header(None)):
    """Who is logged in. 401 when the session is missing or stale (e.g. after a server restart)."""
    s = _session(x_session)
    return {"hospital": s.hospital, "role": s.role, "name": s.name}


@app.get("/api/hospitals")
def hospitals():
    return [{"name": n, "doctors": list(DOCTORS[n])} for n in HOSPITALS]


@app.get("/api/portal/patients")
def portal_patients(x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.patients(s))


@app.get("/api/lookup")
def lookup(reason: str | None = None, pid: str | None = None, name: str = "", dob: str = "", sex: str = "",
           phone4: str = "", x_session: str | None = Header(None)):
    s = _session(x_session)
    q = {"name": name, "dob": dob, "sex": sex, "phone4": phone4}
    return _portal(lambda: engine.portal.lookup(s, reason, pid=pid, query=q))


@app.post("/api/lookup/confirm")
def lookup_confirm(body: ConfirmIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.confirm(s, body.pid, body.record_ref, body.same_person, body.reason))


@app.get("/api/chart/{pid}")
def chart(pid: str, reason: str | None = None, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.chart(s, pid, reason))


class HoldResolveIn(BaseModel):
    hold_id: str
    outcome: str
    reason: str | None = None


@app.post("/api/chart/{pid}/resolve")
def chart_resolve(pid: str, body: HoldResolveIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.resolve_hold(s, pid, body.hold_id, body.outcome, body.reason))


class EntryIn(BaseModel):
    fact: str
    value: str = ""
    status: str
    reason: str | None = None


@app.post("/api/chart/{pid}/entries")
def chart_entry(pid: str, body: EntryIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.add_entry(s, pid, body.fact, body.value, body.status, body.reason))


@app.post("/api/orders")
def orders(body: OrderIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.order(s, body.pid, body.text, body.because))


@app.post("/api/orders/{order_id}/ack")
def order_ack(order_id: str, body: AckIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.ack(s, order_id, body.reason))


@app.post("/api/transfers")
def transfers(body: TransferIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.transfer(s, body.pid, body.to_hospital))


@app.get("/api/inbox")
def inbox(x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.inbox(s))


@app.get("/api/access-log/{pid}")
def access_log(pid: str, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.access_log(s, pid))


@app.post("/api/patient-link")
def patient_link(body: LinkIn, x_session: str | None = Header(None)):
    s = _session(x_session)
    return _portal(lambda: engine.portal.patient_link(s, body.pid))


class PatientCheckIn(BaseModel):
    dob: str = ""


@app.post("/api/p/{token}")
def patient_view(token: str, body: PatientCheckIn):
    # POST, so the date of birth never sits in a URL or a server log
    return _portal(lambda: engine.portal.patient_view(token, body.dob))


@app.get("/api/deepchart/score")
def deepchart_score():
    return engine.portal.score()


# Serve the built frontends (Cloud Run: one service for all).
# The Next.js site (web/out) owns its pages: /, /board, /workflow, /ems, /login, DeepChart /doctor and patient links
# /p/<token> (one static page that reads the token from the URL). Anything else falls through to the classic app
# (frontend/dist), which still has the older DeepChart screens.
def _inside(root: Path, path: str) -> Path | None:
    f = (root / path).resolve()
    return f if f.is_relative_to(root.resolve()) else None


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
if DIST.exists() or WEB.exists():

    @app.api_route("/{path:path}", methods=["GET", "HEAD"])  # Next's router prefetches pages with HEAD
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "no such API route")  # never answer an API call with a web page
        if WEB.exists():
            if path.startswith("p/") and (WEB / "p" / "index.html").is_file():
                return FileResponse(WEB / "p" / "index.html")
            f = _inside(WEB, path)
            if f and f.is_file():
                return FileResponse(f)
            if f and (f / "index.html").is_file():
                return FileResponse(f / "index.html")
        if DIST.exists():
            f = _inside(DIST, path)
            return FileResponse(f if path and f and f.is_file() else DIST / "index.html")
        raise HTTPException(404, "not found")
