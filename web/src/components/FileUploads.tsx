import type { JobFiles } from "../lib/buildJobForm";

export function FileUploads({ value, onChange }: { value: JobFiles; onChange: (v: JobFiles) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">
        <span className="mb-1 block text-muted">Rover (obs)</span>
        <input type="file" required onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted">Base (obs, optional)</span>
        <input type="file" onChange={(e) => onChange({ ...value, base: e.target.files?.[0] ?? null })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted">Navigation (1+)</span>
        <input type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </label>
    </div>
  );
}
