"""What each agent remembers, and for how long.

A note is one short sentence written BY CODE about something that actually happened: what a department
said, what it offered, what the coordinator ordered it, and what became of those patients. The models
never write memory; they only read it. That is what keeps memory from becoming a place to hallucinate.

Notes fade: anything older than WINDOW_S real seconds is dropped, and each agent keeps at most CAP of
them, so a long session can never bloat a prompt. In practice CAP is the binding limit — an agent holds
its last CAP notes, for up to WINDOW_S. Memory lives on the Swarm, so `Engine.reset()` clears it: memory
dies with the hospital it describes.

What reaches a model is still small and recent: `block()` sends the last handful of lines, and
`follow_up()` only holds an agent to what it promised in the last RECENT_S.
"""
from __future__ import annotations

import re
import time
from collections import deque
from dataclasses import dataclass, field

from backend.sim.hospital import Hospital
from backend.sim.words import plain, to_place

WINDOW_S = 18000.0  # 5 real hours: a whole shift, and then some
RECENT_S = 900.0   # but only the last 15 minutes count as a promise still owed
CAP = 60           # notes per agent
BLOCK_CHARS = 600  # how much of it may reach a prompt
HERE = ("waiting", "placed", "held")  # a patient who has gone home is not "still with you"
# A status line is a statement about right now, not an event, and it often quotes a bed count ("we have
# four beds open"). Keeping several of them would leave stale counts sitting in a prompt next to the live
# ones, which is exactly the arithmetic the models are not allowed to do. So only the newest survives.
LATEST_ONLY = ("said",)


@dataclass
class Note:
    at: float           # time.monotonic(), for fading
    clock: int          # hospital minute, for how the sentence reads
    kind: str           # said | offered | ordered | happened
    text: str           # one short plain-English line
    pid: str = ""       # the patient it is about, when there is one
    key: str = ""       # notes sharing a key describe the same thing: only the newest is true
    dest: str = ""      # where they were headed, so a promise can be matched to its outcome
    ok: bool = False    # for an outcome: did they actually go


@dataclass
class Memory:
    notes: deque[Note] = field(default_factory=lambda: deque(maxlen=CAP))

    def add(self, kind: str, text: str, clock: int, pid: str = "", key: str = "",
            dest: str = "", ok: bool = False) -> None:
        """Remember one thing.

        Saying the same thing again refreshes the note rather than adding another: a department that
        reports "we have no O-negative blood" every round for an hour is holding one fact, not sixty.

        A `key` goes further and supersedes: two notes about the same patient and the same destination
        are two answers to one question, and only the last one is true. Without this a department ends up
        holding "Marco Ahmed could not move to surgery (OR is full)" next to "Marco Ahmed moved to
        surgery", and both reach its next prompt."""
        if key:
            for old in [n for n in self.notes if n.key == key]:
                self.notes.remove(old)
        elif kind in LATEST_ONLY:
            for old in [n for n in self.notes if n.kind == kind]:
                self.notes.remove(old)
        else:
            for old in self.notes:
                if old.kind == kind and old.text == text and old.pid == pid:
                    self.notes.remove(old)
                    break
        self.notes.append(Note(time.monotonic(), clock, kind, text, pid, key, dest, ok))

    def live(self, now: float | None = None) -> list[Note]:
        """The notes still inside the window, oldest first."""
        cut = (now if now is not None else time.monotonic()) - WINDOW_S
        return [n for n in self.notes if n.at >= cut]


MOVED = ("move.applied", "move.flagged")  # the two events that mean the patient actually went


