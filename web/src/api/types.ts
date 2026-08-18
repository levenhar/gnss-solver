export type PositioningMode = "static" | "kinematic" | "movingbase" | "ppp-static" | "ppp-kinematic";
export type Constellation = "GPS" | "GLO" | "GAL" | "BDS" | "QZSS" | "SBAS";
export type Frequency = "l1" | "l1+l2" | "l1+l2+l5";
export type TropoModel = "off" | "saastamoinen" | "sbas" | "estimate-ztd" | "estimate-ztd-grad";
export type IonoModel = "off" | "broadcast" | "sbas" | "iono-free-lc" | "estimate-stec" | "ionex";
export type AmbiguityMode = "off" | "continuous" | "instantaneous" | "fix-and-hold";
export type EphemerisSource = "broadcast" | "precise";
export type BaseCoordMode = "known-llh" | "known-xyz" | "single";

export interface ProcessingConfig {
  mode: PositioningMode;
  constellations: Constellation[];
  frequency: Frequency;
  elev_mask_deg: number;
  snr_mask_dbhz: number;
  tropo: TropoModel;
  iono: IonoModel;
  ambiguity: AmbiguityMode;
  ar_ratio_min: number;
  ar_min_lock: number;
  ar_min_elev_deg: number;
  ephemeris: EphemerisSource;
  base_coord_mode: BaseCoordMode;
  base_coord: [number, number, number] | null;
}

export interface Epoch {
  t: string; lat: number; lon: number; h: number; q: number; ns: number;
  sdn: number; sde: number; sdu: number; sdne: number; age: number; ratio: number;
  x: number | null; y: number | null; z: number | null;
}
export interface SatStat {
  t: string; sat: string; az: number; el: number; snr: number;
  res_p: number; res_c: number; slip: boolean; fix: number;
}
export interface DatasetMeta {
  rinex_version: string; file_type: string; interval_s: number | null;
  t_start: string | null; t_end: string | null; span_s: number | null;
  receiver: string | null; antenna: string | null; rover_id: string | null; base_id: string | null;
}
export interface SolutionSummary {
  n_epochs: number; n_fix: number; n_float: number; n_single: number; fix_rate_pct: number;
  mean_sdn: number; mean_sde: number; mean_sdu: number; rms_sdn: number; rms_sde: number; rms_sdu: number;
}
export interface Solution {
  meta: DatasetMeta; config_used: Record<string, unknown>;
  epochs: Epoch[]; sat_stats: SatStat[]; summary: SolutionSummary; engine_log: string;
}

export type JobStatusValue = "queued" | "started" | "finished" | "failed" | "not_found";
export interface JobCreated { job_id: string; status: string; }
export interface JobListItem { job_id: string; status: string; }
export interface ErrorInfo { type: string; message: string; workdir: string | null; }
export interface JobStatus { job_id: string; status: JobStatusValue; error: ErrorInfo | null; }

export interface BatchCreated {
  batch_id: string;
  status: string;
  n_bases: number;
  n_configs: number;
}

export interface BatchListItem {
  batch_id: string;
  status: string;
  done: number;
  total: number;
}

export interface BatchBaseStatus {
  base_id: string;
  done: number;
  total: number;
  failed: number;
}

export interface BatchStatus {
  batch_id: string;
  status: string;
  bases: BatchBaseStatus[];
  done: number;
  total: number;
}

export interface BatchReportEntry {
  job_id: string;
  config_idx: number;
  config: Record<string, unknown>;
  status: string;
  fix_rate_pct: number | null;
  rms_sdn: number | null;
  rms_sde: number | null;
  rms_sdu: number | null;
  utm_e: number | null;
  utm_n: number | null;
  mean_h: number | null;
  error_type: string | null;
  error_message: string | null;
}

export interface BatchReportSummary {
  best_job_id: string | null;
  best_fix_rate_pct: number | null;
  worst_fix_rate_pct: number | null;
  mean_fix_rate_pct: number | null;
  median_fix_rate_pct: number | null;
  n_failed: number;
}

export interface BatchBaseReport {
  base_id: string;
  results: BatchReportEntry[];
  summary: BatchReportSummary;
}

export interface BatchReport {
  batch_id: string;
  bases: BatchBaseReport[];
}

export const DEFAULT_CONFIG: ProcessingConfig = {
  mode: "static", constellations: ["GPS"], frequency: "l1+l2",
  elev_mask_deg: 15, snr_mask_dbhz: 35, tropo: "saastamoinen", iono: "broadcast",
  ambiguity: "continuous", ar_ratio_min: 3, ar_min_lock: 0, ar_min_elev_deg: 0,
  ephemeris: "broadcast", base_coord_mode: "single", base_coord: null,
};

export interface SweepConfig {
  mode: PositioningMode;
  constellation_pool: Constellation[];
  elev_mask_range: [number, number];
  ar_ratio_min_range: [number, number];
  ar_min_lock_range: [number, number];
  ar_min_elev_range: [number, number];
  snr_mask_dbhz: number;
  frequency_pool: Frequency[];
  tropo_pool: TropoModel[];
  iono_pool: IonoModel[];
  ambiguity_pool: AmbiguityMode[];
  ephemeris_pool: EphemerisSource[];
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  mode: "static",
  constellation_pool: ["GLO", "GAL", "BDS", "QZSS", "SBAS"],
  elev_mask_range: [0, 90],
  ar_ratio_min_range: [1.5, 5],
  ar_min_lock_range: [0, 10],
  ar_min_elev_range: [0, 30],
  snr_mask_dbhz: 15,
  frequency_pool: ["l1", "l1+l2", "l1+l2+l5"],
  tropo_pool: ["off", "saastamoinen", "sbas", "estimate-ztd", "estimate-ztd-grad"],
  iono_pool: ["off", "broadcast", "sbas", "iono-free-lc", "estimate-stec", "ionex"],
  ambiguity_pool: ["off", "continuous", "instantaneous", "fix-and-hold"],
  ephemeris_pool: ["broadcast", "precise"],
};
