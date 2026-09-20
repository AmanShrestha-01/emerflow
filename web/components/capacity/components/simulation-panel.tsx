"use client";

import "../effects.css";
import { MapPin, Play, RotateCcw, Users } from "lucide-react";
import { STATUS, miles } from "../geo";
import type { SimulationState } from "../use-simulation";
import type { Hospital, LatLon, Simulation, TriageGroup } from "../types";

const SIZES = [
  { n: 15, label: "Small", sub: "a bus crash" },
  { n: 40, label: "Large", sub: "a highway pileup" },
  { n: 80, label: "Huge", sub: "a stadium crowd" },
];

/** Ready-made incidents, so nobody has to guess where to click. */
export const EXAMPLES: { title: string; where: string; point: LatLon; casualties: number }[] = [
  { title: "Stadium crowd crush", where: "M&T Bank Stadium, downtown", point: [39.278, -76.6227], casualties: 80 },
  { title: "Highway pileup", where: "I-95 near the Fort McHenry tunnel", point: [39.2615, -76.5795], casualties: 40 },
  { title: "Bus crash", where: "York Road in Towson", point: [39.4015, -76.6019], casualties: 15 },
];

function mins(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
}

/** "0.8 mi from Mercy Medical Center": a place name for a click on the map. */
function whereIs(point: LatLon, hospitals: Hospital[]) {
  const near = hospitals.map((h) => ({ h, d: miles(point, [h.lat, h.lon]) })).sort((a, b) => a.d - b.d)[0];
  return near ? `${near.d.toFixed(1)} mi from ${near.h.name}` : "On the map";
}

