"""Gemini on Vertex AI, with timeouts, a circuit breaker, tape recording, and stub/replay modes.

Modes (EMERFLOW_MODE, or legacy EMERFLOW_STUB=1):
- live   : real Gemini. Every answer is recorded to a "tape" (one file per hospital reset).
- replay : plays a recorded tape back (EMERFLOW_TAPE, default replays/demo.jsonl): the same real Gemini
           text with the original timing, no network. If the hospital has drifted from the recording,
           that one call falls back to the rules, so the board never breaks.
- stub   : rule-based answers only, after a short fake delay (no project or offline).
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

def model_label(model: str) -> str:
    """"gemini-3.1-pro-preview" -> "Gemini 3.1 Pro", for the pages that name the model.

    The "-preview" suffix is which release channel we are on, not a different model, so it is dropped:
    the pages should say what the model is called."""
    parts = [w for w in model.split("-") if w != "preview"]
    return " ".join(w.capitalize() if not w[0].isdigit() else w for w in parts)


def _thinking(types, model: str, tier: str):
    """Gemini 3.x names this a level; 2.5 takes a token budget and rejects a level outright.

    Thinking is kept low: a round is a dozen calls, and thinking tokens are charged on every one of
    them. Set EMERFLOW_THINKING=high to let the model reason harder, and expect a slower, dearer round."""
    if model.startswith("gemini-2."):
        return types.ThinkingConfig(thinking_budget=0)  # 2.5 Flash: no thinking tokens, the fastest setting
    return types.ThinkingConfig(thinking_level=os.environ.get("EMERFLOW_THINKING", "low"))


PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "gemini-2.5-flash")
LITE_MODEL = os.environ.get("GEMINI_LITE_MODEL", "gemini-2.5-flash")
REPLAY_DIR = Path(os.environ.get("EMERFLOW_REPLAY_DIR", "backend/agents/replays"))
DEMO_TAPE = Path(os.environ.get("EMERFLOW_TAPE", str(REPLAY_DIR / "demo.jsonl")))
REPLAY_MAX_DELAY = 4.0  # seconds; replayed answers keep their real pacing, capped
BREAKER_AFTER = 5      # consecutive failures before switching to rule-based answers
BREAKER_COOLDOWN = 60  # seconds before trying Gemini again


class LLM:
    def __init__(self, mode: str | None = None, fake_latency: bool = True) -> None:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        env_mode = os.environ.get("EMERFLOW_MODE", "").lower()
        if os.environ.get("EMERFLOW_STUB") == "1":
            env_mode = "stub"
        if env_mode not in ("live", "replay", "stub"):
            env_mode = "live" if project else "stub"
        if env_mode == "live" and not project:
            env_mode = "stub"
        self.mode = mode or env_mode
        self.model_name = model_label(LITE_MODEL)  # what the pages call the model, e.g. "Gemini 2.5 Flash"
        self.fake_latency = fake_latency
        self.failures = 0
        self.opened_at = 0.0
        self.calls = 0
        self._client = None
        self._project = project
        self._location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
        self.tape: dict[str, dict] = {}
        self.tape_path: Path | None = None
        self.replayed = 0
        self._seen: dict[str, int] = {}
        if self.mode == "replay":
            self.tape = load_tape(DEMO_TAPE)
        self.reset()

    def reset(self) -> None:
        """New run: restart the per-role call counters and (live mode) start a new tape file."""
        self._seen = {}
        self.replayed = 0
        self.hows: dict[str, int] = {}
        if self.mode == "live":
            REPLAY_DIR.mkdir(parents=True, exist_ok=True)
            self.tape_path = REPLAY_DIR / f"tape-{time.strftime('%Y%m%d-%H%M%S')}.jsonl"

    def _key(self, role: str) -> str:
        n = self._seen.get(role, 0)
        self._seen[role] = n + 1
        return f"{role}#{n}"

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
        """Returns (answer, how) where how is "live" | "replay" | "stub" | "fallback"."""
        out, how = await self._call(role, tier, prompt, schema, fallback, timeout, temperature)
        self.hows[how] = self.hows.get(how, 0) + 1
        return out, how

    async def _call(self, role: str, tier: str, prompt: str, schema: type[BaseModel],
                    fallback: Callable[[], BaseModel], timeout: float,
                    temperature: float) -> tuple[BaseModel, str]:
        self.calls += 1
        key = self._key(role)
        if self.mode == "replay":
            rec = self.tape.get(key)
            if rec is not None:
                try:
                    out = schema.model_validate(rec["output"])
                    if self.fake_latency:
                        await asyncio.sleep(min(float(rec.get("secs", 1.0)), REPLAY_MAX_DELAY))
                    self.replayed += 1
                    return out, "replay"
                except Exception:
                    pass  # the hospital drifted from the recording (e.g. a patient id no longer exists)
            if self.fake_latency:
                await asyncio.sleep(random.uniform(0.3, 1.2))
            return fallback(), "fallback"
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
                        thinking_config=_thinking(types, PRO_MODEL if tier == "pro" else LITE_MODEL, tier),
                    ),
                ),
                timeout=timeout,
            )
            parsed = resp.parsed
            out = parsed if isinstance(parsed, BaseModel) else schema.model_validate_json(resp.text or "{}")
            self.failures = 0
            self._record(key, role, tier, prompt, out, time.monotonic() - started)
            return out, "live"
        except Exception as exc:  # timeouts, 429s, bad JSON: never let the board stop
            self.failures += 1
            if self.failures >= BREAKER_AFTER:
                self.opened_at = time.monotonic()
            print(f"[emerflow] {role} call failed ({type(exc).__name__}: {exc}); using fallback")
            return fallback(), "fallback"

    def _record(self, key: str, role: str, tier: str, prompt: str, out: BaseModel, secs: float) -> None:
        if self.tape_path is None:
            return
        try:
            with self.tape_path.open("a") as fh:
                fh.write(json.dumps({"key": key, "role": role, "tier": tier, "secs": round(secs, 2),
                                     "prompt": prompt, "output": out.model_dump()}) + "\n")
        except OSError:
            pass


def load_tape(path: Path) -> dict[str, dict]:
    """key ("dept:ICU#3") -> recorded call. Missing or unreadable tape = empty (everything falls back)."""
    tape: dict[str, dict] = {}
    try:
        for line in path.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                if "key" in rec:
                    tape[rec["key"]] = rec
    except (OSError, ValueError):
        print(f"[emerflow] no usable replay tape at {path}; replay will use rule-based answers")
    return tape
