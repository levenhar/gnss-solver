import type { ProcessingConfig } from "../api/types";

export interface JobFiles {
  rover: File | null;
  base: File | null;
  nav: File[];
}

export function buildJobForm(files: JobFiles, config: ProcessingConfig, name?: string): FormData {
  const fd = new FormData();
  if (name && name.trim()) fd.append("name", name.trim());
  if (files.rover) fd.append("rover", files.rover);
  if (files.base) fd.append("base", files.base);
  for (const n of files.nav) fd.append("nav", n);
  const cfg: ProcessingConfig = { ...config };
  if (cfg.base_coord_mode === "single") cfg.base_coord = null;
  fd.append("config", JSON.stringify(cfg));
  return fd;
}
