"use client"

// Leaflet touches `window`, so this file is only ever loaded client-side (see app/ems/page.tsx).
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet"
import { busyLevel, type LatLng, type Option } from "@/lib/emer/hospitals"

const COLOR = { ok: "#1f8a70", busy: "#c7831a", full: "#d9442f" } as const

const ambulanceIcon = L.divIcon({
  className: "",
  html: `<div style="display:grid;place-items:center;width:38px;height:38px;border-radius:9999px;background:#111;color:#fff;font-size:20px;border:3px solid #fff;cursor:grab">🚑</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
})

function ClickToMove({ onMove }: { onMove: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onMove([e.latlng.lat, e.latlng.lng]) })
  return null
}

export default function EmsMap({
  ambulance, options, bestId, onMove,
}: { ambulance: LatLng; options: Option[]; bestId: string | null; onMove: (p: LatLng) => void }) {
  const best = options.find((o) => o.id === bestId)
  return (
    <MapContainer center={[39.31, -76.6]} zoom={12} scrollWheelZoom className="size-full" attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToMove onMove={onMove} />
      {best && <Polyline positions={[ambulance, best.pos]} pathOptions={{ color: "#111", weight: 3, dashArray: "8 8" }} />}
      {options.map((o) => {
        const c = o.diversion ? COLOR.full : COLOR[busyLevel(o.busy)]
        const isBest = o.id === bestId
        return (
          <CircleMarker
            key={o.id}
            center={o.pos}
            radius={o.ours ? 16 : 12}
            pathOptions={{ color: isBest ? "#111" : "#fff", weight: isBest ? 5 : 3, fillColor: c, fillOpacity: 0.95 }}
          >
            <Tooltip direction="top" offset={[0, -12]} permanent={o.ours || isBest}>
              <div style={{ fontFamily: "var(--font-inter)", lineHeight: 1.35 }}>
                <b>{o.short}</b>
                {o.diversion ? " · ON DIVERSION" : ""}
                <br />
                {o.waitingRoom} waiting to be seen
                <br />
                {o.busy}% busy · ~{o.wait} min wait
                <br />
                {o.drive} min drive · {o.total} min to care
                {o.simulated ? <><br /><i style={{ opacity: 0.7 }}>simulated numbers</i></> : null}
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}
      <Marker
        position={ambulance}
        icon={ambulanceIcon}
        draggable
        eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onMove([p.lat, p.lng]) } }}
      >
        <Tooltip direction="bottom" offset={[0, 16]}>Ambulance · drag me or click the map</Tooltip>
      </Marker>
    </MapContainer>
  )
}
