// A what-if incident worked out in the browser, from the hospitals on the map right now.
// Casualties are triaged into three groups (urgent, can wait, minor), leave the scene a few at a time,
// drive to a hospital, and get an ER bed when one is free.
// Where each group goes follows a dispatch plan (the Gemini dispatcher's ranked hospitals, or rulePlan()),
// but code does all the counting and keeps the rules: urgent patients only go to trauma centers, and
// nobody is sent somewhere much slower than the best choice.
// Compared with sending everyone to the nearest trauma center. An estimate for a demo, not a plan.

import { driveMinutes, miles } from "./geo";
import type { Hospital, LatLon, Simulation, SimulationOutcome, Status, TriageGroup } from "./types";

const HORIZON = 180; // minutes shown
const STEP = 10; // minutes per frame
const MIX = [0.1, 0.18, 0.42, 0.18, 0.12]; // severity 1 (worst) … 5
const SLACK = 20; // minutes: a planned hospital may be this much slower than the best one, no more
export const GROUPS: TriageGroup[] = ["urgent", "delayed", "minor"];

export type DispatchPlan = {
  how: string;
  briefing: string;
  urgent: { hospitals: string[]; why: string };
  delayed: { hospitals: string[]; why: string };
  minor: { hospitals: string[]; why: string };
};

type Patient = { sev: number; group: TriageGroup; depart: number };
type Placed = Patient & { hospital: string; arrive: number; bed: number };
type Option = { h: Hospital; arrive: number; bed: number };

export const groupOf = (sev: number): TriageGroup => (sev <= 2 ? "urgent" : sev === 3 ? "delayed" : "minor");

function severityCounts(n: number) {
  const c = MIX.map((p) => Math.floor(p * n));
  c[2] += n - c.reduce((a, b) => a + b, 0);
  return c;
}

export function triage(casualties: number): Record<TriageGroup, number> {
  const c = severityCounts(casualties);
  return { urgent: c[0] + c[1], delayed: c[2], minor: c[3] + c[4] };
}

/** ER beds freed every STEP minutes. */
const turnover = (h: Hospital) => Math.max(1, Math.round(h.er.capacity / 25));

/** Minutes at which each successive ER bed frees up at a hospital, for incoming casualties. */
function bedTimes(h: Hospital) {
  const free = Math.max(0, h.er.capacity - h.er.occupied - h.er.waiting);
  // ERs turn beds over through the day, and surge a few extra beds once the incident is declared.
  const perStep = turnover(h);
  const surge = Math.ceil(h.er.capacity * 0.1);
  const times: number[] = Array(free).fill(0);
  for (let i = 0; i < surge; i++) times.push(20);
  for (let t = STEP; t <= 600; t += STEP) for (let i = 0; i < perStep; i++) times.push(t);
  return times.sort((a, b) => a - b);
}

const canTake = (group: TriageGroup, h: Hospital, anyTrauma: boolean) => group !== "urgent" || !!h.trauma || !anyTrauma;

/** Dispatch without AI: urgent to the closest trauma centers, the rest to the closest ERs that aren't full,
 *  minor injuries a little further out so the closest beds stay free. Mirrors backend rule_plan(). */
export function rulePlan(point: LatLon, hospitals: Hospital[], casualties: number): DispatchPlan {
  const drive = (h: Hospital) => driveMinutes(miles(point, [h.lat, h.lon]));
  const anyTrauma = hospitals.some((h) => h.trauma);
  const ranked = (g: TriageGroup) => {
    const pool = hospitals.filter((h) => canTake(g, h, anyTrauma));
    const open = pool.filter((h) => h.status !== "critical");
    const order = [...(open.length ? open : pool)].sort((a, b) =>
      g === "minor" ? Number(a.status !== "open") - Number(b.status !== "open") || drive(a) - drive(b) : drive(a) - drive(b),
    );
    const top = g === "minor" && order.length > 3 ? [...order.slice(1, 4), order[0]] : order;
    return top.slice(0, 4).map((h) => h.id);
  };
  const t = triage(casualties);
  const u = ranked("urgent");
  const first = hospitals.find((h) => h.id === u[0])?.name ?? "the nearest trauma center";
  return {
    how: "rules",
    briefing: `${t.urgent} badly hurt people go first, to trauma centers such as ${first}. ${t.delayed} people who can wait a little and ${t.minor} with minor injuries are spread over other nearby ERs so no single hospital is swamped.`,
    urgent: { hospitals: u, why: "The closest trauma centers, because these patients need surgery-ready care fast." },
    delayed: { hospitals: ranked("delayed"), why: "The closest emergency rooms that still have room." },
    minor: { hospitals: ranked("minor"), why: "Emergency rooms a little further away, so the closest beds stay free for sicker patients." },
  };
}

