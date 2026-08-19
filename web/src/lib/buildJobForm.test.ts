import { describe, it, expect } from "vitest";
import { buildJobForm } from "./buildJobForm";
import { DEFAULT_CONFIG } from "../api/types";

function file(name: string, body = "x") {
  return new File([body], name, { type: "application/octet-stream" });
}

describe("buildJobForm", () => {
  it("packs rover, nav[], config; omits base when absent", () => {
    const fd = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav"), file("b.nav")] }, DEFAULT_CONFIG);
    expect((fd.get("rover") as File).name).toBe("r.obs");
    expect(fd.getAll("nav").length).toBe(2);
    expect(fd.get("base")).toBeNull();
    const cfg = JSON.parse(fd.get("config") as string);
    expect(cfg.mode).toBe("static");
  });

  it("includes base when present and sends base_coord only for known modes", () => {
    const cfg = { ...DEFAULT_CONFIG, base_coord_mode: "known-xyz" as const, base_coord: [1, 2, 3] as [number, number, number] };
    const fd = buildJobForm({ rover: file("r.obs"), base: file("base.obs"), nav: [file("a.nav")] }, cfg);
    expect((fd.get("base") as File).name).toBe("base.obs");
    expect(JSON.parse(fd.get("config") as string).base_coord).toEqual([1, 2, 3]);
  });

  it("includes a trimmed name field when provided", () => {
    const fd = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav")] }, DEFAULT_CONFIG, "  My Survey  ");
    expect(fd.get("name")).toBe("My Survey");
  });

  it("omits the name field when blank or absent", () => {
    const fd = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav")] }, DEFAULT_CONFIG, "   ");
    expect(fd.get("name")).toBeNull();
    const fd2 = buildJobForm({ rover: file("r.obs"), base: null, nav: [file("a.nav")] }, DEFAULT_CONFIG);
    expect(fd2.get("name")).toBeNull();
  });
});
