# GNSS Solver — Web App & Config Explained

## What web app do

3 services (docker compose): `web` (React SPA, nginx, port 3000), `api` (FastAPI, port 8000), `worker` (RQ job processor), + `redis` (queue/broker). Data shared via `/data` volume.

Flow: user upload RINEX files + set config on web UI → API save files + enqueue job → worker pull job, run RTKLIB `rnx2rtkp` binary → parse output → write solution.json → web UI poll status, show map + charts when done.

Pages:
- **NewJob** (`/`) — upload files, set config, submit.
- **JobDetail** (`/jobs/:id`) — poll status, show result (map, charts, summary tiles) when finished.
- **JobsList** — list past jobs.

## Conf file settings (ProcessingConfig)

User set these in web form (`ConfigForm.tsx`) → sent as JSON → API validate (`ProcessingConfig` pydantic model) → rendered into RTKLIB `opts.conf` file (`gnss_engine/conf/render.py` + `template.conf`) → fed to `rnx2rtkp -k opts.conf`.

| Setting | Web label | RTKLIB key | Meaning |
|---|---|---|---|
| `mode` | Positioning mode | `pos1-posmode` | static / kinematic / movingbase / ppp-static / ppp-kinematic. How rover position estimated — static = fixed point, kinematic = moving receiver, ppp = precise point positioning (no base needed). |
| `constellations` | Constellations | `pos1-navsys` (bitmask) | Which GNSS systems to use: GPS, GLONASS, Galileo, BeiDou, QZSS, SBAS. More = more sats = better geometry but more noise. |
| `frequency` | Frequency | `pos1-frequency` | l1 / l1+l2 / l1+l2+l5. Dual/triple freq lets iono error be corrected (iono-free combo), improve accuracy, esp long baseline. |
| `elev_mask_deg` | Elevation mask | `pos1-elmask` | Ignore sats below this elevation angle (0–90°). Low sats have more multipath/atmo noise — raise mask to cut noise, lower to keep more sats. |
| `snr_mask_dbhz` | SNR mask | `pos1-snrmask_L1` (+ on/off flags) | Ignore signals weaker than this dBHz (0–60). Filter noisy/weak signal. |
| `tropo` | Troposphere | `pos1-tropopt` | off / saastamoinen / sbas / estimate-ztd / estimate-ztd-grad. How tropospheric delay corrected. Saastamoinen = standard model. Estimate = solve as extra unknown (better for long baseline, costs solve time). |
| `iono` | Ionosphere | `pos1-ionoopt` | off / broadcast / sbas / iono-free-lc / estimate-stec / ionex. How ionospheric delay corrected. iono-free-lc = combine L1/L2 to cancel iono (needs dual freq), best but noisier. |
| `ambiguity` | Ambiguity resolution | `pos2-armode` | off / continuous / instantaneous / fix-and-hold. Carrier-phase integer ambiguity resolution mode — controls fixing to get cm-level (RTK fix) vs float/single (sub-meter/meter). |
| `ar_ratio_min` | AR ratio min | `pos2-arthres` | Min ratio test threshold to accept integer ambiguity fix. Higher = stricter (fewer but more reliable fixes). |
| `ar_min_lock` | AR min lock count | `pos2-arlockcnt` | Min consecutive locked epochs before allow fix. Prevent fixing on fresh/unstable lock. |
| `ar_min_elev_deg` | AR min elevation | `pos2-arelmask` | Min elevation for sat to count toward ambiguity fix (separate from general elev mask). |
| `ephemeris` | Ephemeris | `pos1-sateph` | broadcast / precise. Satellite orbit/clock source. Precise = post-processed orbits, more accurate, needs precise eph files (not in this pipeline yet). |
| `base_coord_mode` | Base coordinate mode | `ant2-postype` | single / known-llh / known-xyz. Where base station coords come from: single = compute from base RINEX itself, known-* = user supply exact coords. |
| `base_coord` | (3 number inputs, shown if base_coord_mode ≠ single) | `ant2-pos1/2/3` | Lat/lon/height or X/Y/Z of base station, only used when mode is known-llh/known-xyz. |

Fixed (not exposed in UI, baked in template): `out-solformat=llh`, `out-outstat=residual`, `out-outhead/outopt=on`.

## What happen after press "Submit job"

1. **Frontend** (`NewJob.tsx` → `buildJobForm.ts`): build `multipart/form-data` — rover file, nav file(s), optional base file, `config` field = JSON string of `ProcessingConfig`. POST to `api.createJob` → `POST /jobs`.
2. **API** (`api/main.py: create_job`):
   - Parse+validate `config` JSON against `ProcessingConfig` schema → 422 if bad.
   - Require ≥1 nav file → 422 if missing.
   - Generate `job_id` (uuid4 hex).
   - Save uploaded files to `DATA_DIR/jobs/{job_id}/input/{rover,base,nav}/`.
   - Write `config.json` to job dir.
   - Enqueue RQ job `api.tasks.run_solve_job(job_id)` on Redis queue `"gnss"`, using `job_id` as RQ job id too.
   - Return `{job_id, status: "queued"}` (201). Frontend navigates to `/jobs/{job_id}`.
3. **Worker** (separate container, `worker/__main__.py`, RQ worker polling Redis) picks job up when free:
   - `run_solve_job` (`api/tasks.py`) read config + resolve input file paths, call `gnss_engine.solve()`.
   - `solve()` (`gnss_engine/engine.py`):
     a. decompress inputs if compressed (`.gz`/Hatanaka etc via `decompress_to`).
     b. `validate_inputs` — sanity-check rover/nav/base files.
     c. parse rover RINEX header → `DatasetMeta` (receiver, antenna, rinex version, time span…).
     d. render `opts.conf` from `ProcessingConfig` (the conf file, see table above).
     e. run RTKLIB `rnx2rtkp` binary as subprocess: `rnx2rtkp -k opts.conf -o solution.pos rover [base] nav...`. This is the actual GNSS solve — produce `solution.pos` (epoch-by-epoch position) + `solution.pos.stat` (per-satellite residuals/stats).
     f. parse `.pos` → list of `Epoch` (time, lat/lon/h, fix quality `q`, num sats, std-devs, AR ratio…).
     g. parse `.stat` → list of `SatStat` (per-sat az/el/snr/residuals/cycle-slip/fix flag).
     h. `summarize()` → `SolutionSummary` (fix rate %, RMS/mean of N/E/U std-dev, counts of fix/float/single epochs).
   - On success: write `solution.json` (full `Solution` object: meta, config_used, epochs, sat_stats, summary, engine_log) to job dir.
   - On failure (bad RINEX, RTKLIB crash, etc): catch exception, write `error.json` (`ErrorInfo`: type, message, workdir for debug), re-raise (RQ mark job `failed`).
4. **Frontend polling** (`JobDetail.tsx`, react-query): `GET /jobs/{id}` every 2s while status is `queued`/`started`. Status derive from RQ job state first, fall back to presence of `solution.json`/`error.json`/job dir (`api/main.py:_status`) — so status still resolvable even after RQ job record expire.
   - `finished` → fetch `GET /jobs/{id}/result` → full `Solution` JSON → render `SummaryTiles`, `TrackMap` (ground track), `ChartTabs` (height/time, AR ratio/time, residual histogram, sat count/time, sky plot).
   - `failed` → show error type + message from `error.json`.

Data persist on `/data` docker volume (`gnss-data`), survive container restart. Nothing auto-delete jobs — grow unbounded unless cleaned manually.
