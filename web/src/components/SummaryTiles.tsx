import type { Solution } from "../api/types";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hair bg-panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="tnum mt-1 text-lg text-ink">{value}</div>
    </div>
  );
}

export function SummaryTiles({ solution }: { solution: Solution }) {
  const s = solution.summary;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Fix rate" value={`${s.fix_rate_pct.toFixed(1)}%`} />
      <Tile label="Epochs" value={`${s.n_epochs}`} />
      <Tile label="σ N/E/U (m)" value={`${s.mean_sdn.toFixed(3)} / ${s.mean_sde.toFixed(3)} / ${s.mean_sdu.toFixed(3)}`} />
      <Tile label="Span" value={solution.meta.span_s != null ? `${solution.meta.span_s}s` : "—"} />
    </div>
  );
}