def record_move(memories: dict[str, "Memory"], h: Hospital, type_: str, d: dict) -> None:
    """Remember what became of a patient, whoever moved them.

    Every move in the hospital passes through `pipeline.commit()` and comes out as one of these events, so
    hanging memory here is what makes it complete. It used to be written from the swarm's own apply loop,
    which meant an agent only ever remembered the moves the coordinator planned: the fast lane placing a
    patient, the clock sending one home, the rule-based repair plan and a human clearing a records hold
    were all invisible to it — roughly three moves in five. Worst of all, a department that offered a bed
    and then watched the fast lane deliver it was scored as having broken its word.
    """
    from backend.agents.departments import OWNER  # here, so memory stays importable on its own

    pid = d.get("pid")
    to_unit = d.get("to_unit")
    if not pid or not to_unit or pid not in h.patients:
        return
    who = name(h, pid)
    where = to_place(to_unit)
    went = type_ in MOVED
    if went:
        text = f"{who} moved {where}"
    elif type_ == "move.held":
        text = f"{who} did not move {where}: the records check paused it for a person to look at"
    else:
        why = plain(d.get("reason") or "", h)
        text = f"{who} could not move {where}" + (f" — {why}" if why else "")

    # the department losing the bed and the one gaining it; for a move that never happened, only the one
    # that was being asked to take them
    text = readable(text)
    from_unit = d.get("from_unit") or (None if went else h.patients[pid].unit)
    told = {OWNER.get(from_unit or "", ""), OWNER.get(to_unit, "")}
    # and whoever promised this move, even if they own neither end of it. Five of the ten departments
    # speak for no unit at all, so without this they could offer a patient and never hear the answer —
    # and follow_up() would name them on the board every round for a promise that was in fact kept.
    told |= {unit for unit, m in memories.items()
             if any(n.kind == "offered" and n.pid == pid and n.dest == to_unit for n in m.live())}
    for dept in told:
        if dept in memories:
            # keyed on patient and destination: a later answer about the same move replaces the earlier
            memories[dept].add("happened", text, h.clock, pid, key=f"move:{pid}>{to_unit}",
                               dest=to_unit, ok=went)


def here(h: Hospital, pid: str) -> bool:
    """True while the patient is still in the hospital. Patients are never deleted from h.patients:
    apply_move only changes their state, so checking the dict is not enough."""
    p = h.patients.get(pid)
    return bool(p and p.state in HERE)


NO_NAME = "an unidentified patient"  # the board can show a bare "X"; a sentence cannot


def name(h: Hospital, pid: str) -> str:
    p = h.patients.get(pid)
    if not p:
        return pid
    return NO_NAME if p.name in ("", "X") else p.name


def readable(text: str) -> str:
    """A casualty nobody has identified is called X on the board. "move X to the ward" is not a sentence."""
    return re.sub(r"(?<![\w-])X(?![\w-])", NO_NAME, text)


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
    kept: set[str] = set()
    owed: list[tuple[str, str]] = []   # (department, patient) promised and still waiting
    seen: set[tuple[str, str]] = set()  # a promise is one promise even if two departments made it
    cut = time.monotonic() - RECENT_S   # an offer made hours ago is history, not an open promise
    for unit, m in memories.items():
        notes = [n for n in m.live() if n.at >= cut]
        # A promise is a patient AND a destination. Matching on the patient alone credited a department
        # for a move it did not make: it offered a ward bed, the fast lane took the patient to the
        # critical care room instead, and the board reported the promise kept.
        offered = {(n.pid, n.dest) for n in notes if n.kind == "offered" and n.pid}
        done = {(n.pid, n.dest) for n in notes if n.kind == "happened" and n.ok and n.pid}
        for promise in offered:
            if promise in seen:
                continue
            seen.add(promise)
            pid = promise[0]
            if promise in done:
                kept.add(pid)
            elif here(h, pid):
                owed.append((unit, pid))
    if not kept and not owed:
        return None
    total = len(kept) + len(owed)
    said = f"Following up: {len(kept)} of {total} offered moves happened"
    if kept:
        said += f" ({', '.join(name(h, p) for p in sorted(kept)[:3])})"
    said += "."
    if owed:
        unit, pid = owed[0]
        said += f" {UNIT_SAYS.get(unit, unit)} offered {name(h, pid)} and they are still here."
    return said, sorted(kept)[:3] + [p for _, p in owed[:1]]


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
