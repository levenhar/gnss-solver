import type { BatchReportEntry } from "../../api/types";
import { batchPositionErrors, batchScatterData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function BatchResultScatter({ results }: { results: BatchReportEntry[] }) {
  const pts = results.filter((r) => typeof r.utm_e === "number" && typeof r.utm_n === "number");
  if (pts.length === 0) return null;

  const errors = batchPositionErrors(results);
  const maxError = Math.max(...errors);
  const minError = Math.min(...errors);

  return (
    <div className="rounded-md border border-hair p-2">
      <div className="mb-1 text-xs text-muted">
        RESULT POSITIONS (E/N) · 95% ERROR ELLIPSE · max error {maxError.toFixed(3)} m · min error {minError.toFixed(3)} m
      </div>
      <PlotlyChart
        data={batchScatterData(results)}
        layout={{ xaxis: { title: "Easting (m)" }, yaxis: { title: "Northing (m)", scaleanchor: "x" }, showlegend: false }}
        height={320}
      />
    </div>
  );
}
