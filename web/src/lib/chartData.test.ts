import { describe, it, expect } from "vitest";
import { groundTrackData, heightTimeData, satCountData, arRatioData, residualData, skyplotData, distributionData } from "./chartData";
import type { Solution } from "../api/types";

const sol = {
  epochs: [
    { t: "2023-01-01T00:00:00Z", lat: 32, lon: 34, h: 50, q: 1, ns: 9, sdn: 0.004, sde: 0.005, sdu: 0.009, sdne: 0.001, age: 0, ratio: 99, x: null, y: null, z: null },
    { t: "2023-01-01T00:00:01Z", lat: 32.0001, lon: 34.0001, h: 51, q: 2, ns: 8, sdn: 0.02, sde: 0.02, sdu: 0.04, sdne: 0, age: 0, ratio: 2, x: null, y: null, z: null },
  ],
  sat_stats: [
    { t: "2023-01-01T00:00:00Z", sat: "G01", az: 120, el: 45, snr: 48, res_p: 0.3, res_c: 0.002, slip: false, fix: 1 },
  ],
} as unknown as Solution;

describe("chartData", () => {
  it("groundTrack returns points colored by q", () => {
    const d = groundTrackData(sol);
    expect(d[0].x?.length).toBe(2);
    expect(d[0].mode).toContain("markers");
  });
  it("height/satCount/arRatio series length match epochs", () => {
    expect((heightTimeData(sol)[0].y as number[]).length).toBe(2);
    expect((satCountData(sol)[0].y as number[]).length).toBe(2);
    expect((arRatioData(sol)[0].y as number[]).length).toBe(2);
  });
  it("residual + skyplot derive from sat_stats", () => {
    expect(residualData(sol).length).toBeGreaterThan(0);
    const sky = skyplotData(sol);
    expect((sky[0].r as number[])[0]).toBeCloseTo(45); // 90 - el
  });
});

describe("distributionData", () => {
  it("builds a single histogram trace from the values", () => {
    const traces = distributionData([1, 2, 3], "#38bdf8");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ x: [1, 2, 3], type: "histogram", marker: { color: "#38bdf8" } });
  });

  it("handles an empty array", () => {
    const traces = distributionData([], "#38bdf8");
    expect(traces[0].x).toEqual([]);
  });
});
