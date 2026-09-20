"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Ambulance, BedDouble, Building2, Clock3, CloudLightning, ExternalLink, LocateFixed, Siren, Users } from "lucide-react"
import { Nav } from "@/components/emer/nav"
import { TextReveal } from "@/components/ui/text-reveal"
import { CapacityMap } from "@/components/capacity/components/capacity-map"
import { SimulationKey, SimulationPanel, SimulationTimeline, SimulationVerdict } from "@/components/capacity/components/simulation-panel"
import { IncidentHandoff } from "@/components/emer/incident-handoff"
import { DEMO_INCIDENT } from "@/lib/emer/incident"
import { StatusLegend } from "@/components/capacity/components/status-legend"
import { countByStatus, directionsUrl, formatTime, formatWait, miles, rankHospitals, type RankedHospital } from "@/components/capacity/geo"
import { recordedSource, swarmSource, withFallback, type RegionSource } from "@/components/capacity/sources"
import { simulateLocal } from "@/components/capacity/simulate-local"
import { dispatchPlan } from "@/lib/emer/dispatch"
import type { Hospital, LatLon, SortBy, Status } from "@/components/capacity/types"
import { useLocation } from "@/components/capacity/use-location"
import { useRegion } from "@/components/capacity/use-region"
import { useSimulation } from "@/components/capacity/use-simulation"
import { useWeatherAlerts } from "@/components/capacity/use-weather-alerts"
import { OUR_HOSPITAL_ID, withOurHospital } from "@/lib/emer/capacity"
import { CMS_PERIOD, withCmsHospitals, withEdas } from "@/lib/emer/cms"
import { useEdas } from "@/lib/emer/use-edas"
import { useHospital } from "@/lib/emer/hospital"

// Robert's capacity map (github.com/RobertxPearce/emerflow, capacity-map) with our own text and template.
// Data: his swarm server if NEXT_PUBLIC_SWARM_URL is set, otherwise his recorded Baltimore snapshot.
const SWARM_URL = process.env.NEXT_PUBLIC_SWARM_URL
const source = SWARM_URL ? withFallback(swarmSource({ url: SWARM_URL })) : recordedSource()
// Without Robert's server, what-ifs are worked out in the browser from the hospitals on the map
// (components/capacity/simulate-local.ts), so the spot and size you pick are the ones simulated.
const mapHospitals: { current: Hospital[] } = { current: [] }
const simSource: RegionSource = SWARM_URL
  ? source
  : {
      ...source,
      simulate: async (p) => {
        const hs = mapHospitals.current
        return simulateLocal(p, hs, await dispatchPlan([p.lat, p.lon], p.casualties, hs))
      },
    }
// The demo incident lives in lib/emer/incident.ts, so the map pin, the handoff and the board agree on it.
const MAX_REGION_MILES = 60

const PILL: Record<Status, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-mist text-jade-deep" },
  busy: { label: "Busy", cls: "bg-human-soft text-human" },
  critical: { label: "Full", cls: "bg-critical-soft text-critical" },
}

