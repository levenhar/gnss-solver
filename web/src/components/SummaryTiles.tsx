import type { Solution } from "../api/types";
import { Card } from "./ui/Card";

function Tile({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <Card delay={delay} className="px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="tnum mt-1 text-xl font-semibold text-ink">{value}</div>
    </Card>
  );
}

export function SummaryTiles({ solution }: { solution: Solution }) {
  const s = solution.summary;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Fix rate" value={`${s.fix_rate_pct.toFixed(1)}%`} delay={0} />
      <Tile label="Epochs" value={`${s.n_epochs}`} delay={0.03} />
      <Tile label="σ N/E/U (m)" value={`${s.mean_sdn.toFixed(3)} / ${s.mean_sde.toFixed(3)} / ${s.mean_sdu.toFixed(3)}`} delay={0.06} />
      <Tile label="Span" value={solution.meta.span_s != null ? `${solution.meta.span_s}s` : "—"} delay={0.09} />
    </div>
  );
}
