import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { BatchReportEntry } from "../api/types";
import { DistributionGrid } from "../components/charts/DistributionGrid";
import { BatchResultScatter } from "../components/charts/BatchResultScatter";
import { mean, range } from "../lib/stats";

function summarizeConfig(configIdx: number, config: Record<string, unknown>): string {
  const mode = config.mode ?? "—";
  const frequency = config.frequency ?? "—";
  const ambiguity = config.ambiguity ?? "—";
  const elev = config.elev_mask_deg;
  const elevStr = typeof elev === "number" ? `el${elev.toFixed(0)}°` : "el—";
  const ar = config.ar_ratio_min;
  const arStr = typeof ar === "number" ? `ar${ar.toFixed(1)}` : "ar—";
  return `#${configIdx}: ${mode} / ${frequency} / ${ambiguity} / ${elevStr} / ${arStr}`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hair px-3 py-2">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="tnum text-base">{value}</div>
    </div>
  );
}

function successfulNumeric(results: BatchReportEntry[], key: "utm_e" | "utm_n" | "mean_h"): number[] {
  return results
    .filter((r) => r.status !== "failed")
    .map((r) => r[key])
    .filter((v): v is number => typeof v === "number");
}

function computeCoordStats(results: BatchReportEntry[]) {
  const e = successfulNumeric(results, "utm_e");
  const n = successfulNumeric(results, "utm_n");
  const h = successfulNumeric(results, "mean_h");
  return {
    avgE: mean(e), avgN: mean(n), avgH: mean(h),
    rangeE: range(e), rangeN: range(n), rangeH: range(h),
    hasE: e.length > 0, hasN: n.length > 0, hasH: h.length > 0,
  };
}

function CoordStatTiles({ results }: { results: BatchReportEntry[] }) {
  const s = computeCoordStats(results);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile label="Avg easting" value={s.hasE ? `${s.avgE.toFixed(3)} m` : "—"} />
      <StatTile label="Avg northing" value={s.hasN ? `${s.avgN.toFixed(3)} m` : "—"} />
      <StatTile label="Avg height" value={s.hasH ? `${s.avgH.toFixed(3)} m` : "—"} />
      <StatTile label="Range easting" value={s.hasE ? `${s.rangeE.toFixed(3)} m` : "—"} />
      <StatTile label="Range northing" value={s.hasN ? `${s.rangeN.toFixed(3)} m` : "—"} />
      <StatTile label="Range height" value={s.hasH ? `${s.rangeH.toFixed(3)} m` : "—"} />
    </div>
  );
}

export function BatchDetail() {
  const { id = "" } = useParams();
  const status = useQuery({
    queryKey: ["batch", id],
    queryFn: () => client.getBatch(id),
    refetchInterval: (q) => (q.state.data?.status === "finished" ? false : 2000),
  });
  const finished = status.data?.status === "finished";
  const report = useQuery({
    queryKey: ["batch-report", id],
    queryFn: () => client.getBatchReport(id),
    enabled: finished,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleBase = (baseId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(baseId) ? next.delete(baseId) : next.add(baseId);
      return next;
    });
  const allResults = useMemo(() => (report.data ? report.data.bases.flatMap((b) => b.results) : []), [report.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="tnum text-base font-semibold">Batch {id}</h2>
        {status.data && <StatusBadge status={status.data.status} />}
        {status.data && (
          <span className="tnum text-sm text-muted">
            {status.data.done} / {status.data.total}
          </span>
        )}
      </div>

      {!finished && status.data && (
        <p className="text-muted">Processing… polling for completion.</p>
      )}

      {finished && report.isError && (
        <p className="text-sm text-red-400">Failed to load report.</p>
      )}

      {finished && report.data && (
        <div className="space-y-6">
          <div className="rounded-lg border border-hair bg-panel p-4">
            <h3 className="mb-2 text-sm font-semibold">All bases</h3>
            <CoordStatTiles results={allResults} />
            <div className="mt-3">
              <DistributionGrid results={allResults} />
            </div>
            <div className="mt-3">
              <BatchResultScatter results={allResults} />
            </div>
          </div>

          {report.data.bases.map((b) => {
            const isOpen = expanded.has(b.base_id);
            return (
              <div key={b.base_id} className="rounded-lg border border-hair bg-panel p-4">
                <button
                  type="button"
                  onClick={() => toggleBase(b.base_id)}
                  className="mb-2 flex w-full items-center gap-2 text-left"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <h3 className="text-sm font-semibold">{b.base_id}</h3>
                </button>
                <div className="mb-3">
                  <CoordStatTiles results={b.results} />
                </div>
                {isOpen && (
                  <div className="mb-3">
                    <DistributionGrid results={b.results} />
                  </div>
                )}
                {isOpen && (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-muted">
                        <th className="py-1 pr-2">Job</th>
                        <th className="py-1 pr-2">Config</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1 pr-2">Fix rate</th>
                        <th className="py-1 pr-2">RMS N/E/U</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.results.map((r) => (
                        <tr key={r.job_id} className="border-t border-hair hover:bg-white/5">
                          <td className="tnum py-1 pr-2">
                            <Link to={`/jobs/${r.job_id}`} className="hover:underline">
                              {r.job_id}
                            </Link>
                          </td>
                          <td className="py-1 pr-2 text-xs text-muted">{summarizeConfig(r.config_idx, r.config)}</td>
                          <td className="py-1 pr-2">
                            <StatusBadge status={r.status} />
                            {r.status === "failed" && (r.error_type || r.error_message) && (
                              <div className="mt-1 text-xs text-red-400">
                                {r.error_type && <span className="font-medium">{r.error_type}</span>}
                                {r.error_message && <div className="text-red-400/80">{r.error_message}</div>}
                              </div>
                            )}
                          </td>
                          <td className="tnum py-1 pr-2">{r.fix_rate_pct != null ? `${r.fix_rate_pct.toFixed(1)}%` : "—"}</td>
                          <td className="tnum py-1 pr-2">
                            {r.rms_sdn != null ? `${r.rms_sdn.toFixed(3)} / ${r.rms_sde!.toFixed(3)} / ${r.rms_sdu!.toFixed(3)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