function makeQueue(hospitals: Hospital[], point: LatLon) {
  const beds = Object.fromEntries(hospitals.map((h) => [h.id, bedTimes(h)]));
  const taken: Record<string, number[]> = Object.fromEntries(hospitals.map((h) => [h.id, []]));
  const drive = Object.fromEntries(hospitals.map((h) => [h.id, driveMinutes(miles(point, [h.lat, h.lon]))]));
  /** When one more person arriving at `arrive` would get a bed at h, given who is already headed there. */
  const bedAt = (h: Hospital, arrive: number) => {
    const arrivals = [...taken[h.id], arrive].sort((a, b) => a - b);
    const i = arrivals.lastIndexOf(arrive);
    return Math.max(arrive, beds[h.id][i] ?? Infinity);
  };
  return { beds, taken, drive, bedAt };
}

function place(patients: Patient[], hospitals: Hospital[], point: LatLon, choose: (p: Patient, options: Option[]) => Hospital) {
  const q = makeQueue(hospitals, point);
  const placed: Placed[] = [];
  for (const p of patients) {
    const options = hospitals.map((h) => {
      const arrive = p.depart + q.drive[h.id];
      return { h, arrive, bed: q.bedAt(h, arrive) };
    });
    const h = choose(p, options);
    const arrive = p.depart + q.drive[h.id];
    q.taken[h.id].push(arrive);
    placed.push({ ...p, hospital: h.id, arrive, bed: 0 });
  }
  // Final bed times: first come, first served, sickest first on a tie.
  for (const h of hospitals) {
    const here = placed.filter((x) => x.hospital === h.id).sort((a, b) => a.arrive - b.arrive || a.sev - b.sev);
    here.forEach((x, i) => (x.bed = Math.max(x.arrive, q.beds[h.id][i] ?? Infinity)));
  }
  return { placed, q };
}

function outcome(placed: Placed[]): SimulationOutcome {
  const within = placed.map((p) => Math.min(p.bed, HORIZON));
  return {
    avg_to_bed_min: Math.round(within.reduce((a, b) => a + b, 0) / Math.max(1, placed.length)),
    longest_to_bed_min: Math.round(Math.max(0, ...within)),
    without_bed: placed.filter((p) => p.bed > HORIZON).length,
  };
}

function statusOf(occupied: number, capacity: number, waiting: number): Status {
  if (waiting > 0 || occupied >= capacity) return "critical";
  return occupied / capacity >= 0.85 ? "busy" : "open";
}

