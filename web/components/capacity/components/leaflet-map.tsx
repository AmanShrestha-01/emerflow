"use client";

// The Leaflet map itself. Leaflet needs `window`, so this file is only loaded in the
// browser, through CapacityMap (capacity-map.tsx). Import CapacityMap, not this.

import "leaflet/dist/leaflet.css";
import "../map.css";
import L from "leaflet";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import { STATUS, directionsUrl, formatWait } from "../geo";
import type { CapacityMapProps } from "./capacity-map";
import type { Hospital, LatLon } from "../types";

const incidentIcon = L.divIcon({
  className: "emf-pin",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: `<div class="emf-pulse"></div>`,
});

const youIcon = L.divIcon({
  className: "emf-pin",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: `<div class="emf-you"></div>`,
});

const TRIAGE_COLORS = { urgent: "#dc2626", delayed: "#d97706", minor: "#059669" } as const;

/** Ambulance lines take the color of the most urgent group they carry. */
function lineColor(groups?: Record<keyof typeof TRIAGE_COLORS, number>) {
  if (!groups) return "#ef4444";
  return groups.urgent ? TRIAGE_COLORS.urgent : groups.delayed ? TRIAGE_COLORS.delayed : TRIAGE_COLORS.minor;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** "Johns Hopkins Hospital" → "Johns Hopkins", "UMMC R Adams Cowley Shock Trauma" → "Shock Trauma". */
function shortName(name: string) {
  let s = name.replace(/ (General Hospital|Hospital of Baltimore|Hospital|Medical Center|Campus|Hospital Center)$/, "");
  if (s.length > 18) s = s.replace(/^(UMMC|UM|MedStar|Ascension|LifeBridge|Luminis Health|Johns Hopkins) /, "");
  if (s.length > 18) s = s.split(" ").slice(-2).join(" ");
  return s;
}

/** Label beside a receiving hospital: short name, people by triage color, and ambulances on the way now. */
function countLabel(h: Hospital, a: { casualties: number; groups?: Record<keyof typeof TRIAGE_COLORS, number> }, driving: number) {
  const short = escapeHtml(shortName(h.name));
  const chips = a.groups
    ? (Object.keys(TRIAGE_COLORS) as (keyof typeof TRIAGE_COLORS)[])
        .filter((g) => a.groups![g] > 0)
        .map((g) => `<i style="background:${TRIAGE_COLORS[g]}">${a.groups![g]}</i>`)
        .join("")
    : `<i style="background:#111">+${a.casualties}</i>`;
  const road = driving ? `<em>🚑 ${driving} on the way</em>` : "";
  return `<span class="emf-count"><b>${short}</b>${chips}${road}</span>`;
}

function radius(h: Hospital) {
  return 5 + Math.sqrt(h.er.capacity) * 0.75; // bigger ER, bigger dot
}

// Wheel zoom only after the map is clicked, so scrolling the page doesn't get stuck in the map.
function ScrollZoomOnClick() {
  const map = useMap();
  useEffect(() => {
    const enable = () => map.scrollWheelZoom.enable();
    const disable = () => map.scrollWheelZoom.disable();
    map.on("click", enable).on("mouseout", disable);
    return () => {
      map.off("click", enable).off("mouseout", disable);
    };
  }, [map]);
  return null;
}

/** Fits the map to `points` whenever `fitKey` changes. */
function FitTo({ points, fitKey }: { points: LatLon[]; fitKey: string }) {
  const map = useMap();
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  });
  useEffect(() => {
    if (pointsRef.current.length) map.flyToBounds(L.latLngBounds(pointsRef.current), { padding: [48, 48], maxZoom: 13, duration: 0.8 });
  }, [map, fitKey]);
  return null;
}

// Depends on primitives only, so a data refresh doesn't re-fly the map.
function FlyToSelected({ id, lat, lon, markers }: { id?: string; lat?: number; lon?: number; markers: RefObject<Record<string, L.CircleMarker>> }) {
  const map = useMap();
  useEffect(() => {
    if (!id || lat === undefined || lon === undefined) return;
    map.flyTo([lat, lon], Math.max(map.getZoom(), 13), { duration: 0.6 });
    markers.current[id]?.openPopup();
  }, [map, id, lat, lon, markers]);
  return null;
}