/** 248 → "4 h 8 min" */
function hm(min: number) {
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/* ---------- ER report: the four numbers ---------- */
function ReportCards({ hospitals, onPick }: { hospitals: RankedHospital[] | { er: { occupied: number; capacity: number; waiting: number }; status: Status; er_wait_min: number }[]; onPick: (p: "accepting" | "full" | "all") => void }) {
  const c = countByStatus(hospitals as never)
  const openBeds = hospitals.reduce((s, h) => s + Math.max(0, h.er.capacity - h.er.occupied), 0)
  const waiting = hospitals.reduce((s, h) => s + h.er.waiting, 0)
  const cards = [
    { k: "Taking patients", v: `${c.open + c.busy} of ${hospitals.length}`, cap: "Emergency departments open", dot: "bg-[#3fc3a4]", icon: Building2, pick: "accepting" as const },
    { k: "Full right now", v: String(c.critical), cap: c.critical ? "Tap to see which ones" : "None are full", dot: "bg-[#ff7a6b]", icon: Siren, pick: "full" as const },
    { k: "Open ER beds", v: String(openBeds), cap: "Across the city", dot: "bg-[#a99bff]", icon: BedDouble, pick: "all" as const },
    { k: "Waiting to be seen", v: String(waiting), cap: `Typical ER wait ${formatWait(median(hospitals.map((h) => h.er_wait_min)))}`, dot: "bg-[#ffc861]", icon: Users, pick: "all" as const },
  ]
  return (
    <div className="card-dark flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl px-5 py-3">
      {cards.map(({ k, v, cap, dot, icon: I, pick }) => (
        <button key={k} onClick={() => onPick(pick)} title={cap} className="flex items-center gap-2.5 text-left">
          <span className={`size-2 shrink-0 rounded-full ${dot}`} />
          <I className="size-4 shrink-0 text-white/40" strokeWidth={1.75} />
          <span className="tabular text-2xl font-bold leading-none">{v}</span>
          <span className="text-sm text-white/70">{k}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- Where to go: nearest or fastest ---------- */
function WhereToGo({
  ranked, sortBy, setSortBy, bestId, selectedId, onSelect, hoveredId, onHover, note, locate, locState,
}: {
  ranked: RankedHospital[]; sortBy: SortBy; setSortBy: (s: SortBy) => void; bestId?: string
  selectedId: string | null; onSelect: (id: string) => void; hoveredId: string | null; onHover: (id: string | null) => void
  note: string; locate: () => void; locState: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#e6e0d2] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">{sortBy === "fastest" ? "Fastest to care" : "Nearest hospitals"}</h2>
          <div role="radiogroup" aria-label="Order hospitals by" className="flex rounded-xl bg-vanilla p-1 ring-1 ring-[#e6e0d2]">
            {(["nearest", "fastest"] as SortBy[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={sortBy === s}
                onClick={() => setSortBy(s)}
                className={`rounded-lg px-3 py-1 text-sm font-semibold ${sortBy === s ? "bg-ink text-white" : "text-ink-soft"}`}
              >
                {s === "nearest" ? "Nearest" : "Fastest"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 flex items-center justify-between gap-3 text-sm text-ink-soft">
          <span>{sortBy === "fastest" ? "Drive time plus ER wait. " : "By distance. "}{note}</span>
          {locState !== "granted" && (
            <button onClick={locate} className="inline-flex shrink-0 items-center gap-1 font-semibold text-ink">
              <LocateFixed className="size-3.5" /> {locState === "asking" ? "Finding you…" : locState === "denied" ? "Location blocked" : "Use my location"}
            </button>
          )}
        </p>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-[#efe9dc] overflow-y-auto">
        {ranked.map((h) => {
          const pill = PILL[h.status]
          const ours = h.id === OUR_HOSPITAL_ID
          const best = h.id === bestId
          const on = h.id === selectedId || h.id === hoveredId
          return (
            <li key={h.id}>
              <button
                onClick={() => onSelect(h.id)}
                onMouseEnter={() => onHover(h.id)}
                onMouseLeave={() => onHover(null)}
                className={`flex w-full items-center gap-3 px-5 py-3.5 text-left ${best ? "bg-vanilla-deep" : on ? "bg-vanilla" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 font-semibold text-ink">
                    <span className="truncate">{h.name}</span>
                    {ours && <span className="text-xs font-semibold text-jade-deep">our demo hospital · simulated numbers</span>}
                    {h.live && <span className="text-xs font-semibold text-jade-deep">live · MIEMSS</span>}
                    {best && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">{sortBy === "fastest" ? "Fastest care" : "Nearest care"}</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Users className="size-3.5 text-ink-soft" />
                    {h.er.waiting} {h.er.waiting === 1 ? "person" : "people"} waiting to be seen
                  </span>
                  <span className="block text-xs text-ink-soft">
                    {h.distance.toFixed(1)} mi · {h.drive} min drive · ER wait {formatWait(h.er_wait_min)} · ER {h.er.occupied}/{h.er.capacity}
                    {h.trauma ? ` · ${h.trauma} trauma` : ""}
                  </span>
                  {h.live && (
                    <span className="block text-xs font-medium text-ink">
                      ER crowding level {h.live.level} of 4
                      {h.live.alerts.length > 0 && ` · ${h.live.alerts.join(", ")} alert`}
                      {` · ${h.live.at_hospital} ${h.live.at_hospital === 1 ? "ambulance" : "ambulances"} at the ER`}
                      {h.live.en_route > 0 && `, ${h.live.en_route} on the way`}
                    </span>
                  )}
                  {h.cms?.ed_minutes && (
                    <span className="block text-xs text-ink-soft">
                      CMS: a typical ER visit takes {hm(h.cms.ed_minutes)}
                      {h.cms.left_unseen_pct != null ? ` · ${h.cms.left_unseen_pct}% leave before being seen` : ""}
                    </span>
                  )}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pill.cls}`}>{pill.label}</span>
                <span className="w-14 text-right tabular text-lg font-bold text-ink">
                  {sortBy === "fastest" ? h.total : h.distance.toFixed(1)}
                  <span className="text-xs font-semibold text-ink-soft"> {sortBy === "fastest" ? "min" : "mi"}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="border-t border-[#e6e0d2] px-5 py-3 text-xs leading-relaxed text-ink-soft">
        A suggestion only: the crew decides where to go. For chest pain, stroke or a serious injury, call 911.
      </p>
    </div>
  )
}

/* ---------- ER report: what's happening ---------- */
type ReportItem = { id: string; tag: string; tone: "red" | "amber" | "blue"; title: string; body: string; source: string; time: string | null }
const TONE = { red: "bg-[#ff7a6b]", amber: "bg-[#ffc861]", blue: "bg-[#8ec5ff]" }

function buildReport(
  hospitals: { id: string; name: string; lat: number; lon: number; status: Status; er: { waiting: number } }[],
  incidents: { id: string; title: string; summary: string; started: string }[],
  alerts: { id: string; event: string; headline: string; area: string; severity: string; effective: string | null }[],
  generatedAt: string,
): ReportItem[] {
  const items: ReportItem[] = incidents.map((i) => ({
    id: i.id, tag: "Incident", tone: "red", title: i.title,
    body: `${i.summary} Expect more ambulances and longer waits there.`, source: "Simulated incident", time: i.started,
  }))
  const open = hospitals.filter((h) => h.status === "open")
  for (const h of hospitals.filter((x) => x.status === "critical")) {
    const alt = open.map((a) => ({ a, d: miles([h.lat, h.lon], [a.lat, a.lon]) })).sort((x, y) => x.d - y.d)[0]
    items.push({
      id: `full-${h.id}`, tag: "ER full", tone: "amber", title: `${h.name} is full`,
      body: `${h.er.waiting > 0 ? `${h.er.waiting} ${h.er.waiting === 1 ? "person is" : "people are"} waiting to be seen. ` : "Almost no open ER beds. "}${alt ? `Closest open ER: ${alt.a.name}, ${alt.d.toFixed(1)} mi away.` : "Nearby ERs are busy too."}`,
      source: h.id === OUR_HOSPITAL_ID ? "Live from EmerFlow" : "Simulated numbers", time: generatedAt,
    })
  }
  for (const a of alerts) {
    items.push({ id: a.id, tag: a.event, tone: a.severity === "Extreme" || a.severity === "Severe" ? "red" : a.severity === "Moderate" ? "amber" : "blue", title: a.headline, body: a.area, source: "Weather service", time: a.effective })
  }
  return items
}

export default function EmsPage() {
  const { st } = useHospital()
  const region = useRegion(source)
  const sim = useSimulation(simSource, { frameMs: 1400 })
  const edas = useEdas()
  const loc = useLocation()
  const [sortBy, setSortBy] = useState<SortBy>("fastest")
  const [visible, setVisible] = useState<Record<Status, boolean>>({ open: true, busy: true, critical: true })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const mapRef = useRef<HTMLElement>(null)

  // Recorded data gets every CMS emergency department around Baltimore; Robert's live server keeps its own list.
  const data = useMemo(() => (region.data && region.kind !== "live" ? withCmsHospitals(region.data) : region.data), [region.data, region.kind])
  const simulating = sim.phase !== "off"
  const incidentLabel = DEMO_INCIDENT.name  // one named incident for the whole demo, wherever it is placed
  const frame = sim.result && (sim.phase === "playing" || sim.phase === "paused") ? sim.result.frames[sim.frame] : null
  // During a what-if run the map shows the simulated frame; otherwise Hopkins is live from our sim.

  // Right now: MIEMSS live status where we have it, Hopkins from our own sim, everything else simulated.
  const baseHospitals = useMemo(() => withOurHospital(withEdas(data?.hospitals ?? [], edas), st), [data, edas, st])
  // During a what-if run the map shows the simulated frame instead.
  const hospitals = frame?.hospitals ?? baseHospitals
  useEffect(() => {
    mapHospitals.current = baseHospitals
  }, [baseHospitals])

  const center = data?.region.center
  const inRegion = !!(loc.coords && center && miles(loc.coords, center) <= MAX_REGION_MILES)
  const location: LatLon | null = inRegion ? loc.coords : (center ?? null)
  const alerts = useWeatherAlerts(location)
  const ranked = useMemo(() => (location ? rankHospitals(hospitals, location, sortBy) : []), [hospitals, location, sortBy])
  const shown = ranked.filter((h) => visible[h.status])
  // The pick follows whichever order the crew chose (nearest or fastest): never a hospital on diversion
  // (ours, when the incident commander diverts), and not a full ER while an open or busy one exists.
  const best = useMemo(() => {
    if (!location) return undefined
    const ok = rankHospitals(hospitals, location, sortBy).filter((h) => !(h.id === OUR_HOSPITAL_ID && st?.diversion))
    return ok.find((h) => h.status !== "critical") ?? ok[0]
  }, [hospitals, location, sortBy, st?.diversion])
  const report = data ? buildReport(baseHospitals, data.incidents, alerts?.alerts ?? [], data.generated_at) : []
  const note = inRegion ? "From where you are." : loc.state === "granted" ? "You're outside Baltimore, so this is measured from downtown." : "Measured from downtown Baltimore."

  const pick = (p: "accepting" | "full" | "all") =>
    setVisible(p === "accepting" ? { open: true, busy: true, critical: false } : p === "full" ? { open: false, busy: false, critical: true } : { open: true, busy: true, critical: true })

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="pt-3"><Nav /></div>
      <div className="mx-auto mt-6 w-[min(1400px,calc(100%-24px))] space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm text-ink-soft">
              {data ? (edas?.available ? `Baltimore · live ER status from MIEMSS · updated ${edas.fetched_at ? formatTime(edas.fetched_at) : "now"}` : `Baltimore · ${region.kind === "live" ? "live" : "simulated"} numbers · updated ${formatTime(data.generated_at)}`) : "Loading Baltimore…"}
            </p>
            <TextReveal as="h1" per="char" preset="fade-in-blur" speedReveal={1.5} className="mt-1 text-4xl font-bold tracking-tight text-ink">
              EMS map
            </TextReveal>
            <p className="mt-2 text-[17px] leading-relaxed text-ink-soft">
              How full every emergency room in Baltimore is, which one gets a patient cared for fastest, and what happens when a big
              crash sends dozens of people at once.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {loc.state !== "granted" && (
              <button onClick={loc.locate} className="glass inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink">
                <LocateFixed className="size-4" /> Find care near me
              </button>
            )}
          </div>
        </div>

        <ReportCards hospitals={hospitals} onPick={pick} />

        <section ref={mapRef} className="grid scroll-mt-24 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <CapacityMap
            className="glass h-[460px] rounded-2xl lg:h-[640px]"
            hospitals={hospitals}
            incidents={data?.incidents}
            location={location}
            locationLabel={inRegion ? "You are here" : "Downtown Baltimore"}
            selectedId={selectedId}
            onSelect={setSelectedId}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            visible={visible}
            route={best && !simulating ? { to: best } : null}
            simulation={{
              point: sim.point,
              label: incidentLabel,
              assignments: frame ? sim.result?.assignments : undefined,
              inTransit: frame?.in_transit,
              placing: sim.phase === "placing" || sim.phase === "ready" || sim.phase === "error",
              onPlace: sim.place,
            }}
          >
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex flex-wrap items-start justify-between gap-2">
              <StatusLegend className="pointer-events-auto" counts={countByStatus(hospitals)} visible={visible} onToggle={(s) => setVisible((v) => ({ ...v, [s]: !v[s] }))} />
              {!simulating && (
                <button onClick={sim.begin} className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-critical px-3 py-2 text-xs font-semibold text-white">
                  <Ambulance className="size-3.5" /> What if a crash happened here?
                </button>
              )}
              {sim.phase === "placing" && <p className="pointer-events-auto rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white">Click the map to put the crash there</p>}
            </div>
            <SimulationVerdict sim={sim} className="absolute left-1/2 top-16 z-[1000] w-[min(92%,460px)] -translate-x-1/2" />
            <SimulationKey sim={sim} className="absolute bottom-28 left-3 z-[1000]" />
            <SimulationTimeline sim={sim} className="absolute inset-x-3 bottom-8 z-[1000]" />
          </CapacityMap>

          <aside className="glass flex max-h-[600px] flex-col overflow-hidden rounded-2xl lg:h-[640px] lg:max-h-none">
            {simulating ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <SimulationPanel sim={sim} hospitals={hospitals} recorded={region.kind !== "live"} className="min-h-0 flex-1" />
                <IncidentHandoff sim={sim} className="m-3 mt-0 shrink-0" />
              </div>
            ) : (
              <WhereToGo
                ranked={shown}
                sortBy={sortBy}
                setSortBy={setSortBy}
                bestId={best?.id}
                selectedId={selectedId}
                onSelect={setSelectedId}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                note={note}
                locate={loc.locate}
                locState={loc.state}
              />
            )}
          </aside>
        </section>

        <section className="pt-8">
          <h2 className="text-3xl font-bold tracking-tight text-ink">ER report</h2>
          <p className="mt-1 text-[17px] text-ink-soft">What&apos;s happening at Baltimore&apos;s emergency rooms right now.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {report.map((n) => (
              <article key={n.id} className="card-dark flex flex-col justify-between gap-6 rounded-2xl p-6">
                <div>
                  <p className="flex items-center gap-2 text-sm text-white/70">
                    <span className={`size-2 rounded-full ${TONE[n.tone]}`} />
                    {n.tag}
                  </p>
                  <h3 className="mt-3 text-xl font-bold leading-snug text-white">{n.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/75">{n.body}</p>
                </div>
                <p className="text-sm text-white/50">
                  {n.source}
                  {n.time && <span className="tabular"> · {formatTime(n.time)}</span>}
                </p>
              </article>
            ))}
            {alerts && alerts.alerts.length === 0 && (
              <article className="glass flex items-center gap-3 rounded-2xl p-6 text-[15px] text-ink-soft">
                <CloudLightning className="size-5" strokeWidth={1.75} />
                {alerts.available ? "No weather alerts for Baltimore right now." : "Weather alerts are unavailable right now."}
              </article>
            )}
          </div>
        </section>

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-relaxed text-ink-soft">
          <span className="flex items-center gap-1"><Clock3 className="size-3.5" /> {edas?.available
            ? <>ER crowding levels and ambulance counts are live from MIEMSS EDAS (updated {edas.fetched_at ? formatTime(edas.fetched_at) : "now"}). Bed counts and waits are estimates. The Johns Hopkins row is our own simulation standing in for a large academic ER, not real Hopkins data.</>
            : <>Live MIEMSS status is unavailable, so the numbers are simulated. The Johns Hopkins row is our own simulation standing in for a large academic ER, not real Hopkins data.</>}</span>
          <span>
            Demo with synthetic data. Hospital names are used for illustration only; EmerFlow is not affiliated with,
            endorsed by, or connected to these institutions.
          </span>
          <span>
            Hospital list and typical ER times: CMS Provider Data (ER time {CMS_PERIOD.replace("–", " to ")}), reported averages, not live.
          </span>
          <span>Drive times are estimates.</span>
          {selectedId && (() => {
            const h = hospitals.find((x) => x.id === selectedId)
            return h ? <a href={directionsUrl(h)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink">Directions to {h.name} <ExternalLink className="size-3" /></a> : null
          })()}
        </p>
      </div>
    </main>
  )
}
