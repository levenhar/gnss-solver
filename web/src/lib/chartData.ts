import type { Data } from "plotly.js-dist-min";
import type { Solution } from "../api/types";
import { qColor } from "./quality";
import { llhToEnu, meanLatLon } from "./geodesy";

export function groundTrackData(sol: Solution): Partial<Data>[] {
  const ref0 = meanLatLon(sol.epochs);
  const ref = { lat: ref0.lat, lon: ref0.lon, h: 0 };
  const x: number[] = [], y: number[] = [], colors: string[] = [];
  for (const e of sol.epochs) {
    const enu = llhToEnu(e.lat, e.lon, e.h, ref);
    x.push(enu.e); y.push(enu.n); colors.push(qColor(e.q));
  }
  return [{ x, y, mode: "markers", type: "scattergl", marker: { size: 5, color: colors } }];
}

export function heightTimeData(sol: Solution): Partial<Data>[] {
  return [{ x: sol.epochs.map((e) => e.t), y: sol.epochs.map((e) => e.h), mode: "lines+markers", type: "scattergl", line: { color: "#38bdf8" } }];
}

export function satCountData(sol: Solution): Partial<Data>[] {
  return [{ x: sol.epochs.map((e) => e.t), y: sol.epochs.map((e) => e.ns), mode: "lines", type: "scattergl", line: { shape: "hv", color: "#38bdf8" } }];
}

export function arRatioData(sol: Solution): Partial<Data>[] {
  return [{ x: sol.epochs.map((e) => e.t), y: sol.epochs.map((e) => e.ratio), mode: "lines", type: "scattergl", line: { color: "#eab308" } }];
}

export function residualData(sol: Solution): Partial<Data>[] {
  return [
    { x: sol.sat_stats.map((s) => s.res_p), type: "histogram", name: "pseudorange", opacity: 0.6, marker: { color: "#38bdf8" } },
    { x: sol.sat_stats.map((s) => s.res_c), type: "histogram", name: "carrier", opacity: 0.6, marker: { color: "#eab308" } },
  ];
}

export function skyplotData(sol: Solution): Partial<Data>[] {
  return [{
    r: sol.sat_stats.map((s) => 90 - s.el),
    theta: sol.sat_stats.map((s) => s.az),
    text: sol.sat_stats.map((s) => s.sat),
    mode: "markers", type: "scatterpolar",
    marker: { size: 7, color: sol.sat_stats.map((s) => s.snr), colorscale: "Viridis", showscale: true, colorbar: { title: "SNR" } },
  }];
}
