import { Lock } from "lucide-react";

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-hair bg-panel/30 px-4 py-3 text-sm">
      <Lock size={15} className="shrink-0 text-faint" />
      <span className="text-ink/80">{title}</span>
      <span className="text-faint">— {note}</span>
    </div>
  );
}
