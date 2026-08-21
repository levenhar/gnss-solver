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
    expect(residualData(sol).data.length).toBeGreaterThan(0);
    const sky = skyplotData(sol);
    expect((sky[0].r as number[])[0]).toBeCloseTo(45); // 90 - el
  });
});

describe("residualData", () => {
  it("centers each series on its own mean", () => {
    const { data } = residualData(sol);
    expect(data[0]).toMatchObject({ x: [0], name: "pseudorange" }); // single sat_stats entry -> mean subtracted to 0
    expect(data[1]).toMatchObject({ x: [0], name: "carrier" });
  });

  it("has no sigma shapes/legend with a single data point (std dev 0)", () => {
    const { data, shapes } = residualData(sol);
    expect(shapes).toHaveLength(0);
    expect(data).toHaveLength(2); // just the two histograms, no legend-only lines
  });
});

describe("distributionData", () => {
  it("centers the histogram trace on zero by subtracting the mean", () => {
    const { data } = distributionData([1, 2, 3], "#38bdf8");
    expect(data[0]).toMatchObject({ x: [-1, 0, 1], type: "histogram", marker: { color: "#38bdf8" } });
  });

  it("adds ±1σ/±2σ shapes and matching legend traces", () => {
    const { data, shapes } = distributionData([1, 2, 3], "#38bdf8");
    expect(shapes).toHaveLength(4);
    const sd = Math.sqrt(2 / 3);
    expect(shapes.map((s) => s.x0)).toEqual([-2 * sd, -1 * sd, 1 * sd, 2 * sd]);
    expect(data).toHaveLength(3); // histogram + 2 legend-only lines
    expect(data[1].name).toBe("±1σ");
    expect(data[2].name).toBe("±2σ");
  });

  it("skips sigma shapes/legend when std dev is zero", () => {
    const { data, shapes } = distributionData([5, 5], "#38bdf8");
    expect(shapes).toHaveLength(0);
    expect(data).toHaveLength(1);
  });

  it("handles an empty array", () => {
    const { data } = distributionData([], "#38bdf8");
    expect(data[0].x).toEqual([]);
  });
});
