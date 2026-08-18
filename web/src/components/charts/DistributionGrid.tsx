import type { BatchReportEntry } from "../../api/types";
import { distributionData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

const METRICS: { key: keyof BatchReportEntry; title: string; color: string }[] = [
  { key: "fix_rate_pct", title: "fix rate (%)", color: "#38bdf8" },
  { key: "rms_sdn", title: "RMS N (m)", color: "#16a34a" },
  { key: "rms_sde", title: "RMS E (m)", color: "#eab308" },
  { key: "rms_sdu", title: "RMS U (m)", color: "#2563eb" },
];

export function DistributionGrid({ results }: { results: BatchReportEntry[] }) {
  const successful = results.filter((r) => r.status !== "failed");
  const byMetric = METRICS.map((m) => ({
    ...m,
    values: successful.map((r) => r[m.key]).filter((v): v is number => typeof v === "number"),
  }));

  if (byMetric.every((m) => m.values.length === 0)) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {byMetric.map((m) => (
        <div key={m.title} className="rounded-md border border-hair p-2">
          {m.values.length ? (
            <PlotlyChart
              data={distributionData(m.values, m.color)}
              layout={{ xaxis: { title: m.title }, yaxis: { title: "count" } }}
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