function Steps({ at }: { at: 1 | 2 | 3 }) {
  const steps = ["Pick a spot", "How many hurt", "See what happens"];
  return (
    <ol className="flex gap-1.5 px-5 pt-4">
      {steps.map((s, i) => {
        const n = i + 1;
        const on = n === at;
        const done = n < at;
        return (
          <li key={s} className="flex-1">
            <span className={`block h-1 rounded-full ${done || on ? "bg-ink" : "bg-[#e6e0d2]"}`} />
            <span className={`mt-1.5 block text-[11px] font-semibold ${on ? "text-ink" : "text-ink-soft"}`}>
              {n}. {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Compare({ result }: { result: Simulation }) {
  const { coordinated: c, nearest: n } = result.comparison;
  const rows = [
    { k: "Average time to a bed", a: mins(c.avg_to_bed_min), b: mins(n.avg_to_bed_min), better: c.avg_to_bed_min < n.avg_to_bed_min },
    { k: "Longest anyone waited", a: mins(c.longest_to_bed_min), b: n.without_bed ? "3 h +" : mins(n.longest_to_bed_min), better: c.longest_to_bed_min < n.longest_to_bed_min },
    { k: "Still no bed after 3 h", a: String(c.without_bed), b: String(n.without_bed), better: c.without_bed < n.without_bed },
  ];
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-[#e6e0d2]">
      <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2 bg-vanilla px-3 py-2 text-[11px] font-semibold leading-tight text-ink-soft">
        <span />
        <span className="text-right text-ink">Spread out</span>
        <span className="text-right">All to one hospital</span>
      </div>
      {rows.map((r) => (
        <div key={r.k} className="grid grid-cols-[minmax(0,1fr)_80px_80px] items-baseline gap-2 border-t border-[#efe9dc] px-3 py-2 text-[13px]">
          <span className="text-ink-soft">{r.k}</span>
          <span className={`text-right font-bold tabular-nums ${r.better ? "text-jade-deep" : "text-ink"}`}>{r.a}</span>
          <span className="text-right tabular-nums text-ink-soft">{r.b}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The what-if simulator in three steps: pick a spot (or an example), pick how many people are hurt,
 * then watch where the ambulances go and how long it takes everyone to get an ER bed.
 */
export function SimulationPanel({
  sim,
  hospitals,
  className = "",
}: {
  sim: SimulationState;
  /** Hospitals in the current frame, for names and live status. */
  hospitals: Hospital[];
  recorded?: boolean;
  className?: string;
}) {
  const byId = Object.fromEntries(hospitals.map((h) => [h.id, h]));
  const result = sim.result;
  const showing = !!result && (sim.phase === "playing" || sim.phase === "paused");
  const step: 1 | 2 | 3 = showing ? 3 : sim.phase === "placing" ? 1 : 2;

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[#e6e0d2] px-5 py-4">
        <div>
          <p className="text-sm text-ink-soft">What if a big crash happened now?</p>
          <h2 className="mt-0.5 text-lg font-bold text-ink">Crash simulator</h2>
        </div>
        <button type="button" onClick={sim.exit} className="rounded-lg px-2.5 py-1 text-sm font-semibold text-ink-soft ring-1 ring-[#e6e0d2] hover:bg-vanilla hover:text-ink">
          Close
        </button>
      </div>
      <Steps at={step} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === 1 && (
          <div className="space-y-4 px-5 py-4">
            <div className="flex items-start gap-3 rounded-xl bg-vanilla p-4">
              <MapPin className="mt-0.5 size-5 shrink-0 text-critical" />
              <p className="text-[15px] leading-relaxed text-ink">
                <b>Click anywhere on the map</b> to put the crash there. We&apos;ll work out which hospital each hurt person should go to.
              </p>
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Or try an example</p>
            <div className="space-y-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e.title}
                  type="button"
                  onClick={() => sim.choose(e.point, e.casualties)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-[#e6e0d2] hover:bg-vanilla"
                >
                  <span>
                    <span className="block font-semibold text-ink">{e.title}</span>
                    <span className="block text-xs text-ink-soft">{e.where}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-soft">{e.casualties} hurt</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 px-5 py-4">
            <div className="flex items-start gap-3 rounded-xl bg-vanilla p-4">
              <MapPin className="mt-0.5 size-5 shrink-0 text-critical" />
              <div>
                <p className="font-semibold text-ink">Crash placed</p>
                <p className="text-sm text-ink-soft">{sim.point ? whereIs(sim.point, hospitals) : ""}</p>
                <p className="mt-1 text-xs text-ink-soft">Click the map again to move it.</p>
              </div>
            </div>

            <div>
              <p className="font-semibold text-ink">How many people are hurt?</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s.n}
                    type="button"
                    onClick={() => sim.setCasualties(s.n)}
                    className={`rounded-xl px-2 py-2.5 text-center ring-1 transition ${sim.casualties === s.n ? "bg-ink text-white ring-ink" : "text-ink ring-[#e6e0d2] hover:bg-vanilla"}`}
                  >
                    <span className="block text-lg font-bold tabular-nums">{s.n}</span>
                    <span className={`block text-[11px] ${sim.casualties === s.n ? "text-white/70" : "text-ink-soft"}`}>{s.sub}</span>
                  </button>
                ))}
              </div>
              <label htmlFor="emf-casualties" className="mt-4 flex items-baseline justify-between text-sm text-ink-soft">
                <span>Or set your own number</span>
                <span className="text-base font-bold tabular-nums text-ink">{sim.casualties} people</span>
              </label>
              <input
                id="emf-casualties"
                type="range"
                min={5}
                max={120}
                step={5}
                value={sim.casualties}
                onChange={(e) => sim.setCasualties(Number(e.target.value))}
                className="mt-1 w-full accent-[#111111]"
              />
            </div>

            {sim.error && <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">{sim.error}</p>}
            <button
              type="button"
              onClick={sim.run}
              disabled={sim.phase === "loading" || !sim.point}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 py-3 text-sm font-semibold text-white transition disabled:opacity-70"
            >
              <Play className="size-3.5 fill-current" />
              {sim.phase === "loading" ? "The AI dispatcher is planning…" : "Run the simulation"}
            </button>
          </div>
        )}

        {showing && result && <Results result={result} byId={byId} sim={sim} />}
      </div>
    </div>
  );
}


/** Triage groups, in the colors crews use: red = needs care now, yellow = can wait a little, green = minor. */
export const TRIAGE: Record<TriageGroup, { label: string; sub: string; color: string; soft: string }> = {
  urgent: { label: "Urgent", sub: "Life-threatening. Needs a trauma center now.", color: "#dc2626", soft: "#fdecea" },
  delayed: { label: "Can wait a little", sub: "Serious, but stable for now.", color: "#d97706", soft: "#fdf3e1" },
  minor: { label: "Minor injuries", sub: "Cuts, sprains, bruises. Can walk.", color: "#059669", soft: "#e6f5ee" },
};
const ORDER: TriageGroup[] = ["urgent", "delayed", "minor"];

function Chips({ groups }: { groups?: Record<TriageGroup, number> }) {
  if (!groups) return null;
  return (
    <span className="flex gap-1">
      {ORDER.filter((g) => groups[g] > 0).map((g) => (
        <span key={g} className="rounded-md px-1.5 text-[11px] font-bold tabular-nums text-white" style={{ background: TRIAGE[g].color }} title={TRIAGE[g].label}>
          {groups[g]}
        </span>
      ))}
    </span>
  );
}

function Results({ result, byId, sim }: { result: Simulation; byId: Record<string, Hospital>; sim: SimulationState }) {
  const d = result.dispatcher;
  const ai = d && (d.how === "live" || d.how === "replay");
  const most = Math.max(...result.assignments.map((a) => a.casualties), 1);
  const name = (id: string) => byId[id]?.name ?? id;
  // Only hospitals an ambulance from this crash would really consider (under ~30 min away).
  const nearby = (result.waits ?? []).filter((w) => w.to_bed_min - w.door_wait_min <= 33);
  const quickest = nearby.filter((w) => w.trauma).sort((a, b) => a.to_bed_min - b.to_bed_min).slice(0, 3);
  const longest = [...nearby].sort((a, b) => b.door_wait_min - a.door_wait_min).slice(0, 3);
  const c = result.comparison.coordinated;

  return (
    <div className="space-y-5 px-5 py-4">
      <div className="emf-pop card-dark rounded-2xl px-5 py-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/60">
          <Users className="size-3.5" /> Where everyone is going
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-white">
          {result.incident.casualties} hurt · {result.assignments.length} hospitals ·{" "}
          {c.without_bed === 0 ? `everyone in a bed within ${mins(c.longest_to_bed_min)}` : `${c.without_bed} still waiting after 3 h`}
        </p>
      </div>

      <div>
        <p className="font-semibold text-ink">Who needs what</p>
        <div className="mt-2 space-y-2">
          {ORDER.map((g) => {
            const grp = result.groups?.[g];
            if (!grp || grp.count === 0) return null;
            const to = result.assignments.filter((a) => (a.groups?.[g] ?? 0) > 0).sort((a, b) => (b.groups?.[g] ?? 0) - (a.groups?.[g] ?? 0));
            return (
              <div key={g} className="rounded-xl border-l-4 p-3" style={{ borderColor: TRIAGE[g].color, background: TRIAGE[g].soft }}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-bold text-ink">
                    {TRIAGE[g].label} <span className="tabular-nums">· {grp.count} people</span>
                  </p>
                  <p className="shrink-0 text-xs text-ink-soft">bed in ~{mins(grp.avg_to_bed_min)}</p>
                </div>
                <p className="text-xs text-ink-soft">{TRIAGE[g].sub}</p>
                <p className="mt-1.5 text-[13px] text-ink">
                  <b>Going to:</b> {to.map((a) => `${name(a.hospital_id)} (${a.groups?.[g]})`).join(", ")}
                </p>
                {d?.why[g] && <p className="mt-1 text-xs italic text-ink-soft">{ai ? "AI: " : ""}{d.why[g]}</p>}
                {(d?.moved?.[g] ?? 0) > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">
                    Software changed {d!.moved[g]} of these to other ERs: the planned ones would have made them wait too long.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="font-semibold text-ink">Where the ambulances go</p>
        <ul className="mt-2 space-y-2.5">
          {result.assignments.map((a) => {
            const h = byId[a.hospital_id];
            if (!h) return null;
            return (
              <li key={a.hospital_id} className="text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full transition-colors" style={{ background: STATUS[h.status].color }} />
                    <span className="truncate font-medium text-ink">{h.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-soft">
                    <b className="text-ink">{a.casualties}</b> · {a.drive_min} min drive
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-4">
                  <span className="flex h-2 overflow-hidden rounded-full" style={{ width: `${Math.max(8, (a.casualties / most) * 100)}%` }}>
                    {ORDER.map((g) => (
                      <span key={g} style={{ flex: a.groups?.[g] ?? 0, background: TRIAGE[g].color }} />
                    ))}
                  </span>
                  <Chips groups={a.groups} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-3">
        <div className="rounded-xl p-3 ring-1 ring-[#e6e0d2]">
          <p className="text-sm font-bold text-ink">Quickest urgent care</p>
          <p className="text-[11px] text-ink-soft">Trauma centers, for one more badly hurt person leaving now</p>
          <ol className="mt-2 space-y-1.5">
            {quickest.map((w, i) => (
              <li key={w.hospital_id} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="min-w-0 text-ink">{i + 1}. {name(w.hospital_id)}</span>
                <b className="shrink-0 tabular-nums text-jade-deep">{mins(w.to_bed_min)}</b>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-xl p-3 ring-1 ring-[#e6e0d2]">
          <p className="text-sm font-bold text-ink">Longest waits</p>
          <p className="text-[11px] text-ink-soft">Time from reaching the ER door to getting a bed</p>
          {longest[0]?.door_wait_min ? (
          <ol className="mt-2 space-y-1.5">
            {longest.map((w) => (
              <li key={w.hospital_id} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="min-w-0 text-ink">{name(w.hospital_id)}</span>
                <b className={`shrink-0 tabular-nums ${w.door_wait_min >= 30 ? "text-critical" : "text-ink"}`}>{w.door_wait_min ? mins(w.door_wait_min) : "no wait"}</b>
              </li>
            ))}
          </ol>
          ) : (
            <p className="mt-2 text-[13px] text-jade-deep">No ER near the crash would make someone wait for a bed right now.</p>
          )}
        </div>
      </div>

      <div>
        <p className="font-semibold text-ink">Spread out vs all to one hospital</p>
        <p className="mb-2 text-xs text-ink-soft">
          &ldquo;All to one hospital&rdquo; sends everyone to the nearest trauma center, {result.comparison.nearest.hospital}.
        </p>
        <Compare result={result} />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={sim.play} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink ring-1 ring-[#e6e0d2] hover:bg-vanilla">
          <RotateCcw className="size-3.5" /> Replay
        </button>
        <button type="button" onClick={sim.begin} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-sm font-semibold text-white">
          <MapPin className="size-3.5" /> Try another spot
        </button>
      </div>
      <p className="text-xs leading-relaxed text-ink-soft">
        A simulated estimate, not a plan. {ai ? "The AI picks hospitals for each group; software checks every pick and does all the counting." : ""} Ambulance crews and
        hospitals make the real calls.
      </p>
    </div>
  );
}

/** Play/pause and a scrubber for a finished simulation. Designed to sit over the bottom of the map. */
export function SimulationTimeline({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  const result = sim.result;
  if (!result || (sim.phase !== "playing" && sim.phase !== "paused")) return null;
  const f = result.frames[sim.frame];
  const playing = sim.phase === "playing";
  const waiting = f.without_bed.coordinated;
  return (
    <div className={`card-dark flex items-center gap-3 rounded-2xl px-4 py-3 ${className}`}>
      <button
        type="button"
        onClick={playing ? sim.pause : sim.play}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-ink"
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
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="font-semibold tabular-nums">{f.minute === 0 ? "The crash happens" : `${mins(f.minute)} after the crash`}</span>
          <span className="tabular-nums text-white/80">
            {waiting === 0 ? "Everyone has a bed" : `${waiting} still waiting for a bed`}
            <span className="text-white/50"> · {f.without_bed.nearest} if all to one hospital</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={result.frames.length - 1}
          value={sim.frame}
          onChange={(e) => sim.seek(Number(e.target.value))}
          aria-label="Time since the crash"
          className="mt-1.5 w-full accent-white"
        />
      </div>
    </div>
  );
}

/** How to read the map during a simulation. Sits over the map. */
export function SimulationKey({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  if (!sim.result || (sim.phase !== "playing" && sim.phase !== "paused")) return null;
  return (
    <div className={`glass rounded-xl px-3 py-2 text-xs text-ink ${className}`}>
      <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-critical ring-2 ring-critical/30" /> The crash</p>
      <p className="mt-1 flex items-center gap-1.5">
        {ORDER.map((g) => <span key={g} className="rounded px-1 text-[10px] font-bold text-white" style={{ background: TRIAGE[g].color }}>{g === "urgent" ? "Urgent" : g === "delayed" ? "Can wait" : "Minor"}</span>)}
      </p>
      <p className="mt-1 text-ink-soft">Lines are ambulance routes, colored by the most urgent patients on them.</p>
      <p className="mt-1 text-ink-soft">Dots turn amber, then red, as ERs fill.</p>
    </div>
  );
}

/** A callout for the end of the playback: the result in one line. Sits over the map. */
export function SimulationVerdict({ sim, className = "" }: { sim: SimulationState; className?: string }) {
  const result = sim.result;
  if (!result || sim.phase !== "paused" || sim.frame < result.frames.length - 1) return null;
  const { coordinated: c, nearest: n } = result.comparison;
  const faster = c.avg_to_bed_min < n.avg_to_bed_min;
  return (
    <div className={`emf-pop glass flex items-center gap-3 rounded-2xl px-4 py-3 ${className}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-white ${faster ? "bg-jade" : "bg-slate-400"}`}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12 5 5L20 7" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          {faster ? `Spreading patients out: a bed in ${mins(c.avg_to_bed_min)} on average` : "Spreading out didn't change the wait this time"}
        </p>
        <p className="text-xs text-ink-soft">
          {faster ? `vs ${mins(n.avg_to_bed_min)} if everyone went to ${n.hospital}` : "The nearest trauma center had room for everyone."}
        </p>
      </div>
    </div>
  );
}
