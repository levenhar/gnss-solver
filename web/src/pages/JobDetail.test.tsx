import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../components/TrackMap", () => ({ TrackMap: () => <div data-testid="map" /> }));
vi.mock("../components/ChartTabs", () => ({ ChartTabs: () => <div data-testid="charts" /> }));

import { JobDetail } from "./JobDetail";
import { client } from "../api/client";

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/jobs/${id}`]}>
        <Routes><Route path="/jobs/:id" element={<JobDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const solution = {
  meta: { rover_id: "ROVR", rinex_version: "3.04", interval_s: 1, span_s: 30, base_id: null },
  summary: { n_epochs: 2, n_fix: 1, n_float: 1, n_single: 0, fix_rate_pct: 50, mean_sdn: 0.01, mean_sde: 0.01, mean_sdu: 0.02, rms_sdn: 0, rms_sde: 0, rms_sdu: 0 },
  config_used: { mode: "static", ar_ratio_min: 3 },
  epochs: [], sat_stats: [], engine_log: "",
};

describe("JobDetail", () => {
  it("renders summary + dashboard when finished", async () => {
    vi.spyOn(client, "getJob").mockResolvedValue({ job_id: "j1", status: "finished", error: null });
    vi.spyOn(client, "getResult").mockResolvedValue(solution as any);
    wrap("j1");
    await waitFor(() => expect(screen.getByText(/50/)).toBeInTheDocument());
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getByTestId("charts")).toBeInTheDocument();
  });

  it("renders error when failed", async () => {
    vi.spyOn(client, "getJob").mockResolvedValue({ job_id: "j2", status: "failed", error: { type: "ParseError", message: "bad", workdir: null } });
    wrap("j2");
    await waitFor(() => expect(screen.getByText(/ParseError/)).toBeInTheDocument());
  });

  it("shows the name and renames via the client on save", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "getJob").mockResolvedValue({ job_id: "j3", status: "finished", error: null, name: "Old Name" });
    vi.spyOn(client, "getResult").mockResolvedValue(solution as any);
    vi.spyOn(client, "renameJob").mockResolvedValue({ job_id: "j3", status: "finished", error: null, name: "New Name" });
    wrap("j3");
    await waitFor(() => expect(screen.getByText("Old Name")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Name{Enter}");
    await waitFor(() => expect(client.renameJob).toHaveBeenCalledWith("j3", "New Name"));
  });
});
