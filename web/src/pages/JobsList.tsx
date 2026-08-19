import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Inbox, TriangleAlert, Trash2 } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { springSnappy } from "../components/ui/transitions";

function Row({ to, primary, secondary, right, delay, onDelete }: {
  to: string; primary: React.ReactNode; secondary?: React.ReactNode; right: React.ReactNode; delay: number;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSnappy, delay }}
      className="flex items-center justify-between px-4 py-3.5 transition-colors duration-150 hover:bg-white/[0.04]"
    >
      <Link to={to} className="group flex flex-1 items-center gap-2 text-sm text-ink">
        {primary}
        {secondary}
      </Link>
      <span className="flex items-center gap-3">
        {right}
        <button
          type="button"
          aria-label="Delete"
          onClick={onDelete}
          className="text-faint transition-colors duration-150 hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </span>
    </motion.div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

export function JobsList() {
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => client.listJobs(),
    refetchInterval: 5000,
  });
  const batches = useQuery({
    queryKey: ["batches"],
    queryFn: () => client.listBatches(),
    refetchInterval: 5000,
  });
  const deleteJob = useMutation({
    mutationFn: (id: string) => client.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const deleteBatch = useMutation({
    mutationFn: (id: string) => client.deleteBatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batches"] }),
  });

  const showSkeleton = (jobs.isLoading && !jobs.data) && (batches.isLoading && !batches.data);
  const isEmpty = jobs.data && batches.data && jobs.data.length === 0 && batches.data.length === 0;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Jobs</h1>
          <p className="mt-0.5 text-sm text-muted">Single solves and batch sweeps</p>
        </div>
        <Link
          to="/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accentInk
            shadow-elevated transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={16} strokeWidth={2.5} /> New Job
        </Link>
      </div>

      {jobs.error && batches.error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={15} /> Failed to load jobs and batches.
        </p>
      )}
      {jobs.error && !batches.error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-danger"><TriangleAlert size={15} /> Failed to load jobs.</p>
      )}
      {!jobs.error && batches.error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-danger"><TriangleAlert size={15} /> Failed to load batches.</p>
      )}

      <Card className="divide-y divide-hair overflow-hidden">
        {showSkeleton && (
          <>
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </>
        )}

        {!showSkeleton && (batches.data ?? []).map((b, i) => (
          <Row
            key={b.batch_id}
            to={`/batches/${b.batch_id}`}
            delay={i * 0.03}
            primary={<span className="tnum">{b.name ?? b.batch_id}</span>}
            secondary={<span className="text-muted">(batch)</span>}
            right={
              <>
                <span className="tnum text-xs text-muted">{b.done} / {b.total}</span>
                <StatusBadge status={b.status} />
              </>
            }
            onDelete={() => {
              if (window.confirm("Delete this batch? This cannot be undone.")) deleteBatch.mutate(b.batch_id);
            }}
          />
        ))}

        {!showSkeleton && (jobs.data ?? []).map((j, i) => (
          <Row
            key={j.job_id}
            to={`/jobs/${j.job_id}`}
            delay={((batches.data?.length ?? 0) + i) * 0.03}
            primary={<span className="tnum">{j.name ?? j.job_id}</span>}
            right={<StatusBadge status={j.status} />}
            onDelete={() => {
              if (window.confirm("Delete this job? This cannot be undone.")) deleteJob.mutate(j.job_id);
            }}
          />
        ))}

        {!showSkeleton && isEmpty && (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <Inbox size={28} className="text-faint" />
            <p className="text-sm text-muted">No jobs yet — start one to see results here.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
