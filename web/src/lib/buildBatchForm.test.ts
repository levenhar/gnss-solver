import { describe, it, expect } from "vitest";
import { buildBatchForm, type BatchFiles } from "./buildBatchForm";
import { DEFAULT_SWEEP_CONFIG } from "../api/types";

function file(name: string): File {
  return new File(["x"], name);
}

describe("buildBatchForm", () => {
  it("appends rover, all nav, all bases, n_configs, and sweep_config", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav"), file("b.nav")],
      bases: [file("base1.obs"), file("base2.obs")],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG, 100);
    expect((fd.get("rover") as File).name).toBe("r.rnx");
    expect(fd.getAll("nav").map((f) => (f as File).name)).toEqual(["a.nav", "b.nav"]);
    expect(fd.getAll("base").map((f) => (f as File).name)).toEqual(["base1.obs", "base2.obs"]);
    expect(fd.get("n_configs")).toBe("100");
    expect(JSON.parse(fd.get("sweep_config") as string)).toEqual(DEFAULT_SWEEP_CONFIG);
  });

  it("defaults n_configs to 100 when omitted", () => {
    const files: BatchFiles = { rover: file("r.rnx"), nav: [file("a.nav")], bases: [file("b.obs")] };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.get("n_configs")).toBe("100");
  });

  it("skips null entries in bases array", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [file("base1.obs"), null, file("base2.obs"), null],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.getAll("base").map((f) => (f as File).name)).toEqual(["base1.obs", "base2.obs"]);
  });

  it("handles empty bases array", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.getAll("base")).toEqual([]);
  });
});
