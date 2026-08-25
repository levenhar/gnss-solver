import type { BaseCoordMode, SweepConfig } from "../api/types";

export interface BatchBaseEntry {
  file: File | null;
  base_coord_mode: BaseCoordMode;
  base_coord: [number, number, number] | null;
}

export interface BatchFiles {
  rover: File | null;
  nav: File[];
  bases: BatchBaseEntry[];
}

export function buildBatchForm(files: BatchFiles, sweepConfig: SweepConfig, nConfigs = 100, name?: string): FormData {
  const fd = new FormData();
  if (name && name.trim()) fd.append("name", name.trim());
  if (files.rover) fd.append("rover", files.rover);
  for (const n of files.nav) fd.append("nav", n);
  const validBases = files.bases.filter((b): b is BatchBaseEntry & { file: File } => b.file !== null);
  for (const b of validBases) fd.append("base", b.file);
  fd.append("n_configs", String(nConfigs));
  fd.append("sweep_config", JSON.stringify(sweepConfig));
  fd.append(
    "base_coords",
    JSON.stringify(validBases.map((b) => ({ mode: b.base_coord_mode, coord: b.base_coord })))
  );
  return fd;
}
