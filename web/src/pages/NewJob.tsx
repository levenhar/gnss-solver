import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_CONFIG, type ProcessingConfig } from "../api/types";
import { client } from "../api/client";
import { buildJobForm, type JobFiles } from "../lib/buildJobForm";
import { buildBatchForm, type BatchFiles } from "../lib/buildBatchForm";
import { FileUploads } from "../components/FileUploads";
import { BatchFileUploads } from "../components/BatchFileUploads";
import { ConfigForm } from "../components/ConfigForm";

export function NewJob() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [files, setFiles] = useState<JobFiles>({ rover: null, base: null, nav: [] });
  const [batchFiles, setBatchFiles] = useState<BatchFiles>({ rover: null, nav: [], bases: [null] });
  const [config, setConfig] = useState<ProcessingConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    !busy &&
    (mode === "single"
      ? !!files.rover && files.nav.length > 0
      : !!batchFiles.rover && batchFiles.nav.length > 0 && batchFiles.bases.length > 0 && batchFiles.bases.every(Boolean));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "single") {
        const res = await client.createJob(buildJobForm(files, config));
        nav(`/jobs/${res.job_id}`);
      } else {
        const res = await client.createBatch(buildBatchForm(batchFiles));
        nav(`/batches/${res.batch_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-base font-semibold">New Job</h2>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="mode" checked={mode === "single"} onChange={() => setMode("single")} />
          Single config
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="mode" checked={mode === "batch"} onChange={() => setMode("batch")} />
          Batch: random sweep
        </label>
      </div>
      <section className="rounded-lg border border-hair bg-panel p-4">
        {mode === "single" ? (
          <FileUploads value={files} onChange={setFiles} />
        ) : (
          <BatchFileUploads value={batchFiles} onChange={setBatchFiles} />
        )}
      </section>
      {mode === "single" ? (
        <section className="rounded-lg border border-hair bg-panel p-4">
          <ConfigForm value={config} onChange={setConfig} />
        </section>
      ) : (
        <section className="rounded-lg border border-hair bg-panel p-4 text-sm text-muted">
          100 random configs will be generated and run against each base. Base position is taken from each base file
          (single-solution mode) — no manual coordinates.
        </section>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-40"
      >
        {busy ? "Submitting…" : "Submit job"}
      </button>
    </form>
  );
}