export function simulateLocal(
  { lat, lon, casualties }: { lat: number; lon: number; casualties: number },
  hospitals: Hospital[],
  plan?: DispatchPlan,
): Simulation {
  const point: LatLon = [lat, lon];
  const counts = severityCounts(casualties);
  const dispatch = plan ?? rulePlan(point, hospitals, casualties);
  // Worst first; four ambulances leave the scene every three minutes.
  const patients: Patient[] = counts
    .flatMap((n, i) => Array(n).fill(i + 1))
    .map((sev, k) => ({ sev, group: groupOf(sev), depart: 3 + Math.floor(k / 4) * 3 }));
  const anyTrauma = hospitals.some((h) => h.trauma);

  // The plan's hospitals for this group, in its order; code keeps the rules and never picks a much slower bed.
  const shared = place(patients, hospitals, point, (p, options) => {
    const allowed = options.filter((o) => canTake(p.group, o.h, anyTrauma));
    const notFull = allowed.filter((o) => o.h.status !== "critical");
    const pool = notFull.length ? notFull : allowed;
    const best = Math.min(...pool.map((o) => o.bed));
    const planned = dispatch[p.group].hospitals
      .map((id) => allowed.find((o) => o.h.id === id))
      .filter((o): o is Option => !!o && o.bed <= best + SLACK);
    if (planned.length) return planned.sort((a, b) => a.bed - b.bed)[0].h;
    return pool.sort((a, b) => a.bed - b.bed || a.arrive - b.arrive)[0].h;
  });
  const trauma = hospitals.filter((h) => h.trauma);
  const nearestHospital = [...(trauma.length ? trauma : hospitals)].sort((a, b) => miles(point, [a.lat, a.lon]) - miles(point, [b.lat, b.lon]))[0];
  const nearest = place(patients, hospitals, point, () => nearestHospital);

  const assignments = hospitals
    .map((h) => {
      const here = shared.placed.filter((p) => p.hospital === h.id);
      const groups = Object.fromEntries(GROUPS.map((g) => [g, here.filter((p) => p.group === g).length])) as Record<TriageGroup, number>;
      return { hospital_id: h.id, casualties: here.length, severe: groups.urgent, drive_min: shared.q.drive[h.id], groups };
    })
    .filter((a) => a.casualties > 0)
    .sort((a, b) => b.groups.urgent - a.groups.urgent || b.casualties - a.casualties);

  const groups = Object.fromEntries(
    GROUPS.map((g) => {
      const mine = shared.placed.filter((p) => p.group === g);
      return [g, { count: mine.length, avg_to_bed_min: outcome(mine).avg_to_bed_min }];
    }),
  ) as Record<TriageGroup, { count: number; avg_to_bed_min: number }>;

  // One more person leaving the crash now: how soon would each hospital give them a bed?
  const waits = hospitals
    .map((h) => {
      const arrive = 3 + shared.q.drive[h.id];
      const bed = shared.q.bedAt(h, arrive);
      return { hospital_id: h.id, to_bed_min: Math.round(bed), door_wait_min: Math.round(bed - arrive), trauma: !!h.trauma };
    })
    .filter((w) => Number.isFinite(w.to_bed_min));

  const frames = [];
  for (let t = 0; t <= HORIZON; t += STEP) {
    const in_transit: Record<string, number> = {};
    const frameHospitals = hospitals.map((h) => {
      const here = shared.placed.filter((p) => p.hospital === h.id);
      const driving = here.filter((p) => p.depart <= t && p.arrive > t).length;
      if (driving) in_transit[h.id] = driving;
      const bedded = here.filter((p) => p.bed <= t).length;
      const waiting = h.er.waiting + here.filter((p) => p.arrive <= t && p.bed > t).length;
      // Beds keep turning over; about half of the freed beds go to the ER's everyday patients.
      const freed = Math.floor((turnover(h) * Math.floor(t / STEP)) / 2);
      const occupied = Math.min(h.er.capacity, Math.max(0, h.er.occupied + bedded - freed));
      const status = statusOf(occupied, h.er.capacity, waiting);
      return {
        ...h,
        er: { ...h.er, occupied, waiting },
        status,
        er_wait_min: status === "critical" ? 40 + waiting * 3 : status === "busy" ? 25 : 10,
        receiving_incident: here.length > 0,
      };
    });
    frames.push({
      minute: t,
      hospitals: frameHospitals,
      in_transit,
      without_bed: {
        coordinated: shared.placed.filter((p) => p.bed > t).length,
        nearest: nearest.placed.filter((p) => p.bed > t).length,
      },
    });
  }

  return {
    generated_at: new Date().toISOString(),
    simulated: true,
    incident: { lat, lon, casualties, seed: 0, severity_mix: Object.fromEntries(counts.map((n, i) => [String(i + 1), n])) },
    assignments,
    frames,
    groups,
    waits,
    dispatcher: {
      how: dispatch.how,
      briefing: dispatch.briefing,
      why: { urgent: dispatch.urgent.why, delayed: dispatch.delayed.why, minor: dispatch.minor.why },
      moved: Object.fromEntries(
        GROUPS.map((g) => [g, shared.placed.filter((p) => p.group === g && !dispatch[g].hospitals.includes(p.hospital)).length]),
      ) as Record<TriageGroup, number>,
    },
    comparison: {
      coordinated: outcome(shared.placed),
      nearest: { ...outcome(nearest.placed), hospital_id: nearestHospital.id, hospital: nearestHospital.name },
    },
  };
}
