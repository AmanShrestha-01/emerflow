"""One simulated minute of hospital life. Pure code, no AI."""
from __future__ import annotations

import random

from backend.sim import escalation
from backend.sim.hospital import Hospital
from backend.sim.models import Move
from backend.sim.pipeline import Emit, _noop, commit
from backend.sim.scenarios import walk_in

CT_EVERY = 6          # minutes per CT scan
WALKIN_RATE = 0.04    # chance per minute
LOUNGE_STAY = 20      # minutes in the discharge lounge before going home
RETRIAGE_AFTER = {1: 5, 2: 15, 3: 45, 4: 90, 5: 120}


def tick(h: Hospital, rng: random.Random, emit: Emit = _noop, *, walkins: bool = True) -> None:
    h.clock += 1
    t = h.clock

    # Arrivals (ambulances may be diverted when the hospital is on diversion).
    for p in list(h.patients.values()):
        if p.state == "incoming" and p.arrived_at <= t:
            if h.diversion and p.severity >= 3:
                p.state = "transferred"
                h.diverted += 1
                emit("notice", {"text": f"{p.pid} diverted to another hospital by EMS"}, clock=t)
                continue
            p.state = "waiting"
            h.version += 1
            emit("patient.arrived", {"pid": p.pid, "severity": p.severity, "complaint": p.complaint}, clock=t)
    if walkins and rng.random() < WALKIN_RATE:
        p = walk_in(h, rng)
        emit("patient.arrived", {"pid": p.pid, "severity": p.severity, "complaint": p.complaint}, clock=t)

    # Staff call-ins arriving.
    for item in list(h.callins):
        at, unit, n = item
        if at <= t:
            h.callins.remove(item)
            h.nurses[unit] = h.nurses.get(unit, 0) + n
            h.version += 1
            emit("notice", {"text": f"{n} called-in nurse(s) arrived in {unit}"}, clock=t)

    # Scheduled surgeries take an OR room when they start.
    for c in h.or_cases:
        if not c.cancelled and c.starts_at == t:
            h.units["OR"].reserved[f"case:{c.case_id}"] = c.ends_at

    # CT scanner: one scan at a time, most critical first.
    need = [p for p in h.patients.values()
            if p.needs_ct and not p.ct_done and p.state in ("waiting", "placed", "held")]
    h.ct_queue = [p.pid for p in sorted(need, key=lambda p: (p.severity, p.arrived_at))]
    if h.ct_queue and t % CT_EVERY == 0:
        done = h.patients[h.ct_queue.pop(0)]
        done.ct_done = True
        h.version += 1
        emit("notice", {"text": f"CT done for {done.pid}"}, clock=t)

    # Patients get better: ICU patients improve; ward patients become ready to go home.
    if t % 15 == 0:
        cands = [p for p in h.in_unit("ICU") if not p.improving and p.severity >= 2]
        if cands:
            rng.choice(cands).improving = True
    if t % 10 == 0:
        cands = [p for p in h.in_unit("WARD") if not p.ready_for_discharge]
        if cands:
            rng.choice(cands).ready_for_discharge = True
    for p in h.in_unit("LOUNGE"):
        if p.moved_at is not None and t - p.moved_at >= LOUNGE_STAY and p.pid not in h.locked:
            commit(h, Move(h.next_id("M"), p.pid, "LOUNGE", "HOME", "discharge", source="fastlane",
                           reason="discharged home"), emit, clock=t)

    h.expire_reservations()
    h.hallway_minutes += len(h.units["HALLWAY"].occupants)

    for p in h.waiting():
        if not p.retriage_flag and t - p.arrived_at > RETRIAGE_AFTER[p.severity]:
            p.retriage_flag = True
            emit("retriage.flag", {"pid": p.pid, "waited": t - p.arrived_at}, clock=t)

    old, new = escalation.update_level(h)
    if new != old:
        emit("level.changed", {"old": old, "new": new, "name": escalation.NAMES[new]}, clock=t)
        for aid, a in list(h.approvals.items()):
            if a.escalation.level > new:
                del h.approvals[aid]
                emit("approval.resolved", {"approval_id": aid, "approved": False, "expired": True}, clock=t)
