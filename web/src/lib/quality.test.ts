import { describe, it, expect } from "vitest";
import { qLabel, qColor } from "./quality";

describe("quality", () => {
  it("labels", () => {
    expect(qLabel(1)).toMatch(/fix/i);
    expect(qLabel(2)).toMatch(/float/i);
    expect(qLabel(5)).toMatch(/single/i);
  });
  it("colors distinct per bucket", () => {
    const cs = new Set([qColor(1), qColor(2), qColor(4), qColor(5)]);
    expect(cs.size).toBe(4);
    expect(qColor(1)).toBe("#16a34a");
  });
});
