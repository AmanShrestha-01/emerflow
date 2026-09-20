"""The hospital only runs while somebody is watching it."""
import asyncio

from backend import engine as eng
from backend.engine import Engine


def _engine() -> Engine:
    return Engine()


def test_a_fresh_server_sits_still():
    e = _engine()
    assert e.idle and e.watchers == 0
    before = e.h.clock
    asyncio.run(_steps(e, 3))
    assert e.h.clock == before  # no clock while nobody is looking


async def _steps(e: Engine, n: int) -> None:
    for _ in range(n):
        if not e.paused and not e.idle:
            e.step()
        await asyncio.sleep(0)


def test_opening_the_feed_starts_it_and_closing_it_stops_it(monkeypatch):
    monkeypatch.setattr(eng, "IDLE_GRACE_S", 0.02)  # a reload should not pause it, so there is a grace period

    async def run() -> None:
        e = _engine()
        e.watch()
        assert not e.idle
        before = e.h.clock
        await _steps(e, 2)
        assert e.h.clock > before  # running now

        e.unwatch()
        assert not e.idle  # still running during the grace
        await asyncio.sleep(0.1)
        assert e.idle and e.watchers == 0

        stopped = e.h.clock
        await _steps(e, 3)
        assert e.h.clock == stopped
    asyncio.run(run())


def test_a_reload_inside_the_grace_never_stops_it(monkeypatch):
    monkeypatch.setattr(eng, "IDLE_GRACE_S", 0.05)

    async def run() -> None:
        e = _engine()
        e.watch()
        e.unwatch()          # the tab reloads: the stream drops...
        await asyncio.sleep(0.01)
        e.watch()            # ...and comes straight back
        await asyncio.sleep(0.1)
        assert not e.idle and e.watchers == 1
    asyncio.run(run())


def test_state_owns_up_to_being_stopped():
    e = _engine()
    s = e.state(include_feed=False)
    assert s["idle"] is True and s["paused"] is True and s["watchers"] == 0
    e.watch()
    s = e.state(include_feed=False)
    assert s["idle"] is False and s["paused"] is False and s["watchers"] == 1
