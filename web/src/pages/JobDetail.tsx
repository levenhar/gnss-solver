import { useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryTiles } from "../components/SummaryTiles";
import { TrackMap } from "../components/TrackMap";
import { ChartTabs } from "../components/ChartTabs";
import { Placeholder } from "../components/Placeholder";
import { EditableName } from "../components/EditableName";
import { Card } from "../components/ui/Card";

export function JobDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
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
  const rename = useMutation({
    mutationFn: (name: string) => client.renameJob(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", id] }),
  });

  const arThreshold = Number((result.data?.config_used as any)?.ar_ratio_min ?? 3);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="tnum text-xl font-semibold tracking-tight text-ink">
          <EditableName name={status.data?.name} id={id} onSave={(n) => rename.mutate(n)} />
        </h1>
        {status.data && <StatusBadge status={status.data.status} />}
        {result.data?.meta && (
          <span className="tnum text-sm text-muted">
            {result.data.meta.rover_id} · v{result.data.meta.rinex_version} · {result.data.meta.interval_s ?? "—"}s · {result.data.meta.span_s ?? "—"}s span
          </span>
        )}
      </div>

      {(status.data?.status === "queued" || status.data?.status === "started") && (
        <Card className="flex items-center gap-2.5 px-4 py-3.5 text-sm text-muted">
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none text-accent" />
          Processing… polling for completion.
        </Card>
      )}

      {status.data?.status === "failed" && status.data.error && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <div className="font-medium text-danger">{status.data.error.type}</div>
          <div className="mt-1 text-ink/90">{status.data.error.message}</div>
        </div>
      )}

      {finished && result.data && (
        <>
          <SummaryTiles solution={result.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden p-3">
              <TrackMap solution={result.data} />
            </Card>
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
