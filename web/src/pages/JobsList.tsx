import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { client } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function JobsList() {
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

  const isLoading = jobs.isLoading || batches.isLoading;
  const error = jobs.error || batches.error;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Jobs</h2>
        <Link to="/new" className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base hover:brightness-110">
          <Plus size={16} /> New Job
        </Link>
      </div>
      {isLoading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-red-400">Failed to load jobs.</p>}
      <div className="divide-y divide-hair rounded-lg border border-hair bg-panel">
        {(batches.data ?? []).map((b) => (
          <Link key={b.batch_id} to={`/batches/${b.batch_id}`} className="flex items-center justify-between px-4 py-3 hover:bg-white/5">
            <span className="tnum text-sm text-ink">{b.batch_id} <span className="text-muted">(batch)</span></span>
            <span className="flex items-center gap-2">
              <span className="tnum text-xs text-muted">{b.done} / {b.total}</span>
              <StatusBadge status={b.status} />
            </span>
          </Link>
        ))}
        {(jobs.data ?? []).map((j) => (
          <Link key={j.job_id} to={`/jobs/${j.job_id}`} className="flex items-center justify-between px-4 py-3 hover:bg-white/5">
            <span className="tnum text-sm text-ink">{j.job_id}</span>
            <StatusBadge status={j.status} />
          </Link>
        ))}
        {jobs.data && batches.data && jobs.data.length === 0 && batches.data.length === 0 && (
          <p className="px-4 py-6 text-center text-muted">No jobs yet.</p>
        )}
      </div>
    </div>
  );
}
