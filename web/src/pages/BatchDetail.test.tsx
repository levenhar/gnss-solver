import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BatchDetail } from "./BatchDetail";
import { client } from "../api/client";

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/batches/${id}`]}>
        <Routes>
          <Route path="/batches/:id" element={<BatchDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BatchDetail", () => {
  it("shows progress while running", async () => {
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "running",
      bases: [{ base_id: "base-0", done: 40, total: 100, failed: 0 }],
      done: 40, total: 100,
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText(/40\s*\/\s*100/)).toBeInTheDocument());
  });

  it("shows ranked report table once finished", async () => {
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "finished",
      bases: [{ base_id: "base-0", done: 2, total: 2, failed: 0 }],
      done: 2, total: 2,
    });
    vi.spyOn(client, "getBatchReport").mockResolvedValue({
      batch_id: "b1",
      bases: [{
        base_id: "base-0",
        results: [
          { job_id: "j-best", config_idx: 1, config: {}, status: "finished", fix_rate_pct: 95, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2 },
          { job_id: "j-worse", config_idx: 0, config: {}, status: "finished", fix_rate_pct: 60, rms_sdn: 0.3, rms_sde: 0.3, rms_sdu: 0.4 },
        ],
        summary: { best_job_id: "j-best", best_fix_rate_pct: 95, worst_fix_rate_pct: 60, mean_fix_rate_pct: 77.5, median_fix_rate_pct: 77.5, n_failed: 0 },
      }],
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText("j-best")).toBeInTheDocument());
    expect(screen.getAllByText(/95/).length).toBeGreaterThan(0);
    expect(screen.getByText("base-0")).toBeInTheDocument();
  });
});
