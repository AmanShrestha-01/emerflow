"""Live ER status from MIEMSS EDAS, the Maryland Emergency Department Advisory System (miemssalert.com).

EDAS is the public board Maryland EMS uses to see each ER's crowding level and the ambulances there.
We fetch its public feed at most once a minute and pass on only per-hospital totals: never unit call
signs or incident numbers. With no network the answer is {"available": false} and the map stays simulated.
"""
from __future__ import annotations

import time

import httpx

FEED = "https://edas.miemss.org/edas-services/api/cachedhospitalstatus"
TTL = 60  # seconds
ALERTS = ("red", "yellow", "reroute", "codeBlack", "traumaBypass", "capacity")

_cache: dict = {"at": 0.0, "data": None}


def _hospital(r: dict) -> dict:
    a = r.get("alerts") or {}
    return {
        "code": r.get("destinationCode"),
        "name": r.get("destinationName"),
        "level": a.get("edCensusIndicatorScore"),  # ED crowding, 1 (normal) to 4 (most crowded)
        "alerts": [k for k in ALERTS if a.get(k)],
        "note": a.get("notes"),
        "at_hospital": r.get("numOfUnits") or 0,  # ambulances at the ER now
        "en_route": r.get("numOfUnitsEnroute") or 0,
        "longest_stay_min": r.get("maxStay") or 0,  # longest an ambulance at the ER has been there
    }


async def status() -> dict:
    now = time.time()
    if _cache["data"] and now - _cache["at"] < TTL:
        return _cache["data"]
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(FEED, headers={"User-Agent": "EmerFlow (HopHacks demo)"})
            r.raise_for_status()
            body = r.json()
    except Exception as e:  # offline or EDAS down: the map falls back to simulated numbers
        return {"available": False, "error": type(e).__name__}
    data = {
        "available": True,
        "source": "MIEMSS EDAS (miemssalert.com)",
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "hospitals": [_hospital(h) for h in body.get("results", [])],
    }
    _cache.update(at=now, data=data)
    return data
