import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryTiles } from "../components/SummaryTiles";
import { TrackMap } from "../components/TrackMap";
import { ChartTabs } from "../components/ChartTabs";
import { Placeholder } from "../components/Placeholder";

export function JobDetail() {
  const { id = "" } = useParams();
  const status = useQuery({
    queryKey: ["job", id],
    queryFn: () => client.getJob(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "started" ? 2000 : false;
    },
  });
  const finished = status.data?.status === "finished";
  const result = useQuery({
    queryKey: ["result", id],
    queryFn: () => client.getResult(id),
    enabled: finished,
  });

  const arThreshold = Number((result.data?.config_used as any)?.ar_ratio_min ?? 3);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="tnum text-base font-semibold">Job {id}</h2>
        {status.data && <StatusBadge status={status.data.status} />}
        {result.data?.meta && (
          <span className="text-sm text-muted">
            {result.data.meta.rover_id} · v{result.data.meta.rinex_version} · {result.data.meta.interval_s ?? "—"}s · {result.data.meta.span_s ?? "—"}s span
          </span>
        )}
      </div>

      {(status.data?.status === "queued" || status.data?.status === "started") && (
        <p className="text-muted">Processing… polling for completion.</p>
      )}

      {status.data?.status === "failed" && status.data.error && (
        <div className="rounded-lg border border-red-500/40 bg-red-600/10 p-4 text-sm">
          <div className="font-medium text-red-400">{status.data.error.type}</div>
          <div className="mt-1 text-ink">{status.data.error.message}</div>
        </div>
      )}

      {finished && result.data && (
        <>
          <SummaryTiles solution={result.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TrackMap solution={result.data} />
            <ChartTabs solution={result.data} arThreshold={arThreshold} />
          </div>
          <div className="space-y-2">
            <Placeholder title="DOP (PDOP / HDOP / VDOP)" note="available after engine DOP support" />
            <Placeholder title="Multi-base comparison & constellation matrix" note="available after pipeline upgrade (sub-project 4)" />
          </div>
        </>
      )}
    </div>
  );
}
