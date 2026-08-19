import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { BatchFiles } from "../lib/buildBatchForm";

const fileCls =
  "block w-full text-xs text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 " +
  "file:bg-accent/15 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent " +
  "hover:file:bg-accent/25 file:transition-colors file:duration-150";

function UploadSlot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-xl border border-dashed border-hair bg-panel2/50 p-3 text-sm transition-colors duration-150 hover:border-hairStrong">
      <span className="mb-2 block font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function BatchFileUploads({ value, onChange }: { value: BatchFiles; onChange: (v: BatchFiles) => void }) {
  // Stable per-row ids, independent of array position, so React doesn't reuse/reconcile
  // the wrong DOM node (and its uncontrolled <input type="file"> display) when a row is
  // removed from the middle/start of the list.
  const nextRowId = useRef(value.bases.length);
  const [rowIds, setRowIds] = useState<number[]>(() => value.bases.map((_, i) => i));

  function setBase(i: number, f: File | null) {
    const bases = [...value.bases];
    bases[i] = f;
    onChange({ ...value, bases });
  }
  function addBase() {
    setRowIds([...rowIds, nextRowId.current++]);
    onChange({ ...value, bases: [...value.bases, null] });
  }
  function removeBase(i: number) {
    setRowIds(rowIds.filter((_, j) => j !== i));
    onChange({ ...value, bases: value.bases.filter((_, j) => j !== i) });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <UploadSlot label="Rover (obs)">
        <input className={fileCls} type="file" onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </UploadSlot>
      <UploadSlot label="Navigation (1+)">
        <input className={fileCls} type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </UploadSlot>
      <div className="text-sm sm:col-span-3">
        <span className="mb-2 block font-medium text-muted">Bases (1+)</span>
        <div className="space-y-2">
          {value.bases.map((_, i) => (
            <div key={rowIds[i]} className="flex items-center gap-2 rounded-xl border border-dashed border-hair bg-panel2/50 p-3 transition-colors duration-150 hover:border-hairStrong">
              <label className="flex-1">
                <span className="sr-only">{`Base ${i + 1}`}</span>
                <input
                  aria-label={`Base ${i + 1}`}
                  className={fileCls}
                  type="file"
                  onChange={(e) => setBase(i, e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={() => removeBase(i)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hair px-2.5 py-1.5 text-xs text-muted transition-colors duration-150 hover:border-danger/40 hover:text-danger"
              >
                <X size={13} /> Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addBase}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hair px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:border-hairStrong hover:text-ink"
          >
            + Add base
          </button>
        </div>
      </div>
    </div>
  );
}
