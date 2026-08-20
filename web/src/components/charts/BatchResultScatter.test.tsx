import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-plotly.js", () => ({
  default: ({ data }: any) => <div data-testid="plot">{data.length} traces, {data[0]?.x?.length ?? 0} points</div>,
}));

import { BatchResultScatter } from "./BatchResultScatter";
import type { BatchReportEntry } from "../../api/types";

function entry(overrides: Partial<BatchReportEntry>): BatchReportEntry {
  return {
    job_id: "j", config_idx: 0, config: {}, status: "finished",
    fix_rate_pct: 90, rms_sdn: 0.1, rms_sde: 0.1, rms_sdu: 0.2,
    utm_e: 500000, utm_n: 3500000, mean_h: 50, mean_sats: 8, min_sats: 6,
    error_type: null, error_message: null,
    ...overrides,
  };
}

describe("BatchResultScatter", () => {
  it("renders nothing when there are no positioned results", () => {
    const { container } = render(<BatchResultScatter results={[entry({ utm_e: null, utm_n: null })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a scatter with an error ellipse trace for 2+ points", () => {
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", utm_e: 500000, utm_n: 3500000 }),
      entry({ job_id: "j2", utm_e: 500010, utm_n: 3500010 }),
    ];
    render(<BatchResultScatter results={results} />);
    expect(screen.getByTestId("plot")).toHaveTextContent("2 traces, 2 points");
  });

  it("renders only the marker trace for a single point", () => {
    const results: BatchReportEntry[] = [entry({ job_id: "j1", utm_e: 500000, utm_n: 3500000 })];
    render(<BatchResultScatter results={results} />);
    expect(screen.getByTestId("plot")).toHaveTextContent("1 traces, 1 points");
  });

  it("shows the max and min radial error from the centroid", () => {
    // centroid (500005, 3500005); errors: hypot(5,5)=7.071 for both -> max = min = 7.071
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", utm_e: 500000, utm_n: 3500000 }),
      entry({ job_id: "j2", utm_e: 500010, utm_n: 3500010 }),
    ];
    render(<BatchResultScatter results={results} />);
    expect(screen.getByText(/max error 7\.071 m/i)).toBeInTheDocument();
    expect(screen.getByText(/min error 7\.071 m/i)).toBeInTheDocument();
  });

  it("shows distinct max and min errors for an asymmetric point set", () => {
    // centroid E = (500000+500000+500030)/3 = 500010; errors: 10, 10, 20 -> min 10, max 20
    const results: BatchReportEntry[] = [
      entry({ job_id: "j1", utm_e: 500000, utm_n: 3500000 }),
      entry({ job_id: "j2", utm_e: 500000, utm_n: 3500000 }),
      entry({ job_id: "j3", utm_e: 500030, utm_n: 3500000 }),
    ];
    render(<BatchResultScatter results={results} />);
    expect(screen.getByText(/max error 20\.000 m/i)).toBeInTheDocument();
    expect(screen.getByText(/min error 10\.000 m/i)).toBeInTheDocument();
  });
});
