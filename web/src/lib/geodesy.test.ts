import { describe, it, expect } from "vitest";
import { llhToEnu, covEllipse } from "./geodesy";

describe("geodesy", () => {
  it("zero offset at reference", () => {
    const p = llhToEnu(32, 34, 100, { lat: 32, lon: 34, h: 100 });
    expect(Math.abs(p.e)).toBeLessThan(1e-6);
    expect(Math.abs(p.n)).toBeLessThan(1e-6);
  });
  it("east offset is positive for larger lon", () => {
    const p = llhToEnu(32, 34.001, 100, { lat: 32, lon: 34, h: 100 });
    expect(p.e).toBeGreaterThan(0);
    expect(Math.abs(p.n)).toBeLessThan(1); // ~same latitude
  });
  it("covEllipse returns closed ring of requested size", () => {
    const ring = covEllipse(0.01, 0.02, 0, 1, 32);
    expect(ring.length).toBe(32);
    // diagonal cov: east semi-axis (0.02) larger than north (0.01)
    const maxE = Math.max(...ring.map(([, de]) => Math.abs(de)));
    const maxN = Math.max(...ring.map(([dn]) => Math.abs(dn)));
    expect(maxE).toBeGreaterThan(maxN);
  });
});
