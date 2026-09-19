"""One simulated minute of hospital life. Pure code, no AI."""
from __future__ import annotations

import random

from backend.sim import escalation
from backend.sim.hospital import Hospital
from backend.sim.models import Move
from backend.sim.pipeline import Emit, _noop, commit
from backend.sim.scenarios import walk_in

CT_EVERY = 6          # minutes per CT scan
XRAY_EVERY = 3        # minutes per X-ray image
XRAY_ROOMS = 2        # X-ray rooms working at once
LAB_MIN = 8           # no lab result sooner than this after arrival
WALKIN_RATE = 0.10    # chance per minute of an everyday patient (~6 an hour)
BUSY_FACTOR = 3       # a busy night triples everyday arrivals
ER_VISIT_MIN = 90     # minor ER patients (severity 4-5) are treated and ready to go home after this
SURGERY_MIN = 60      # an emergency operation
RECOVERY_MIN = 45     # time in recovery (PACU) before the ward
HOME_AFTER_READY = 45 # ward patients ready to go home leave on their own after this (the swarm can speed it up)
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
            p.note, p.note_by = "Just arrived; waiting for a bed", ""
            h.version += 1
            emit("patient.arrived", {"pid": p.pid, "severity": p.severity, "complaint": p.complaint}, clock=t)
    busy = bool(h.busy_until and h.busy_until > t)
    if walkins and rng.random() < WALKIN_RATE * (BUSY_FACTOR if busy else 1):
        p = walk_in(h, rng, busy=busy)
        p.note = "Just arrived; waiting for a bed"
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

    # X-ray: two rooms, an image every few minutes in each, most critical first.
    active = ("waiting", "placed", "held")
    need = [p for p in h.patients.values() if p.needs_xray and not p.xray_done and p.state in active]
    h.xray_queue = [p.pid for p in sorted(need, key=lambda p: (p.severity, p.arrived_at))]
    if h.xray_queue and t % XRAY_EVERY == 0:
        for pid in h.xray_queue[:XRAY_ROOMS]:
            h.patients[pid].xray_done = True
        h.xray_queue = h.xray_queue[XRAY_ROOMS:]
        h.version += 1

    # Lab: one result a minute, sickest first; a sample needs LAB_MIN minutes before its result can be back.
    need = [p for p in h.patients.values() if p.needs_labs and not p.labs_done and p.state in active]
    order = sorted(need, key=lambda p: (p.severity, p.arrived_at))
    ready = [p for p in order if t - p.arrived_at >= LAB_MIN]
    if ready:
        ready[0].labs_done = True
        h.version += 1
    h.lab_queue = [p.pid for p in order if not p.labs_done]

    # Patients get better: ICU patients improve; ward patients become ready to go home.
    if t % 15 == 0:
        cands = [p for p in h.in_unit("ICU") if not p.improving and p.severity >= 2]
        if cands:
            rng.choice(cands).improving = True
    if t % 20 == 0:
        cands = [p for p in h.in_unit("STEPDOWN") if not p.improving and p.pid not in h.locked]
        if cands:
            q = rng.choice(cands)
            q.improving, q.severity = True, max(q.severity, 3)  # stable enough for the ward
    if t % 10 == 0:
        cands = [p for p in h.in_unit("WARD") if not p.ready_for_discharge]
        if cands:
            q = rng.choice(cands)
            q.ready_for_discharge, q.ready_at = True, t
    # After surgery: operating room -> recovery (or ICU if recovery is full) -> ward.
    for p in h.in_unit("OR"):
        if p.moved_at is not None and t - p.moved_at >= SURGERY_MIN and p.pid not in h.locked:
            p.needs_surgery, p.need = False, "Recovery after surgery"
            for dest in ("PACU", "ICU"):
                if commit(h, Move(h.next_id("M"), p.pid, "OR", dest, "transfer", source="fastlane",
                                  reason="Surgery is finished; now recovering"), emit, clock=t) in ("applied", "flagged", "held"):
                    break
    for p in h.in_unit("PACU"):
        if p.moved_at is not None and t - p.moved_at >= RECOVERY_MIN and p.pid not in h.locked:
            p.severity, p.need = max(p.severity, 3), "Ward care after surgery"
            commit(h, Move(h.next_id("M"), p.pid, "PACU", "WARD", "transfer", source="fastlane",
                           reason="Recovered from surgery; moving to the ward"), emit, clock=t)
    # Everyday flow out of the hospital, so it doesn't just fill up.
    for p in h.in_unit("ER"):
        if p.severity >= 4 and not p.ready_for_discharge and p.moved_at is not None and t - p.moved_at >= ER_VISIT_MIN:
            p.ready_for_discharge, p.ready_at = True, t
    for unit, after in (("ER", 0), ("WARD", HOME_AFTER_READY)):
        for p in h.in_unit(unit):
            if p.ready_for_discharge and p.pid not in h.locked and t - (p.ready_at or 0) >= after:
                commit(h, Move(h.next_id("M"), p.pid, unit, "HOME", "discharge", source="fastlane",
                               reason="Treated and sent home"), emit, clock=t)
    for p in h.in_unit("LOUNGE"):
        if p.moved_at is not None and t - p.moved_at >= LOUNGE_STAY and p.pid not in h.locked:
            commit(h, Move(h.next_id("M"), p.pid, "LOUNGE", "HOME", "discharge", source="fastlane",
                           reason="Sent home"), emit, clock=t)

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
