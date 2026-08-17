import { useRef, useState } from "react";
import type { BatchFiles } from "../lib/buildBatchForm";

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
      <label className="text-sm">
        <span className="mb-1 block text-muted">Rover (obs)</span>
        <input type="file" onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted">Navigation (1+)</span>
        <input type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </label>
      <div className="text-sm sm:col-span-3">
        <span className="mb-1 block text-muted">Bases (1+)</span>
        <div className="space-y-2">
          {value.bases.map((_, i) => (
            <div key={rowIds[i]} className="flex items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">{`Base ${i + 1}`}</span>
                <input
                  aria-label={`Base ${i + 1}`}
                  type="file"
                  onChange={(e) => setBase(i, e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={() => removeBase(i)}
                className="rounded-md border border-hair px-2 py-1 text-xs text-muted"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addBase}
            className="rounded-md border border-hair px-2.5 py-1 text-xs text-muted"
          >
            + Add base
          </button>
        </div>
      </div>
    </div>
  );
}
