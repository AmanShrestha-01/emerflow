"""Escalation level, computed by code from occupancy and the waiting queue.

Hysteresis: thresholds to go up are higher than thresholds to come down, so the level doesn't flap.
Level 4 (crisis) is only ever set and cleared by a human.
"""
from __future__ import annotations

from backend.sim.hospital import Hospital

WATCHED = ("ER", "ICU", "STEPDOWN", "WARD")
NAMES = {0: "NORMAL", 1: "MAKE ROOM", 2: "STRETCH", 3: "DIVERT", 4: "CRISIS"}
L3_AFTER_MIN = 20


def _critical_wait(h: Hospital) -> int:
    ws = [h.clock - p.arrived_at for p in h.waiting() if p.severity <= 2]
    return max(ws, default=0)


def _pressure(h: Hospital, pct: int, queue: int, crit_wait: int) -> int:
    er_full = h.occupancy("ER") >= 100
    if er_full or _critical_wait(h) > crit_wait or len(h.waiting()) >= queue * 2:
        return 2
    if any(h.occupancy(u) >= pct for u in WATCHED) or len(h.waiting()) >= queue:
        return 1
    return 0


def compute_level(h: Hospital) -> int:
    if h.level == 4:
        return 4
    up = _pressure(h, pct=90, queue=5, crit_wait=10)
    down = _pressure(h, pct=80, queue=3, crit_wait=5)
    level = h.level
    if up > level:
        level = up
    elif down < level:
        level -= 1  # come down one step at a time
    if h.level == 2 and up == 2 and h.clock - h.level_since >= L3_AFTER_MIN:
        level = 3
    if h.level == 3 and up == 2:
        level = 3
    return level


def update_level(h: Hospital) -> tuple[int, int]:
    """Recompute; returns (old, new). Records when the level changed."""
    old = h.level
    new = compute_level(h)
    if new != old:
        h.level = new
        h.level_since = h.clock
        h.version += 1
    return old, new
