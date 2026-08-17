const STYLES: Record<string, string> = {
  queued: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  started: "bg-accent/20 text-accent border-accent/40",
  finished: "bg-green-600/20 text-green-400 border-green-500/40",
  failed: "bg-red-600/20 text-red-400 border-red-500/40",
  not_found: "bg-slate-700/30 text-slate-400 border-slate-600/40",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.not_found;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}
