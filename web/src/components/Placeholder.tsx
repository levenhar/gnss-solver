import { Lock } from "lucide-react";

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-hair bg-panel/40 px-4 py-3 text-sm">
      <Lock size={16} className="text-muted" />
      <span className="text-ink">{title}</span>
      <span className="text-muted">— {note}</span>
    </div>
  );
}
