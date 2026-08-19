import type { Data } from "plotly.js-dist-min";
import type { BatchReportEntry, Solution } from "../api/types";
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

export function distributionData(values: number[], color: string): Partial<Data>[] {
  return [{ x: values, type: "histogram", marker: { color } }];
}

const CHI_SQ_95_2DOF = 5.991;

function errorEllipsePoints(cx: number, cy: number, varX: number, varY: number, covXY: number, nPoints = 100) {
  const traceHalf = (varX + varY) / 2;
  const det = varX * varY - covXY * covXY;
  const spread = Math.sqrt(Math.max(traceHalf ** 2 - det, 0));
  const lambda1 = traceHalf + spread;
  const lambda2 = Math.max(traceHalf - spread, 0);
  const theta = varX === varY && covXY === 0 ? 0 : 0.5 * Math.atan2(2 * covXY, varX - varY);
  const a = Math.sqrt(lambda1 * CHI_SQ_95_2DOF);
  const b = Math.sqrt(lambda2 * CHI_SQ_95_2DOF);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i <= nPoints; i++) {
    const t = (2 * Math.PI * i) / nPoints;
    const ex = a * Math.cos(t), ey = b * Math.sin(t);
    x.push(cx + ex * cosT - ey * sinT);
    y.push(cy + ex * sinT + ey * cosT);
  }
  return { x, y };
}

export function batchPositionErrors(results: BatchReportEntry[]): number[] {
  const pts = results.filter((r) => typeof r.utm_e === "number" && typeof r.utm_n === "number");
  const xs = pts.map((r) => r.utm_e as number);
  const ys = pts.map((r) => r.utm_n as number);
  if (xs.length === 0) return [];
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length;
  const cy = ys.reduce((a, v) => a + v, 0) / ys.length;
  return xs.map((x, i) => Math.hypot(x - cx, ys[i] - cy));
}

export function batchScatterData(results: BatchReportEntry[]): Partial<Data>[] {
  const pts = results.filter((r) => typeof r.utm_e === "number" && typeof r.utm_n === "number");
  const xs = pts.map((r) => r.utm_e as number);
  const ys = pts.map((r) => r.utm_n as number);
  const scatter: Partial<Data> = {
    x: xs, y: ys, mode: "markers", type: "scattergl",
    marker: { size: 7, color: "#38bdf8" }, text: pts.map((r) => r.job_id), name: "results",
  };
  if (xs.length < 2) return [scatter];
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length;
  const cy = ys.reduce((a, v) => a + v, 0) / ys.length;
  const varX = xs.reduce((a, v) => a + (v - cx) ** 2, 0) / xs.length;
  const varY = ys.reduce((a, v) => a + (v - cy) ** 2, 0) / ys.length;
  const covXY = xs.reduce((a, v, i) => a + (v - cx) * (ys[i] - cy), 0) / xs.length;
  const ellipse = errorEllipsePoints(cx, cy, varX, varY, covXY);
  const ellipseTrace: Partial<Data> = {
    x: ellipse.x, y: ellipse.y, mode: "lines", type: "scatter",
    line: { color: "#eab308", dash: "dash" }, name: "95% error ellipse",
  };
  return [scatter, ellipseTrace];
}
