import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { BatchReportEntry } from "../api/types";
import { DistributionGrid } from "../components/charts/DistributionGrid";
import { BatchResultScatter } from "../components/charts/BatchResultScatter";
import { EditableName } from "../components/EditableName";
import { mean, range } from "../lib/stats";
import { Card } from "../components/ui/Card";
import { springSmooth, springSnappy } from "../components/ui/transitions";

function configElev(config: Record<string, unknown>): string {
  const elev = config.elev_mask_deg;
  return typeof elev === "number" ? `${elev.toFixed(0)}°` : "—";
}

function configAr(config: Record<string, unknown>): string {
  const ar = config.ar_ratio_min;
  return typeof ar === "number" ? ar.toFixed(1) : "—";
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hair bg-panel2/60 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="tnum mt-0.5 text-base font-semibold text-ink">{value}</div>
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
  const qc = useQueryClient();
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
  const rename = useMutation({
    mutationFn: (name: string) => client.renameBatch(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batch", id] }),
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="tnum text-xl font-semibold tracking-tight text-ink">
          <EditableName name={status.data?.name} id={id} onSave={(n) => rename.mutate(n)} />
        </h1>
        {status.data && <StatusBadge status={status.data.status} />}
        {status.data && (
          <span className="tnum text-sm text-muted">
            {status.data.done} / {status.data.total}
          </span>
        )}
      </div>

      {!finished && status.data && (
        <Card className="flex items-center gap-2.5 px-4 py-3.5 text-sm text-muted">
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none text-accent" />
          Processing… polling for completion.
        </Card>
      )}

      {finished && report.isError && (
        <p className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={15} /> Failed to load report.
        </p>
      )}

      {finished && report.data && (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">All bases</h2>
            <CoordStatTiles results={allResults} />
            <div className="mt-4">
              <DistributionGrid results={allResults} />
            </div>
            <div className="mt-3">
              <BatchResultScatter results={allResults} />
            </div>
          </Card>

          {report.data.bases.map((b, i) => {
            const isOpen = expanded.has(b.base_id);
            return (
              <Card key={b.base_id} delay={i * 0.03} className="overflow-hidden p-4">
                <button
                  type="button"
                  onClick={() => toggleBase(b.base_id)}
                  className="flex w-full items-center gap-2 text-left"
                  aria-expanded={isOpen}
                >
                  <motion.span
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={springSnappy}
                    className="flex text-muted"
                  >
                    <ChevronRight size={16} />
                  </motion.span>
                  <h3 className="text-sm font-semibold text-ink">{b.base_id}</h3>
                </button>
                <div className="mb-1 mt-3">
                  <CoordStatTiles results={b.results} />
                </div>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springSmooth}
                      className="overflow-hidden"
                    >
                      <div className="mb-3 mt-2">
                        <DistributionGrid results={b.results} />
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full table-fixed text-left text-sm">
                          <thead>
                            <tr className="border-b border-hair text-xs uppercase tracking-wide text-faint">
                              <th className="py-2 pr-2 font-medium">#</th>
                              <th className="py-2 pr-2 font-medium">Mode</th>
                              <th className="py-2 pr-2 font-medium">Frequency</th>
                              <th className="py-2 pr-2 font-medium">Ambiguity</th>
                              <th className="py-2 pr-2 font-medium">Elev mask</th>
                              <th className="py-2 pr-2 font-medium">AR min</th>
                              <th className="py-2 pr-2 font-medium">Fix rate</th>
                              <th className="py-2 pr-2 font-medium">Sats avg/min</th>
                              <th className="py-2 pr-2 font-medium">RMS N/E/U</th>
                              <th className="py-2 pr-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {b.results.map((r) => (
                              <tr key={r.job_id} className="border-t border-hair transition-colors duration-150 hover:bg-white/[0.04]">
                                <td className="tnum py-2 pr-2">
                                  <Link to={`/jobs/${r.job_id}`} title={r.job_id} className="text-accent hover:underline">
                                    #{r.config_idx}
                                  </Link>
                                </td>
                                <td className="py-2 pr-2 text-xs text-muted">{String(r.config.mode ?? "—")}</td>
                                <td className="py-2 pr-2 text-xs text-muted">{String(r.config.frequency ?? "—")}</td>
                                <td className="py-2 pr-2 text-xs text-muted">{String(r.config.ambiguity ?? "—")}</td>
                                <td className="tnum py-2 pr-2 text-xs text-muted">{configElev(r.config)}</td>
                                <td className="tnum py-2 pr-2 text-xs text-muted">{configAr(r.config)}</td>
                                <td className="tnum py-2 pr-2">{r.fix_rate_pct != null ? `${r.fix_rate_pct.toFixed(1)}%` : "—"}</td>
                                <td className="tnum py-2 pr-2">
                                  {r.mean_sats != null ? `${r.mean_sats.toFixed(1)} / ${r.min_sats ?? "—"}` : "—"}
                                </td>
                                <td className="tnum py-2 pr-2">
                                  {r.rms_sdn != null ? `${r.rms_sdn.toFixed(3)} / ${r.rms_sde!.toFixed(3)} / ${r.rms_sdu!.toFixed(3)}` : "—"}
                                </td>
                                <td className="py-2 pr-2">
                                  <StatusBadge status={r.status} />
                                  {r.status === "failed" && (r.error_type || r.error_message) && (
                                    <div className="mt-1 text-xs text-danger">
                                      {r.error_type && <span className="font-medium">{r.error_type}</span>}
                                      {r.error_message && (
                                        <div className="truncate text-danger/80" title={r.error_message}>
                                          {r.error_message}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
