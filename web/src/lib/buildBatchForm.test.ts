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
      bases: [
        { file: file("base1.obs"), base_coord_mode: "single", base_coord: null },
        { file: file("base2.obs"), base_coord_mode: "known-llh", base_coord: [32, 34, 50] },
      ],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG, 100);
    expect((fd.get("rover") as File).name).toBe("r.rnx");
    expect(fd.getAll("nav").map((f) => (f as File).name)).toEqual(["a.nav", "b.nav"]);
    expect(fd.getAll("base").map((f) => (f as File).name)).toEqual(["base1.obs", "base2.obs"]);
    expect(fd.get("n_configs")).toBe("100");
    expect(JSON.parse(fd.get("sweep_config") as string)).toEqual(DEFAULT_SWEEP_CONFIG);
    expect(JSON.parse(fd.get("base_coords") as string)).toEqual([
      { mode: "single", coord: null },
      { mode: "known-llh", coord: [32, 34, 50] },
    ]);
  });

  it("defaults n_configs to 100 when omitted", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [{ file: file("b.obs"), base_coord_mode: "single", base_coord: null }],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.get("n_configs")).toBe("100");
  });

  it("skips null entries in bases array", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [
        { file: file("base1.obs"), base_coord_mode: "single", base_coord: null },
        { file: null, base_coord_mode: "single", base_coord: null },
        { file: file("base2.obs"), base_coord_mode: "single", base_coord: null },
        { file: null, base_coord_mode: "single", base_coord: null },
      ],
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

  it("includes a trimmed name field when provided", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [{ file: file("b.obs"), base_coord_mode: "single", base_coord: null }],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG, 100, "  Sweep A  ");
    expect(fd.get("name")).toBe("Sweep A");
  });

  it("omits the name field when absent", () => {
    const files: BatchFiles = {
      rover: file("r.rnx"),
      nav: [file("a.nav")],
      bases: [{ file: file("b.obs"), base_coord_mode: "single", base_coord: null }],
    };
    const fd = buildBatchForm(files, DEFAULT_SWEEP_CONFIG);
    expect(fd.get("name")).toBeNull();
  });
});
