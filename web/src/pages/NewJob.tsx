import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { DEFAULT_CONFIG, DEFAULT_SWEEP_CONFIG, type ProcessingConfig, type SweepConfig } from "../api/types";
import { client } from "../api/client";
import { buildJobForm, type JobFiles } from "../lib/buildJobForm";
import { buildBatchForm, type BatchFiles } from "../lib/buildBatchForm";
import { useTimeSyncCheck } from "../lib/useTimeSyncCheck";
import { FileUploads } from "../components/FileUploads";
import { BatchFileUploads } from "../components/BatchFileUploads";
import { ConfigForm } from "../components/ConfigForm";
import { SweepConfigForm } from "../components/SweepConfigForm";
import { Field } from "../components/Field";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { springSmooth } from "../components/ui/transitions";
import { selCls } from "../components/ui/inputStyles";

type Mode = "single" | "batch";
const MODES: { value: Mode; label: string }[] = [
  { value: "single", label: "Single config" },
  { value: "batch", label: "Batch: random sweep" },
];

export function NewJob() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("single");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<JobFiles>({ rover: null, base: null, nav: [] });
  const [batchFiles, setBatchFiles] = useState<BatchFiles>({
    rover: null,
    nav: [],
    bases: [{ file: null, base_coord_mode: "single", base_coord: null }],
  });
  const [config, setConfig] = useState<ProcessingConfig>(DEFAULT_CONFIG);
  const [sweepConfig, setSweepConfig] = useState<SweepConfig>(DEFAULT_SWEEP_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const singleTimeSync = useTimeSyncCheck(files.rover, [files.base], files.nav);
  const batchTimeSync = useTimeSyncCheck(batchFiles.rover, batchFiles.bases.map((b) => b.file), batchFiles.nav);
  const timeSync = mode === "single" ? singleTimeSync : batchTimeSync;

  const canSubmit =
    !busy &&
    timeSync.status !== "blocked" &&
    timeSync.status !== "checking" &&
    (mode === "single"
      ? !!files.rover && files.nav.length > 0
      : !!batchFiles.rover &&
        batchFiles.nav.length > 0 &&
        batchFiles.bases.length > 0 &&
        batchFiles.bases.every((b) => b.file !== null));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    console.log("[NewJob] submit start, mode=", mode);
    setError(null);
    setBusy(true);
    try {
      if (mode === "single") {
        const res = await client.createJob(buildJobForm(files, config, name));
        console.log("[NewJob] createJob resolved", res, "navigating to /jobs/" + res.job_id);
        nav(`/jobs/${res.job_id}`);
        console.log("[NewJob] nav() called");
      } else {
        const res = await client.createBatch(buildBatchForm(batchFiles, sweepConfig, 100, name));
        console.log("[NewJob] createBatch resolved", res, "navigating to /batches/" + res.batch_id);
        nav(`/batches/${res.batch_id}`);
        console.log("[NewJob] nav() called");
      }
    } catch (err) {
      console.error("[NewJob] submit failed", err);
      setError(err instanceof Error ? err.message : "submit failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">New Job</h1>
        <p className="mt-0.5 text-sm text-muted">Solve a single rover, or sweep configurations across bases.</p>
      </div>

      <Field label="Name (optional)">
        <input
          type="text"
          className={selCls}
          placeholder="e.g. Rooftop survey — north antenna"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className="inline-flex gap-0.5 rounded-xl border border-hair bg-panel2 p-1">
        {MODES.map((m) => (
          <label key={m.value} className="relative cursor-pointer select-none rounded-lg px-4 py-1.5 text-sm font-medium">
            <input
              type="radio"
              name="mode"
              className="peer sr-only"
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
            />
            {mode === m.value && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-lg bg-accent/15 ring-1 ring-accent/30"
                transition={springSmooth}
              />
            )}
            <span className={`relative ${mode === m.value ? "text-accent" : "text-muted peer-hover:text-ink"}`}>{m.label}</span>
          </label>
        ))}
      </div>

      <Card className="p-4">
        {mode === "single" ? <FileUploads value={files} onChange={setFiles} /> : <BatchFileUploads value={batchFiles} onChange={setBatchFiles} />}
      </Card>

      {timeSync.status === "checking" && (
        <p className="text-sm text-muted">Checking time sync between rover, base and navigation files…</p>
      )}
      {timeSync.status === "blocked" && (
        <div className="space-y-1 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert size={15} /> Time sync check failed
          </p>
          <ul className="ml-6 list-disc space-y-0.5">
            {timeSync.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <AnimatePresence initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={springSmooth}
        >
          {mode === "single" ? (
            <Card className="p-4">
              <ConfigForm value={config} onChange={setConfig} />
            </Card>
          ) : (
            <Card className="p-4">
              <p className="mb-4 text-sm text-muted">
                100 random configs will be generated per the bounds below and run against each base. Set a known
                coordinate on a base above if it's a surveyed station — otherwise its position is computed from the
                base file (single-solution mode).
              </p>
              <SweepConfigForm value={sweepConfig} onChange={setSweepConfig} />
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {error && (
        <p className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={15} /> {error}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit} busy={busy}>
        {busy ? "Submitting…" : "Submit job"}
      </Button>
    </form>
  );
}
