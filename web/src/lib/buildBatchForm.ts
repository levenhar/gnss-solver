import type { SweepConfig } from "../api/types";

export interface BatchFiles {
  rover: File | null;
  nav: File[];
  bases: (File | null)[];
}

export function buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs = 100): FormData {
  const fd = new FormData();
  if (files.rover) fd.append("rover", files.rover);
  for (const n of files.nav) fd.append("nav", n);
  for (const b of files.bases) if (b) fd.append("base", b);
  fd.append("n_configs", String(nConfigs));
  fd.append("sweep_config", JSON.stringify(sweepConfig));
  return fd;
}
