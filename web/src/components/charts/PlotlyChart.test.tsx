import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-plotly.js", () => ({
  default: ({ style }: any) => <div data-testid="plot" style={style} />,
}));

import { PlotlyChart } from "./PlotlyChart";

describe("PlotlyChart", () => {
  it("defaults to 420px height", () => {
    const { getByTestId } = render(<PlotlyChart data={[]} />);
    expect(getByTestId("plot").style.height).toBe("420px");
  });

  it("uses a custom height when provided", () => {
    const { getByTestId } = render(<PlotlyChart data={[]} height={220} />);
    expect(getByTestId("plot").style.height).toBe("220px");
  });
});
