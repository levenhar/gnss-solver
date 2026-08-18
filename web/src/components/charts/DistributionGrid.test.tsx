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
    error_type: null, error_message: null,
    ...overrides,
  };
}

describe("DistributionGrid", () => {
  it("renders 4 histograms with only successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", fix_rate_pct: 90, rms_sdn: 0.1 }),
      entry({ job_id: "j2", fix_rate_pct: 80, rms_sdn: 0.2 }),
      entry({ job_id: "j3", status: "failed", fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null }),
    ];
    render(<DistributionGrid results={results} />);
    const plots = screen.getAllByTestId("plot");
    expect(plots).toHaveLength(4);
    expect(plots[0]).toHaveTextContent("2 values"); // fix rate: 2 successful jobs
  });

  it("shows 'no data' for a metric with zero successful values", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", fix_rate_pct: null }),
    ];
    render(<DistributionGrid results={results} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("renders nothing when there are zero successful jobs", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", status: "failed", fix_rate_pct: null, rms_sdn: null, rms_sde: null, rms_sdu: null }),
    ];
    const { container } = render(<DistributionGrid results={results} />);
    expect(container).toBeEmptyDOMElement();
  });
});
