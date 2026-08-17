import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Solution } from "../api/types";

vi.mock("react-plotly.js", () => ({ default: ({ data }: any) => <div data-testid="plot">{data.length} traces</div> }));

import { ChartTabs } from "./ChartTabs";

const sol = { epochs: [{ t: "2023-01-01T00:00:00Z", lat: 32, lon: 34, h: 50, q: 1, ns: 9, sdn: 0.004, sde: 0.005, sdu: 0.009, sdne: 0.001, age: 0, ratio: 99, x: null, y: null, z: null }], sat_stats: [] } as unknown as Solution;

describe("ChartTabs", () => {
  it("switches tabs", async () => {
    render(<ChartTabs solution={sol} arThreshold={3} />);
    expect(screen.getByTestId("plot")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Sky"));
    expect(screen.getByTestId("plot")).toBeInTheDocument();
  });
});
