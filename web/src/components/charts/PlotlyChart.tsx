import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js-dist-min";

const DARK: Partial<Layout> = {
  paper_bgcolor: "#111820",
  plot_bgcolor: "#111820",
  font: { color: "#e5edf5" },
  margin: { l: 48, r: 16, t: 24, b: 40 },
  xaxis: { gridcolor: "#1e2a36", zerolinecolor: "#1e2a36" },
  yaxis: { gridcolor: "#1e2a36", zerolinecolor: "#1e2a36" },
};

export function PlotlyChart({ data, layout }: { data: Partial<Data>[]; layout?: Partial<Layout> }) {
  return (
    <Plot
      data={data as Data[]}
      layout={{ ...DARK, ...layout, autosize: true }}
      useResizeHandler
      style={{ width: "100%", height: "420px" }}
      config={{ displModeBar: false } as any}
    />
  );
}
