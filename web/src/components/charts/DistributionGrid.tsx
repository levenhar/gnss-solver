import type { BatchReportEntry } from "../../api/types";
import { distributionData } from "../../lib/chartData";
import { mean, stdDev } from "../../lib/stats";
import { PlotlyChart } from "./PlotlyChart";

const METRICS: { key: keyof BatchReportEntry; title: string; color: string; decimals: number }[] = [
  { key: "utm_e", title: "easting (m)", color: "#16a34a", decimals: 3 },
  { key: "utm_n", title: "northing (m)", color: "#eab308", decimals: 3 },
  { key: "mean_h", title: "height (m)", color: "#2563eb", decimals: 3 },
];

export function DistributionGrid({ results }: { results: BatchReportEntry[] }) {
  const successful = results.filter((r) => r.status !== "failed");
  const byMetric = METRICS.map((m) => ({
    ...m,
    values: successful.map((r) => r[m.key]).filter((v): v is number => typeof v === "number"),
  }));

  if (byMetric.every((m) => m.values.length === 0)) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {byMetric.map((m) => (
        <div key={m.title} className="rounded-md border border-hair p-2">
          <div className="mb-1 text-xs text-muted">
            {m.title.toUpperCase()}
            {m.values.length > 0 &&
              ` · μ ${mean(m.values).toFixed(m.decimals)} · σ ${stdDev(m.values).toFixed(m.decimals)}`}
          </div>
          {m.values.length ? (
            <PlotlyChart
              data={distributionData(m.values, m.color)}
              layout={{ yaxis: { title: "count" } }}
              height={220}
            />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted">no data</div>
          )}
        </div>
      ))}
    </div>
  );
}
