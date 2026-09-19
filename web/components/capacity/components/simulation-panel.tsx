"use client";

import "../effects.css";
import { STATUS } from "../geo";
import type { SimulationState } from "../use-simulation";
import type { Hospital, Simulation } from "../types";

const CASUALTY_PRESETS = [15, 40, 80];

function Stat({ label, a, b, unit = "min" }: { label: string; a: number; b: number; unit?: string }) {
  const better = a < b;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-baseline gap-2 py-1.5 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-semibold tabular-nums ${better ? "text-emerald-700" : "text-slate-900"}`}>
        {a}
        {unit && <span className="text-[11px] font-normal text-slate-400"> {unit}</span>}
      </span>
      <span className="text-right tabular-nums text-slate-500">
        {b}
        {unit && <span className="text-[11px] text-slate-400"> {unit}</span>}
      </span>
    </div>
  );
}

/** How much faster the swarm's plan got casualties to a bed, or null if it wasn't faster. */
function speedup(sim: Simulation) {
  const { coordinated: c, nearest: n } = sim.comparison;
  if (c.avg_to_bed_min >= n.avg_to_bed_min) return null;
  return {
    minutes: n.avg_to_bed_min - c.avg_to_bed_min,
    percent: Math.round((1 - c.avg_to_bed_min / n.avg_to_bed_min) * 100),
    fewerWaiting: n.without_bed - c.without_bed,
  };
}

/**
 * The what-if simulator: place an incident, choose its size, then compare the swarm's plan with
 * sending everyone to the nearest trauma center. Pair with SimulationTimeline on the map.
 */
export function SimulationPanel({
  sim,
  hospitals,
  recorded = false,
  className = "",
}: {
  sim: SimulationState;
  /** Hospitals in the current frame, for names and live status. */
  hospitals: Hospital[];
  /** True when the data source is a recording: the recorded scenario plays wherever you click. */
  recorded?: boolean;
  className?: string;
}) {
  const byId = Object.fromEntries(hospitals.map((h) => [h.id, h]));
  const result = sim.result;
  const gain = result ? speedup(result) : null;

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[#e6e0d2] px-5 py-4">
        <div>
          <p className="text-sm text-ink-soft">What if it happened now?</p>
          <h2 className="mt-0.5 text-lg font-bold text-ink">
            {result ? `${result.incident.casualties} casualties, ${result.assignments.length} hospitals` : "Mass casualty incident"}
          </h2>
        </div>
        <button type="button" onClick={sim.exit} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-900">
          Exit
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sim.phase === "placing" && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-900">Click anywhere on the map</p>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              That&apos;s where the incident happens. The swarm will decide where every casualty should go, based on how full each
              hospital is right now.
            </p>
          </div>
        )}

        {(sim.phase === "ready" || sim.phase === "error" || sim.phase === "loading") && (
          <div className="space-y-4 px-4 py-4">
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="emf-casualties" className="text-[13px] font-medium text-slate-700">
                  Casualties
                </label>
                <span className="text-lg font-semibold tabular-nums text-slate-900">{sim.casualties}</span>
              </div>
              <input
                id="emf-casualties"
                type="range"
                min={5}
                max={120}
                step={5}
                value={sim.casualties}
                onChange={(e) => sim.setCasualties(Number(e.target.value))}
                className="mt-2 w-full accent-[#111111]"
              />
              <div className="mt-2 flex gap-1.5">
                {CASUALTY_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => sim.setCasualties(n)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition ${sim.casualties === n ? "bg-ink text-white ring-ink" : "text-ink-soft ring-[#e6e0d2] hover:bg-vanilla"}`}
                  >
                    {n === 15 ? "Bus crash · 15" : n === 40 ? "Pileup · 40" : "Stadium · 80"}
                  </button>
                ))}
              </div>
            </div>
            {recorded && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                This uses a recorded run: 60 casualties at the stadium downtown, wherever you click.
              </p>
            )}
            {sim.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{sim.error}</p>}
            <button
              type="button"
              onClick={sim.run}
              disabled={sim.phase === "loading"}
              className="w-full rounded-xl bg-ink px-3 py-3 text-sm font-semibold text-white transition disabled:opacity-70"
            >
              {sim.phase === "loading" ? "Simulating every hospital…" : "Run simulation"}
            </button>
            <p className="text-center text-xs text-slate-400">Click the map again to move the incident.</p>
          </div>
        )}

        {result && (sim.phase === "playing" || sim.phase === "paused") && (
          <div className="px-4 py-4">
            {gain && (
              <div className="emf-pop card-dark mb-4 rounded-2xl px-5 py-4">
                <p className="text-sm text-white/70">With EmerFlow sharing the patients out</p>
                <p className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums tracking-tight">{gain.percent}%</span>
                  <span className="text-base text-white">faster to a bed</span>
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {gain.minutes} min sooner on average
                  {gain.fewerWaiting > 0 && ` · ${gain.fewerWaiting} fewer still waiting after 3 h`}
                </p>
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 border-b border-slate-100 pb-1.5 text-[11px] font-medium text-slate-400">
              <span>After 3 hours</span>
              <span className="text-right text-ink">EmerFlow</span>
              <span className="text-right">Nearest only</span>
            </div>
            <Stat label="Avg. time to a bed" a={result.comparison.coordinated.avg_to_bed_min} b={result.comparison.nearest.avg_to_bed_min} />
            <Stat label="Longest wait" a={result.comparison.coordinated.longest_to_bed_min} b={result.comparison.nearest.longest_to_bed_min} />
            <Stat label="Still without a bed" a={result.comparison.coordinated.without_bed} b={result.comparison.nearest.without_bed} unit="" />
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              &ldquo;Nearest only&rdquo; sends every casualty to {result.comparison.nearest.hospital}, the closest trauma center.
            </p>


            <p className="mt-4 text-xs font-medium text-slate-700">Where the swarm sent them</p>
            <ul className="mt-1 divide-y divide-slate-100">
              {result.assignments.map((a) => {
                const h = byId[a.hospital_id];
                if (!h) return null;
                return (
                  <li key={a.hospital_id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full transition-colors" style={{ background: STATUS[h.status].color }} />
                      <span className="truncate text-slate-700">{h.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      <b className="font-semibold text-slate-900">{a.casualties}</b>
                      {a.severe > 0 && <span className="text-red-600"> · {a.severe} severe</span>} · {a.drive_min} min
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Play/pause and a scrubber for a finished simulation. Designed to sit over the bottom of the map. */
export function SimulationTimeline({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  const result = sim.result;
  if (!result || (sim.phase !== "playing" && sim.phase !== "paused")) return null;
  const f = result.frames[sim.frame];
  const playing = sim.phase === "playing";
  return (
    <div className={`card-dark flex items-center gap-3 rounded-2xl px-3 py-2.5 ${className}`}>
      <button
        type="button"
        onClick={playing ? sim.pause : sim.play}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-ink"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 size-3.5" fill="currentColor" aria-hidden>
            <path d="M7 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 7 5.5Z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold tabular-nums">
            {f.minute === 0 ? "Incident" : `+${f.minute >= 60 ? `${Math.floor(f.minute / 60)}h ${f.minute % 60 ? `${f.minute % 60}m` : ""}` : `${f.minute} min`}`}
          </span>
          <span className="tabular-nums text-slate-300">
            {f.without_bed.coordinated} without a bed · <span className="text-red-300">{f.without_bed.nearest} if nearest only</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={result.frames.length - 1}
          value={sim.frame}
          onChange={(e) => sim.seek(Number(e.target.value))}
          aria-label="Time since incident"
          className="mt-1 w-full accent-white"
        />
      </div>
    </div>
  );
}

/** A callout for the end of the playback: the result in one line. Sits over the map. */
export function SimulationVerdict({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  const result = sim.result;
  if (!result || sim.phase !== "paused" || sim.frame < result.frames.length - 1) return null;
  const s = speedup(result);
  return (
    <div className={`emf-pop glass flex items-center gap-3 rounded-2xl px-4 py-3 ${className}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-white ${s ? "bg-jade" : "bg-slate-400"}`}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12 5 5L20 7" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">
          {s ? `${s.percent}% faster to a bed with EmerFlow` : "Same outcome as sending everyone to the nearest trauma center"}
        </p>
        <p className="text-xs text-slate-500">
          {s
            ? `${result.comparison.coordinated.avg_to_bed_min} min on average vs ${result.comparison.nearest.avg_to_bed_min} min if everyone went to ${result.comparison.nearest.hospital}`
            : "Coordination didn't change waits for this incident."}
        </p>
      </div>
    </div>
  );
}
