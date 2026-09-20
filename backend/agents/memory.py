"""What each agent remembers, and for how long.

A note is one short sentence written BY CODE about something that actually happened: what a department
said, what it offered, what the coordinator ordered it, and what became of those patients. The models
never write memory; they only read it. That is what keeps memory from becoming a place to hallucinate.

Notes fade: anything older than WINDOW_S real seconds is dropped, and each agent keeps at most CAP of
them, so a long session can never bloat a prompt. Memory lives on the Swarm, so `Engine.reset()` clears
it: memory dies with the hospital it describes.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

from backend.sim.hospital import Hospital

WINDOW_S = 900.0   # 15 real minutes
CAP = 40           # notes per agent
BLOCK_CHARS = 600  # how much of it may reach a prompt
HERE = ("waiting", "placed", "held")  # a patient who has gone home is not "still with you"


@dataclass
class Note:
    at: float           # time.monotonic(), for fading
    clock: int          # hospital minute, for how the sentence reads
    kind: str           # said | offered | ordered | happened | heard
    text: str           # one short plain-English line
    pid: str = ""       # the patient it is about, when there is one


@dataclass
class Memory:
    notes: deque[Note] = field(default_factory=lambda: deque(maxlen=CAP))

    def add(self, kind: str, text: str, clock: int, pid: str = "") -> None:
        self.notes.append(Note(time.monotonic(), clock, kind, text, pid))

    def live(self, now: float | None = None) -> list[Note]:
        """The notes still inside the window, oldest first."""
        cut = (now if now is not None else time.monotonic()) - WINDOW_S
        return [n for n in self.notes if n.at >= cut]


def here(h: Hospital, pid: str) -> bool:
    """True while the patient is still in the hospital. Patients are never deleted from h.patients:
    apply_move only changes their state, so checking the dict is not enough."""
    p = h.patients.get(pid)
    return bool(p and p.state in HERE)


def name(h: Hospital, pid: str) -> str:
    p = h.patients.get(pid)
    return p.name if p else pid


def block(mem: Memory | None, h: Hospital, now: float | None = None) -> str:
    """Memory as a few plain lines for a prompt, newest last. Empty when there is nothing worth saying,
    so a first round's prompt is exactly what it is today."""
    if mem is None:
        return ""
    out: list[str] = []
    for n in mem.live(now):
        if n.pid and not here(h, n.pid):
            continue  # they have gone home; do not talk about them
        out.append(f"- {n.text}")
    if not out:
        return ""
    text = "\n".join(out[-8:])
    return text if len(text) <= BLOCK_CHARS else text[: BLOCK_CHARS - 1].rsplit("\n", 1)[0]


def follow_up(memories: dict[str, "Memory"], h: Hospital) -> tuple[str, list[str]] | None:
    """One sentence holding the last round to account, written by code. Returns (text, pids) or None.

    This is the part that still shows follow-through offline: with no model running the agents speak
    fixed rule text, but this line is ours.
    """
    kept: list[str] = []
    owed: list[tuple[str, str]] = []  # (department, patient) offered and still here
    for unit, m in memories.items():
        notes = m.live()
        offered = {n.pid for n in notes if n.kind == "offered" and n.pid}
        moved = {n.pid for n in notes if n.kind == "happened" and n.pid and " moved to " in n.text}
        for pid in offered:
            if pid in moved:
                kept.append(pid)
            elif here(h, pid):
                owed.append((unit, pid))
    if not kept and not owed:
        return None
    total = len(kept) + len(owed)
    said = f"Following up: {len(kept)} of {total} offered moves happened"
    if kept:
        said += f" ({', '.join(name(h, p) for p in sorted(set(kept))[:3])})"
    said += "."
    if owed:
        unit, pid = owed[0]
        said += f" {UNIT_SAYS.get(unit, unit)} offered {name(h, pid)} and they are still here."
    return said, sorted(set(kept))[:3] + [p for _, p in owed[:1]]


UNIT_SAYS = {"ER": "The emergency department", "ICU": "Intensive care", "STEPDOWN": "Close-watch",
             "OR": "Surgery", "STAFFING": "Staffing", "IMAGING": "CT", "XRAY": "X-ray", "LAB": "The lab",
             "BLOODBANK": "The blood bank", "EMS": "Ambulances"}


def as_json(memories: dict[str, Memory], h: Hospital) -> dict:
    """What /api/memory serves: every agent's live notes, newest first, with their age in seconds."""
    now = time.monotonic()
    return {
        "window_s": WINDOW_S,
        "agents": [
            {
                "unit": unit,
                "notes": [
                    {"age_s": round(now - n.at, 1), "clock": n.clock, "kind": n.kind, "pid": n.pid,
                     "name": name(h, n.pid) if n.pid else "", "text": n.text, "here": not n.pid or here(h, n.pid)}
                    for n in reversed(mem.live(now))
                ],
            }
            for unit, mem in memories.items()
        ],
    }
