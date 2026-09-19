// Data sources: where a run's events come from.
//
// The UI never talks to a backend directly. It is given a `SwarmSource`, which
// starts a run and emits protocol events. Swap the source to change where data
// comes from without touching any component.

import type { SwarmEvent } from "./protocol";
import { sampleRun, type RecordedRun } from "./workflow";

export type RunParams = Record<string, string | number | boolean | undefined>;
export type Emit = (event: SwarmEvent) => void;

export interface SwarmSource {
  /** Start a run and call `emit` for each event. Return a function that stops it. */
  start(params: RunParams, emit: Emit): () => void;
}

/** Convert whatever a backend sends into protocol events. Return null to skip a message. */
export type EventMapper = (raw: unknown) => SwarmEvent | SwarmEvent[] | null;

/**
 * Live stream from a server that sends Server-Sent Events (the default: server/server.py).
 * `params` from `swarm.start(params)` are added to the URL as a query string.
 * Pass `map` if the server's messages are in a different shape.
 */
export function sseSource({ url = "http://localhost:8000/run", map }: { url?: string; map?: EventMapper } = {}): SwarmSource {
  return {
    start(params, emit) {
      const query = new URLSearchParams(
        Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
      ).toString();
      const es = new EventSource(query ? `${url}?${query}` : url);
      let finished = false;

      es.onmessage = (message) => {
        const raw: unknown = JSON.parse(message.data);
        const mapped = map ? map(raw) : (raw as SwarmEvent);
        for (const event of mapped === null ? [] : Array.isArray(mapped) ? mapped : [mapped]) {
          if (event.type === "end" || event.type === "error") {
            finished = true;
            es.close();
          }
          emit(event);
        }
      };
      // EventSource reconnects by itself, which would replay the run. Stop instead.
      es.onerror = () => {
        if (finished) return;
        finished = true;
        es.close();
        emit({ type: "error", message: `Can't reach the data source at ${url}.` });
      };
      return () => es.close();
    },
  };
}

/** Plays back a recorded run with its original timing. No server needed. */
export function replaySource(run: RecordedRun = sampleRun, { speed = 1 }: { speed?: number } = {}): SwarmSource {
  return {
    start(_params, emit) {
      const timers = run.events.map(({ at, event }) => setTimeout(() => emit(event), (at * 1000) / speed));
      return () => timers.forEach(clearTimeout);
    },
  };
}

/**
 * For data that already lives in the host page (e.g. from a partner's API or state).
 * Call `swarm.start()`, then `push(event)` for each event.
 */
export function pushSource(): { source: SwarmSource; push: Emit } {
  let current: Emit | null = null;
  return {
    source: {
      start(_params, emit) {
        current = emit;
        return () => {
          if (current === emit) current = null;
        };
      },
    },
    push: (event) => current?.(event),
  };
}
