"""Pick the demo tape: `python -m backend.agents.tape` lists live runs; `... pick <file>` makes it the demo.

A tape is one live run's Gemini answers (one file per hospital reset). The demo plays back
backend/agents/replays/demo.jsonl when EMERFLOW_MODE=replay.
"""
from __future__ import annotations

import json
import shutil
import sys

from backend.agents.llm import DEMO_TAPE, REPLAY_DIR


def summary(path) -> str:
    lines = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    cycles = sum(1 for r in lines if r.get("role") == "coordinator")
    return f"{path.name}: {len(lines)} answers, {cycles} coordinator plans"


def main(argv: list[str]) -> None:
    tapes = sorted(REPLAY_DIR.glob("tape-*.jsonl"))
    if len(argv) >= 2 and argv[0] == "pick":
        src = REPLAY_DIR / argv[1]
        shutil.copyfile(src, DEMO_TAPE)
        print(f"demo tape <- {summary(src)}")
        return
    for t in tapes:
        print(summary(t))
    print(f"\nmake one the demo: python -m backend.agents.tape pick <file>   (current: {DEMO_TAPE})")


if __name__ == "__main__":
    import backend  # noqa: F401  (loads .env)
    main(sys.argv[1:])
