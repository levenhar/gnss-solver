const STYLES: Record<string, { cls: string; dot: string; live?: boolean }> = {
  queued: { cls: "bg-white/[0.06] text-muted border-hairStrong", dot: "bg-faint" },
  started: { cls: "bg-accent/15 text-accent border-accent/30", dot: "bg-accent", live: true },
  finished: { cls: "bg-success/15 text-success border-success/30", dot: "bg-success" },
  failed: { cls: "bg-danger/15 text-danger border-danger/30", dot: "bg-danger" },
  not_found: { cls: "bg-white/[0.04] text-faint border-hair", dot: "bg-faint" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? STYLES.not_found;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${s.cls}`}>
      <span className={`relative flex h-1.5 w-1.5 rounded-full ${s.dot}`}>
        {s.live && (
          <span className={`absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full ${s.dot} opacity-75`} />
        )}
      </span>
      {status}
    </span>
  );
}
