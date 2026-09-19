"""Typed event envelope + fan-out bus. Every UI update is one of these events (see CONTRACT.md)."""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Any


class EventBus:
    def __init__(self, history: int = 1200) -> None:
        self._seq = 0
        self.history: deque[dict] = deque(maxlen=history)
        self._subs: set[asyncio.Queue] = set()

    def emit(self, type_: str, data: dict[str, Any], *, clock: int = 0,
             cycle_id: str | None = None, round_: str | None = None) -> dict:
        self._seq += 1
        ev = {"id": self._seq, "type": type_, "clock": clock, "cycle_id": cycle_id,
              "round": round_, "data": data}
        self.history.append(ev)
        for q in list(self._subs):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                pass  # a slow client will resync from the snapshot on reconnect
        return ev

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def close(self) -> None:
        """Tell every open stream to end (server shutdown), so shutdown never hangs on SSE clients."""
        for q in list(self._subs):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass

    def reset(self) -> None:
        self.history.clear()
