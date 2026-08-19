import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BatchDetail } from "./BatchDetail";
import { client } from "../api/client";

vi.mock("react-plotly.js", () => ({
  default: ({ data }: any) => <div data-testid="plot">{data[0]?.x?.length ?? 0} values</div>,
}));

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
          {
            job_id: "j-best", config_idx: 1,
            config: { mode: "static", frequency: "l1+l2", ambiguity: "continuous", elev_mask_deg: 15, ar_ratio_min: 3.0 },
            status: "finished", fix_rate_pct: 95, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2,
            utm_e: 500000, utm_n: 3500000, mean_h: 50,
            error_type: null, error_message: null,
          },
          {
            job_id: "j-worse", config_idx: 0,
            config: { mode: "kinematic", frequency: "l1", ambiguity: "off", elev_mask_deg: 10, ar_ratio_min: 2.5 },
            status: "finished", fix_rate_pct: 60, rms_sdn: 0.3, rms_sde: 0.3, rms_sdu: 0.4,
            utm_e: 500010, utm_n: 3500010, mean_h: 52,
            error_type: null, error_message: null,
          },
        ],
        summary: { best_job_id: "j-best", best_fix_rate_pct: 95, worst_fix_rate_pct: 60, mean_fix_rate_pct: 77.5, median_fix_rate_pct: 77.5, n_failed: 0 },
      }],
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText("base-0")).toBeInTheDocument());
    // overall "All bases" stats visible before expanding any base
    expect(screen.getByText("All bases")).toBeInTheDocument();
    expect(screen.getAllByText("Avg easting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Range easting").length).toBeGreaterThan(0);
    // overall: distribution grid (3 histograms) + result scatter (1 plot) = 4
    expect(screen.getAllByTestId("plot")).toHaveLength(4);
    expect(screen.queryByText("j-best")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /base-0/ }));
    await waitFor(() => expect(screen.getByText("j-best")).toBeInTheDocument());
    // per-base distribution grid adds 3 more histograms (7 total: overall(4) + base-0(3))
    expect(screen.getAllByTestId("plot")).toHaveLength(7);
    expect(screen.getAllByText(/95/).length).toBeGreaterThan(0);
    // config summary column (finding 1): config_idx + compact one-line summary
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    expect(screen.getByText(/static/)).toBeInTheDocument();
    expect(screen.getByText(/l1\+l2/)).toBeInTheDocument();
    expect(screen.getByText(/continuous/)).toBeInTheDocument();
    expect(screen.getByText(/el15/)).toBeInTheDocument();
    expect(screen.getByText(/ar3/)).toBeInTheDocument();
  });

  it("shows error type/message inline for a failed row", async () => {
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "finished",
      bases: [{ base_id: "base-0", done: 1, total: 1, failed: 1 }],
      done: 1, total: 1,
    });
    vi.spyOn(client, "getBatchReport").mockResolvedValue({
      batch_id: "b1",
      bases: [{
        base_id: "base-0",
        results: [
          {
            job_id: "j-fail", config_idx: 0, config: {}, status: "failed",
            fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null,
            utm_e: null, utm_n: null, mean_h: null,
            error_type: "RtklibExecError", error_message: "boom",
          },
        ],
        summary: { best_job_id: null, best_fix_rate_pct: null, worst_fix_rate_pct: null, mean_fix_rate_pct: null, median_fix_rate_pct: null, n_failed: 1 },
      }],
    });
    wrap("b1");
    await waitFor(() => expect(screen.getByText("base-0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /base-0/ }));
    await waitFor(() => expect(screen.getByText("j-fail")).toBeInTheDocument());
    expect(screen.getByText("RtklibExecError")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("shows an error message if the report query fails once finished", async () => {
    vi.spyOn(client, "getBatch").mockResolvedValue({
      batch_id: "b1", status: "finished",
      bases: [{ base_id: "base-0", done: 1, total: 1, failed: 0 }],
      done: 1, total: 1,
    });
    vi.spyOn(client, "getBatchReport").mockRejectedValue(new Error("network down"));
    wrap("b1");
    await waitFor(() => expect(screen.getByText(/failed to load report/i)).toBeInTheDocument());
  });
});
