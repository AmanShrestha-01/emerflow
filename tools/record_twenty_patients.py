"""Run 20 arriving patients through the real Emer Flow engine (live Gemini) and record a plain timeline."""
import asyncio, json, random, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
import backend  # loads .env
from backend.agents.cycle import Swarm
from backend.agents.llm import LLM
from backend.sim import fastlane, approvals
from backend.sim.clock import tick
from backend.sim.pipeline import resolve_hold
from backend.sim.scenarios import build_hospital, _patient, give_records, plant
from backend.sim.words import place

MIX = [  # (arrive minute, severity, complaint) — an everyday rush of 20 people
    (2, 1, "gunshot wound to the abdomen"), (3, 4, "broken wrist"), (4, 2, "chest pain, sweaty"),
    (5, 3, "shortness of breath"), (6, 5, "sprained ankle"), (7, 2, "stroke symptoms"),
    (8, 4, "fever"), (9, 3, "kidney stone"), (10, 1, "stab wound to the chest"), (11, 4, "cut hand, needs stitches"),
    (12, 2, "severe asthma attack"), (13, 3, "abdominal pain"), (14, 5, "sore throat"), (15, 3, "fall, hip pain"),
    (16, 2, "sepsis, confused"), (17, 4, "migraine"), (18, 3, "chest pain"), (19, 4, "vomiting, dehydrated"),
    (20, 3, "child with high fever"), (21, 2, "car crash, internal bleeding"),
]
PLANT = {2: "anticoagulant", 5: "vitals_stable", 17: "anticoagulant"}  # index -> fact that will disagree

async def main():
    h, key = build_hospital(7)
    rng = random.Random(42)
    tracked = []
    for i, (at, sev, complaint) in enumerate(MIX):
        p = _patient(h, rng, "SIM", sev, complaint, arrived_at=at, state="incoming")
        give_records(p, rng)
        if i in PLANT:
            plant(p, PLANT[i], "existence", key)
        h.add_patient(p)
        tracked.append(p.pid)
    llm = LLM()
    print("mode:", llm.mode, file=sys.stderr)
    swarm = Swarm(llm)
    frames, events = [], []
    def emit(t, d, cycle_id=None, round_=None, **k):
        pid = d.get("pid")
        if t == "agent.message" and d["kind"] in ("ask", "reply", "object") or (t == "agent.message" and d["kind"] == "plan" and d["to"] == ["ALL"]):
            events.append({"min": h.clock, "type": "talk", "from": d["from"], "persona": d.get("persona", ""),
                           "to": d["to"], "kind": d["kind"], "text": d["text"], "how": d["how"]})
        elif t in ("move.applied", "move.held", "move.flagged") and pid in tracked:
            p = h.patients[pid]
            events.append({"min": h.clock, "type": t.split(".")[1], "pid": pid, "to": d.get("to_unit"),
                           "note": p.note, "by": p.note_by})
        elif t == "patient.arrived" and pid in tracked:
            events.append({"min": h.clock, "type": "arrived", "pid": pid})
        elif t == "hold.resolved" and pid in tracked:
            events.append({"min": h.clock, "type": "human", "pid": pid, "note": h.patients[pid].note})
        elif t == "level.changed":
            events.append({"min": h.clock, "type": "level", "level": d["new"], "name": d["name"]})
    last_cycle = -99
    for minute in range(1, 71):
        tick(h, rng, emit, walkins=False)
        fastlane.run(h, emit)
        # a person checks each paused move after 5 minutes (in the real app, you click a button)
        for hid, hold in list(h.holds.items()):
            if h.clock - hold.created_at >= 5:
                resolve_hold(h, hid, "proceed", emit)
        for aid, a in list(h.approvals.items()):
            if h.clock - a.created_at >= 3:
                approvals.resolve(h, aid, True, emit)
        busy = h.waiting() or any(h.patients[x].state == "held" for x in tracked)
        if (h.waiting() and h.clock - last_cycle >= 3) or (h.clock - last_cycle >= 8 and busy):
            last_cycle = h.clock
            await swarm.run_cycle(h, emit, "sim")
        frames.append({"min": h.clock, "level": h.level,
                       "beds": {u: {"free": h.units[u].free, "total": h.units[u].beds}
                                for u in ("ER", "ICU", "STEPDOWN", "WARD", "OR", "RESUS")},
                       "patients": {x: {"state": h.patients[x].state, "unit": h.patients[x].unit,
                                        "heading_to": h.patients[x].heading_to} for x in tracked}})
        print(f"min {h.clock} waiting={len(h.waiting())} holds={len(h.holds)} cycles={swarm.cycles}", file=sys.stderr)
    people = {x: {"name": h.patients[x].name, "age": h.patients[x].age, "severity": h.patients[x].severity,
                  "complaint": h.patients[x].complaint, "need": h.patients[x].need} for x in tracked}
    arrive = {pid: MIX[i][0] for i, pid in enumerate(tracked)}
    for pid in tracked:
        people[pid]["arrive"] = arrive[pid]
    out = {"people": people, "frames": frames, "events": events, "llm": dict(llm.hows)}
    json.dump(out, open(sys.argv[1], "w"))
    print("done", dict(llm.hows), len(events), "events", file=sys.stderr)

asyncio.run(main())
