import type { Solution } from "../../api/types";
import { residualData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function ResidualHist({ solution }: { solution: Solution }) {
  const { data, shapes } = residualData(solution);
  return (
    <PlotlyChart
      data={data}
      layout={{
        barmode: "overlay",
        xaxis: { title: "residual − mean (m)" },
        yaxis: { title: "count" },
        shapes,
        showlegend: true,
        legend: { orientation: "h", x: 0, y: 1.15 },
      }}
    />
  );
}
