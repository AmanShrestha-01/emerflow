"""FastAPI app: REST + Server-Sent Events. See CONTRACT.md."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.engine import Engine, compare

engine = Engine()
HEARTBEAT_SECS = 15
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    engine.start()
    yield
    engine.bus.close()


app = FastAPI(title="Emer Flow · Hospital Swarm", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"],
                   allow_headers=["*"])


class SurgeIn(BaseModel):
    n: int = 25


class RadioIn(BaseModel):
    text: str


class ApproveIn(BaseModel):
    approve: bool


class ResolveIn(BaseModel):
    outcome: str


class ControlIn(BaseModel):
    action: str
    speed: int | None = None
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

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/surge")
def surge(body: SurgeIn | None = None):
    n = max(1, min((body.n if body else 25), 60))
    return {"incoming": engine.surge(n)}


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
    if approval_id not in engine.h.approvals:
        raise HTTPException(404, "approval no longer pending")
    return {"ok": True, "detail": engine.approve(approval_id, body.approve)}


@app.post("/api/holds/{hold_id}/resolve")
def resolve(hold_id: str, body: ResolveIn):
    if hold_id not in engine.h.holds:
        raise HTTPException(404, "hold no longer pending")
    if body.outcome not in ("proceed", "cancel"):
        raise HTTPException(400, "outcome must be proceed or cancel")
    return {"ok": True, "detail": engine.resolve_hold(hold_id, body.outcome)}


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


# ---------- DeepChart portal (see CONTRACT.md, "DeepChart portal") ----------
from backend.deepchart.access import Session  # noqa: E402
from backend.deepchart.portal import Forbidden, NotFound  # noqa: E402
from backend.deepchart.records import HOSPITALS  # noqa: E402


class LoginIn(BaseModel):
    hospital: str
    role: str
    pin: str


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
    s = _portal(lambda: engine.access.login(body.hospital, body.role, body.pin))
    return {"token": s.token, "hospital": s.hospital, "role": s.role}


@app.get("/api/hospitals")
def hospitals():
    return [{"name": n} for n in HOSPITALS]


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


@app.get("/api/p/{token}")
def patient_view(token: str):
    return _portal(lambda: engine.portal.patient_view(token))


@app.get("/api/deepchart/score")
def deepchart_score():
    return engine.portal.score()


# Serve the built frontend (Cloud Run: one service for both).
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
