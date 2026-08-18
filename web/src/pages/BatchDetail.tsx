import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { BatchBaseReport } from "../api/types";

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

function computeOverallSummary(bases: BatchBaseReport[]) {
  const fixRates = bases.flatMap((b) => b.results.map((r) => r.fix_rate_pct).filter((v): v is number => v != null));
  const nFailed = bases.reduce((sum, b) => sum + b.summary.n_failed, 0);
  return {
    best: fixRates.length ? Math.max(...fixRates) : null,
    worst: fixRates.length ? Math.min(...fixRates) : null,
    mean: fixRates.length ? fixRates.reduce((a, v) => a + v, 0) / fixRates.length : null,
    nFailed,
  };
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
  const overall = useMemo(() => (report.data ? computeOverallSummary(report.data.bases) : null), [report.data]);

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

      {finished && report.data && overall && (
        <div className="space-y-6">
          <div className="rounded-lg border border-hair bg-panel p-4">
            <h3 className="mb-2 text-sm font-semibold">All bases</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Best fix rate" value={overall.best != null ? `${overall.best.toFixed(1)}%` : "—"} />
              <StatTile label="Worst fix rate" value={overall.worst != null ? `${overall.worst.toFixed(1)}%` : "—"} />
              <StatTile label="Mean fix rate" value={overall.mean != null ? `${overall.mean.toFixed(1)}%` : "—"} />
              <StatTile label="Failed runs" value={String(overall.nFailed)} />
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
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Best fix rate" value={b.summary.best_fix_rate_pct != null ? `${b.summary.best_fix_rate_pct.toFixed(1)}%` : "—"} />
                  <StatTile label="Worst fix rate" value={b.summary.worst_fix_rate_pct != null ? `${b.summary.worst_fix_rate_pct.toFixed(1)}%` : "—"} />
                  <StatTile label="Mean fix rate" value={b.summary.mean_fix_rate_pct != null ? `${b.summary.mean_fix_rate_pct.toFixed(1)}%` : "—"} />
                  <StatTile label="Failed runs" value={String(b.summary.n_failed)} />
                </div>
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
