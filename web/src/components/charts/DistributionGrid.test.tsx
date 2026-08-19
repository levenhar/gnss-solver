import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-plotly.js", () => ({
  default: ({ data }: any) => <div data-testid="plot">{data[0]?.x?.length ?? 0} values</div>,
}));

import { DistributionGrid } from "./DistributionGrid";
import type { BatchReportEntry } from "../../api/types";

function entry(overrides: Partial<BatchReportEntry>): BatchReportEntry {
  return {
    job_id: "j", config_idx: 0, config: {}, status: "finished",
    fix_rate_pct: 90, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2,
    utm_e: 500000, utm_n: 3500000, mean_h: 50,
    error_type: null, error_message: null,
    ...overrides,
  };
}

describe("DistributionGrid", () => {
  it("renders 3 histograms with only successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", utm_e: 500000 }),
      entry({ job_id: "j2", utm_e: 500010 }),
      entry({ job_id: "j3", status: "failed", fix_rate_pct: null, utm_e: null, utm_n: null, mean_h: null }),
    ];
    render(<DistributionGrid results={results} />);
    const plots = screen.getAllByTestId("plot");
    expect(plots).toHaveLength(3);
    expect(plots[0]).toHaveTextContent("2 values"); // easting: 2 successful jobs
  });

  it("shows a header with the metric name above each chart", () => {
    const results: BatchReportEntry[] = [entry({ job_id: "j1" })];
    render(<DistributionGrid results={results} />);
    expect(screen.queryByText(/^fix rate \(%\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^easting \(m\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^northing \(m\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^height \(m\)/i)).toBeInTheDocument();
  });

  it("shows the mean and std dev of each metric's values next to its header", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", utm_e: 500000 }),
      entry({ job_id: "j2", utm_e: 500020 }),
    ];
    render(<DistributionGrid results={results} />);
    // utm_e: [500000, 500020] -> mean 500010, population std = 10
    expect(screen.getByText(/^easting \(m\) · μ 500010\.000 · σ 10\.000$/i)).toBeInTheDocument();
  });

  it("omits the mean/std dev suffix for a metric with zero successful values", () => {
    const results: BatchReportEntry[] = [entry({ job_id: "j1", utm_e: null })];
    render(<DistributionGrid results={results} />);
    expect(screen.getByText(/^easting \(m\)$/i)).toBeInTheDocument();
  });

  it("shows 'no data' for a metric with zero successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", utm_e: null }),
    ];
    render(<DistributionGrid results={results} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders nothing when there are zero successful jobs", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", status: "failed", fix_rate_pct: null, utm_e: null, utm_n: null, mean_h: null }),
    ];
    const { container } = render(<DistributionGrid results={results} />);
    expect(container).toBeEmptyDOMElement();
  });
});
