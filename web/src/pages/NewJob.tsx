import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_CONFIG, type ProcessingConfig } from "../api/types";
import { client } from "../api/client";
import { buildJobForm, type JobFiles } from "../lib/buildJobForm";
import { FileUploads } from "../components/FileUploads";
import { ConfigForm } from "../components/ConfigForm";

export function NewJob() {
  const nav = useNavigate();
  const [files, setFiles] = useState<JobFiles>({ rover: null, base: null, nav: [] });
  const [config, setConfig] = useState<ProcessingConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = !!files.rover && files.nav.length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await client.createJob(buildJobForm(files, config));
      nav(`/jobs/${res.job_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-base font-semibold">New Job</h2>
      <section className="rounded-lg border border-hair bg-panel p-4">
        <FileUploads value={files} onChange={setFiles} />
      </section>
      <section className="rounded-lg border border-hair bg-panel p-4">
        <ConfigForm value={config} onChange={setConfig} />
      </section>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={!canSubmit}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-40">
        {busy ? "Submitting…" : "Submit job"}
      </button>
    </form>
  );
}
