import type { JobFiles } from "../lib/buildJobForm";

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

export function FileUploads({ value, onChange }: { value: JobFiles; onChange: (v: JobFiles) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <UploadSlot label="Rover (obs)">
        <input className={fileCls} type="file" required onChange={(e) => onChange({ ...value, rover: e.target.files?.[0] ?? null })} />
      </UploadSlot>
      <UploadSlot label="Base (obs, optional)">
        <input className={fileCls} type="file" onChange={(e) => onChange({ ...value, base: e.target.files?.[0] ?? null })} />
      </UploadSlot>
      <UploadSlot label="Navigation (1+)">
        <input className={fileCls} type="file" multiple onChange={(e) => onChange({ ...value, nav: Array.from(e.target.files ?? []) })} />
      </UploadSlot>
    </div>
  );
}
