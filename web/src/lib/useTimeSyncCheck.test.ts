import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTimeSyncCheck } from "./useTimeSyncCheck";
import { client } from "../api/client";
import type { TimeSyncResponse } from "../api/types";

const OK: TimeSyncResponse = { ok: true, rover: null, bases: [], nav: null, issues: [] };
const BLOCKED: TimeSyncResponse = {
  ok: false,
  rover: null,
  bases: [],
  nav: null,
  issues: ["rover and base do not overlap in time"],
};

describe("useTimeSyncCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays idle when rover or nav is missing", () => {
    const { result } = renderHook(() => useTimeSyncCheck(null, [], []));
    expect(result.current.status).toBe("idle");
  });

  it("goes checking then ok once rover+nav present and the API says ok", async () => {
    vi.spyOn(client, "checkTimeSync").mockResolvedValue(OK);
    const rover = new File(["x"], "r.rnx");
    const nav = new File(["x"], "n.nav");
    const { result } = renderHook(() => useTimeSyncCheck(rover, [], [nav]));

    expect(result.current.status).toBe("checking");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("goes blocked with issues when the API reports a mismatch", async () => {
    vi.spyOn(client, "checkTimeSync").mockResolvedValue(BLOCKED);
    const rover = new File(["x"], "r.rnx");
    const nav = new File(["x"], "n.nav");
    const { result } = renderHook(() => useTimeSyncCheck(rover, [], [nav]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current.issues).toEqual(BLOCKED.issues);
  });

  it("fails open to unknown (not blocked) on network error", async () => {
    vi.spyOn(client, "checkTimeSync").mockRejectedValue(new Error("network down"));
    const rover = new File(["x"], "r.rnx");
    const nav = new File(["x"], "n.nav");
    const { result } = renderHook(() => useTimeSyncCheck(rover, [], [nav]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(result.current.status).toBe("unknown"));
  });

  it("ignores null base slots when building the request", async () => {
    const spy = vi.spyOn(client, "checkTimeSync").mockResolvedValue(OK);
    const rover = new File(["x"], "r.rnx");
    const nav = new File(["x"], "n.nav");
    renderHook(() => useTimeSyncCheck(rover, [null, null], [nav]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const fd = spy.mock.calls[0][0] as FormData;
    expect(fd.getAll("base")).toEqual([]);
  });
});
