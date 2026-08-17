import { MapContainer, TileLayer, CircleMarker, Polygon, Popup, LayersControl, Tooltip } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { Solution } from "../api/types";
import { qColor, qLabel } from "../lib/quality";
import { covEllipse, meanLatLon, type Llh } from "../lib/geodesy";

// Convert a north/east meter offset back to lat/lon degrees near a reference.
function offsetToLatLon(ref: Llh, dn: number, de: number): [number, number] {
  const dLat = dn / 111320;
  const dLon = de / (111320 * Math.cos((ref.lat * Math.PI) / 180));
  return [ref.lat + dLat, ref.lon + dLon];
}

export function TrackMap({ solution }: { solution: Solution }) {
  const epochs = solution.epochs;
  const center = meanLatLon(epochs);
  const isStatic = String((solution.config_used as any)?.mode ?? "").startsWith("static") ||
    String((solution.config_used as any)?.mode ?? "").startsWith("ppp-static");

  // error ellipse from the first epoch's covariance around the mean (static case)
  const ell = isStatic && epochs.length
    ? covEllipse(epochs[0].sdn, epochs[0].sde, epochs[0].sdne, 100 /* exaggerate for visibility */)
        .map(([dn, de]) => offsetToLatLon({ lat: center.lat, lon: center.lon, h: 0 }, dn, de) as LatLngExpression)
    : null;

  return (
    <MapContainer center={[center.lat, center.lon] as LatLngExpression} zoom={17} className="h-[420px] w-full rounded-lg">
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OSM">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite">
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Topographic">
          <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution="© OpenTopoMap" />
        </LayersControl.BaseLayer>
      </LayersControl>

      {epochs.map((e, i) => (
        <CircleMarker key={i} center={[e.lat, e.lon] as LatLngExpression} radius={4}
          pathOptions={{ color: qColor(e.q), fillColor: qColor(e.q), fillOpacity: 0.9, weight: 1 }}>
          <Tooltip>{`${e.t} · ${qLabel(e.q)} · ns ${e.ns}`}</Tooltip>
        </CircleMarker>
      ))}

      {ell && <Polygon positions={ell} pathOptions={{ color: "#38bdf8", weight: 1, fillOpacity: 0.08 }} />}

      {solution.meta.base_id && (
        <CircleMarker center={[center.lat, center.lon] as LatLngExpression} radius={6}
          pathOptions={{ color: "#e5edf5", fillColor: "#111820", fillOpacity: 1, weight: 2 }}>
          <Popup>Base: {solution.meta.base_id}</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