/** Opens the tooltip of the hovered hospital, so hovering a list row points at its pin. */
function HoverTooltip({ id, markers }: { id?: string | null; markers: RefObject<Record<string, L.CircleMarker>> }) {
  useEffect(() => {
    if (!id) return;
    const m = markers.current[id];
    m?.openTooltip();
    return () => {
      m?.closeTooltip();
    };
  }, [id, markers]);
  return null;
}

function PlaceOnClick({ active, onPlace }: { active: boolean; onPlace?: (p: LatLon) => void }) {
  const map = useMapEvents({
    click: (e) => active && onPlace?.([e.latlng.lat, e.latlng.lng]),
  });
  useEffect(() => {
    map.getContainer().classList.toggle("emf-placing", active);
  }, [map, active]);
  return null;
}

export default function LeafletMap({
  hospitals,
  incidents = [],
  location,
  locationLabel = "Your location",
  selectedId,
  onSelect,
  hoveredId,
  onHover,
  visible,
  route,
  simulation,
}: CapacityMapProps) {
  const markers = useRef<Record<string, L.CircleMarker>>({});
  const selected = hospitals.find((h) => h.id === selectedId);
  const shown = visible ? hospitals.filter((h) => visible[h.status] || h.id === selectedId) : hospitals;
  const incoming = useMemo(
    () => Object.fromEntries((simulation?.assignments ?? []).map((a) => [a.hospital_id, a])),
    [simulation?.assignments],
  );

  const center: LatLon = location ?? [hospitals[0]?.lat ?? 0, hospitals[0]?.lon ?? 0];
  const simPoint = simulation?.point;
  const fitPoints = useMemo<LatLon[]>(() => {
    if (simPoint && simulation?.assignments?.length) {
      return [simPoint, ...hospitals.filter((h) => incoming[h.id]).map((h) => [h.lat, h.lon] as LatLon)];
    }
    return [...(location ? [location] : []), ...hospitals.map((h) => [h.lat, h.lon] as LatLon)];
  }, [simPoint, simulation?.assignments, hospitals, incoming, location]);
  const fitKey = simPoint && simulation?.assignments?.length ? `sim:${simPoint.join(",")}` : `base:${hospitals.length > 0}`;

  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom={false} zoomControl={false} className="emf-map size-full">
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />
      <ScrollZoomOnClick />
      <FitTo points={fitPoints} fitKey={fitKey} />
      <FlyToSelected id={selected?.id} lat={selected?.lat} lon={selected?.lon} markers={markers} />
      <PlaceOnClick active={!!simulation?.placing} onPlace={simulation?.onPlace} />
      <HoverTooltip id={hoveredId !== selectedId ? hoveredId : null} markers={markers} />

      {/* Route to the best option */}
      {route && location && !simPoint && (
        <Polyline
          positions={[location, [route.to.lat, route.to.lon]]}
          pathOptions={{ color: "#111111", weight: 2.5, opacity: 0.8, dashArray: "4 6", interactive: false }}
        />
      )}

      {/* Casualty flows in a simulation */}
      {simPoint &&
        hospitals
          .filter((h) => incoming[h.id])
          .map((h) => {
            const a = incoming[h.id];
            return (
              <Polyline
                key={`flow-${h.id}`}
                positions={[simPoint, [h.lat, h.lon]]}
                pathOptions={{ color: lineColor(a.groups), weight: 1.5 + Math.sqrt(a.casualties) * 1.1, opacity: 0.6, className: "emf-flow" }}
              >
                <Tooltip sticky className="emf-tooltip">
                  <b>{a.casualties}</b> people → {h.name}
                  <br />
                  {a.groups ? `${a.groups.urgent} urgent · ${a.groups.delayed} can wait · ${a.groups.minor} minor` : `${a.severe} severe`} · {a.drive_min} min drive
                </Tooltip>
              </Polyline>
            );
          })}

      {location && (
        <Marker position={location} icon={youIcon} zIndexOffset={-100}>
          <Tooltip direction="top" offset={[0, -8]} className="emf-tooltip">
            {locationLabel}
          </Tooltip>
        </Marker>
      )}

      {!simPoint &&
        incidents.map((i) => (
          <Marker key={i.id} position={[i.lat, i.lon]} icon={incidentIcon} zIndexOffset={500}>
            <Tooltip direction="top" offset={[0, -8]} className="emf-tooltip">
              <span className="emf-tooltip-kicker">Mass casualty incident</span>
              <br />
              {i.title}
            </Tooltip>
          </Marker>
        ))}

      {simPoint && (
        <Marker position={simPoint} icon={incidentIcon} zIndexOffset={500}>
          <Tooltip direction="top" offset={[0, -8]} className="emf-tooltip" permanent={!!simulation?.label}>
            <span className="emf-tooltip-kicker">Simulated incident</span>
            {simulation?.label && <span className="emf-tooltip-title">{simulation.label}</span>}
          </Tooltip>
        </Marker>
      )}

      {/* How many casualties each hospital receives */}
      {simPoint &&
        hospitals
          .filter((h) => incoming[h.id])
          .map((h) => (
            <Marker
              key={`count-${h.id}`}
              position={[h.lat, h.lon]}
              interactive={false}
              zIndexOffset={800}
              icon={L.divIcon({ className: "emf-pin", iconSize: [0, 0], html: countLabel(h, incoming[h.id], simulation?.inTransit?.[h.id] ?? 0) })}
            />
          ))}

      {/* Full hospitals pulse */}
      {shown
        .filter((h) => h.status === "critical")
        .map((h) => (
          <CircleMarker
            key={`halo-${h.id}`}
            center={[h.lat, h.lon]}
            radius={radius(h) + 5}
            pathOptions={{ stroke: false, fillColor: STATUS.critical.color, fillOpacity: 0.45, interactive: false, className: "emf-halo" }}
          />
        ))}

      {(() => {
        const h = hoveredId && hoveredId !== selectedId ? shown.find((x) => x.id === hoveredId) : undefined;
        return h ? (
          <CircleMarker
            center={[h.lat, h.lon]}
            radius={radius(h) + 5}
            pathOptions={{ color: "#111111", weight: 2.5, fill: false, interactive: false }}
          />
        ) : null;
      })()}

      {selected && (
        <CircleMarker
          center={[selected.lat, selected.lon]}
          radius={radius(selected) + 8}
          pathOptions={{ stroke: false, fillColor: STATUS[selected.status].color, fillOpacity: 0.18, interactive: false }}
        />
      )}

      {shown.map((h) => {
        const isSelected = h.id === selectedId;
        const a = incoming[h.id];
        return (
          <CircleMarker
            key={h.id}
            center={[h.lat, h.lon]}
            radius={radius(h) + (isSelected ? 2 : 0)}
            pathOptions={{ color: "#fff", weight: 2, fillColor: STATUS[h.status].color, fillOpacity: 1, className: "emf-hospital" }}
            eventHandlers={{
              click: () => onSelect?.(h.id),
              mouseover: () => onHover?.(h.id),
              mouseout: () => onHover?.(null),
            }}
            ref={(m) => {
              if (m) markers.current[h.id] = m;
            }}
          >
            <Tooltip direction="top" offset={[0, -radius(h)]} className="emf-tooltip">
              <b>{h.name}</b>
              <br />
              <span style={{ color: STATUS[h.status].color }}>●</span> {STATUS[h.status].label} · ER wait {formatWait(h.er_wait_min)}
              {a && (
                <>
                  <br />
                  <span className="emf-tooltip-kicker">+{a.casualties} casualties incoming</span>
                </>
              )}
            </Tooltip>
            <Popup>
              <div className="emf-popup">
                <p className="emf-popup-title">{h.name}</p>
                <p className="emf-popup-sub">
                  {h.address}
                  {h.trauma ? ` · Trauma ${h.trauma}` : ""}
                </p>
                <div className="emf-popup-grid">
                  <span>ER</span>
                  <b>
                    {h.er.occupied}/{h.er.capacity}
                    {h.er.waiting > 0 ? ` +${h.er.waiting} waiting` : ""}
                  </b>
                  <span>ICU</span>
                  <b>
                    {h.icu.occupied}/{h.icu.capacity}
                    {h.icu.waiting > 0 ? ` +${h.icu.waiting} waiting` : ""}
                  </b>
                  <span>ER wait</span>
                  <b>{formatWait(h.er_wait_min)}</b>
                  {h.cms?.ed_minutes && (
                    <>
                      <span>Typical visit</span>
                      <b>
                        {Math.floor(h.cms.ed_minutes / 60)} h {h.cms.ed_minutes % 60} min <span style={{ fontWeight: 400, opacity: 0.6 }}>(CMS)</span>
                      </b>
                    </>
                  )}
                </div>
                <a href={directionsUrl(h)} target="_blank" rel="noreferrer" className="emf-popup-link">
                  Directions →
                </a>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
