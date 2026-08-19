import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { selCls } from "./ui/inputStyles";

export function EditableName({
  name, id, onSave, className = "",
}: { name: string | null | undefined; id: string; onSave: (name: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          autoFocus
          role="textbox"
          className={`${selCls} w-auto py-1`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" aria-label="Save name" onClick={commit} className="text-success hover:brightness-110">
          <Check size={15} />
        </button>
        <button type="button" aria-label="Cancel rename" onClick={() => setEditing(false)} className="text-muted hover:text-ink">
          <X size={15} />
        </button>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{name ?? id}</span>
      <button
        type="button"
        aria-label="Rename"
        onClick={() => { setDraft(name ?? id); setEditing(true); }}
        className="text-faint transition-colors duration-150 hover:text-ink"
      >
        <Pencil size={13} />
      </button>
    </span>
  );
}
