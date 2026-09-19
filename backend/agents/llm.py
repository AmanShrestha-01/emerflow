"""Gemini on Vertex AI, with timeouts, a circuit breaker, recording, and a stub mode.

EMERFLOW_STUB=1 (or no GOOGLE_CLOUD_PROJECT) → every call returns its rule-based fallback
after a short fake delay, so the demo runs with the wifi off and pacing matches live mode.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import time
from pathlib import Path
from typing import Callable

from pydantic import BaseModel

PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "gemini-3.6-flash")
LITE_MODEL = os.environ.get("GEMINI_LITE_MODEL", "gemini-3.6-flash")
RECORD_PATH = Path(os.environ.get("EMERFLOW_RECORD", "backend/agents/replays/live.jsonl"))
BREAKER_AFTER = 5      # consecutive failures before switching to rule-based answers
BREAKER_COOLDOWN = 60  # seconds before trying Gemini again


class LLM:
    def __init__(self, mode: str | None = None, fake_latency: bool = True) -> None:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        stub = os.environ.get("EMERFLOW_STUB") == "1" or not project
        self.mode = mode or ("stub" if stub else "live")
        self.fake_latency = fake_latency
        self.failures = 0
        self.opened_at = 0.0
        self.calls = 0
        self._client = None
        self._project = project
        self._location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

    @property
    def breaker_open(self) -> bool:
        """Open after repeated failures; after a cooldown, let calls through again to test recovery."""
        if self.failures < BREAKER_AFTER:
            return False
        if time.monotonic() - self.opened_at >= BREAKER_COOLDOWN:
            self.failures = BREAKER_AFTER - 1  # half-open: one more failure re-opens it
            return False
        return True

    def _get_client(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(vertexai=True, project=self._project, location=self._location)
        return self._client

    async def call(self, role: str, tier: str, prompt: str, schema: type[BaseModel],
                   fallback: Callable[[], BaseModel], timeout: float,
                   temperature: float = 0.3) -> tuple[BaseModel, str]:
        """Returns (answer, how) where how is "live" | "stub" | "fallback"."""
        self.calls += 1
        if self.mode != "live" or self.breaker_open:
            if self.fake_latency:
                await asyncio.sleep(random.uniform(0.3, 1.2) if tier == "lite" else random.uniform(1.0, 2.5))
            return fallback(), "stub" if self.mode != "live" else "fallback"
        started = time.monotonic()
        try:
            from google.genai import types
            client = self._get_client()
            resp = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=PRO_MODEL if tier == "pro" else LITE_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=schema,
                        temperature=temperature,
                        thinking_config=types.ThinkingConfig(thinking_level="low"),
                    ),
                ),
                timeout=timeout,
            )
            parsed = resp.parsed
            out = parsed if isinstance(parsed, BaseModel) else schema.model_validate_json(resp.text or "{}")
            self.failures = 0
            self._record(role, tier, prompt, out, time.monotonic() - started)
            return out, "live"
        except Exception as exc:  # timeouts, 429s, bad JSON: never let the board stop
            self.failures += 1
            if self.failures >= BREAKER_AFTER:
                self.opened_at = time.monotonic()
            print(f"[emerflow] {role} call failed ({type(exc).__name__}: {exc}); using fallback")
            return fallback(), "fallback"

    def _record(self, role: str, tier: str, prompt: str, out: BaseModel, secs: float) -> None:
        try:
            RECORD_PATH.parent.mkdir(parents=True, exist_ok=True)
            with RECORD_PATH.open("a") as fh:
                fh.write(json.dumps({"role": role, "tier": tier, "secs": round(secs, 2),
                                     "prompt": prompt, "output": out.model_dump()}) + "\n")
        except OSError:
            pass
