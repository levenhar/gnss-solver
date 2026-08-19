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

describe("batch api client", () => {
  it("createBatch POSTs FormData to /batches", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", status: "queued", n_bases: 2, n_configs: 100 }, 201)
    );
    const fd = new FormData();
    const res = await client.createBatch(fd);
    expect(res.batch_id).toBe("b1");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(spy.mock.calls[0][0])).toMatch(/\/batches$/);
  });

  it("listBatches GETs /batches", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson([{ batch_id: "b1", status: "finished", done: 100, total: 100 }])
    );
    const items = await client.listBatches();
    expect(items[0].batch_id).toBe("b1");
  });

  it("getBatch GETs /batches/:id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", status: "running", bases: [], done: 1, total: 100 })
    );
    const status = await client.getBatch("b1");
    expect(status.done).toBe(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/\/batches\/b1$/);
  });

  it("getBatchReport GETs /batches/:id/report", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", bases: [] })
    );
    const report = await client.getBatchReport("b1");
    expect(report.batch_id).toBe("b1");
    expect(String(spy.mock.calls[0][0])).toMatch(/\/batches\/b1\/report$/);
  });
});

describe("rename/delete", () => {
  it("renameJob PATCHes /jobs/:id/name with a JSON body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ job_id: "j1", status: "finished", error: null, name: "New" })
    );
    const res = await client.renameJob("j1", "New");
    expect(res.name).toBe("New");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/jobs\/j1\/name$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "New" });
  });

  it("renameBatch PATCHes /batches/:id/name with a JSON body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      okJson({ batch_id: "b1", status: "running", bases: [], done: 0, total: 0, name: "New" })
    );
    const res = await client.renameBatch("b1", "New");
    expect(res.name).toBe("New");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/batches\/b1\/name$/);
    expect(init.method).toBe("PATCH");
  });

  it("deleteJob DELETEs /jobs/:id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 }))
    );
    await client.deleteJob("j1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/jobs\/j1$/);
    expect(init.method).toBe("DELETE");
  });

  it("deleteBatch DELETEs /batches/:id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 }))
    );
    await client.deleteBatch("b1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/batches\/b1$/);
    expect(init.method).toBe("DELETE");
  });
});
