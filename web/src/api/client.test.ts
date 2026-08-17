import { describe, it, expect, vi, beforeEach } from "vitest";
import { client, ApiError } from "./client";

const okJson = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("listJobs GETs /jobs and returns parsed array", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson([{ job_id: "a", status: "finished" }]));
    const jobs = await client.listJobs();
    expect(jobs[0].job_id).toBe("a");
    expect(String(spy.mock.calls[0][0])).toMatch(/\/jobs$/);
  });

  it("createJob POSTs FormData to /jobs", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ job_id: "x", status: "queued" }, 201));
    const fd = new FormData();
    const res = await client.createJob(fd);
    expect(res.job_id).toBe("x");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws ApiError with parsed detail on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ detail: "invalid config" }, 422));
    await expect(client.getResult("nope")).rejects.toBeInstanceOf(ApiError);
  });
});
