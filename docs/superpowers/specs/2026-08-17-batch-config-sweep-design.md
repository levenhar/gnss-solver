# Batch Config-Sweep — Design

## Purpose

Given fixed rover + nav files and one or more base files, run N (default 100) randomly generated `ProcessingConfig` variants against each base, and report ranked statistics per base so the user can see which config produces the best fix rate / precision for their data.

## Scope

- Random sweep generator for `ProcessingConfig`.
- New `BatchJob` concept: manifest tying together M bases × N configs = M×N individual solve jobs, reusing the existing single-job pipeline unchanged.
- API endpoints to submit a batch and fetch aggregate/ranked report.
- Frontend: batch toggle on `NewJob`, multi-base file input, batch rows merged into `JobsList`, new batch detail view with ranked table + summary stats per base.
- Explicitly out of scope this round: map view of batch results (skipped per user decision), grid/preset config generation modes (random sweep only), parallel/distributed execution changes to the worker (still one RQ job per solve, existing worker container consumes the queue — batch just enqueues M×N of them).

## Config sweep generator

New module `gnss_engine/config/sweep.py`:

```python
def random_sweep(n: int = 100, seed: int | None = None) -> list[ProcessingConfig]
```

Per generated config, independent uniform draws:
- `mode`: random `PositioningMode`
- `constellations`: GPS always included; each other constellation (GLO/GAL/BDS/QZSS/SBAS) included independently w/ 50% probability
- `frequency`: random `Frequency`
- `elev_mask_deg`: uniform 0.0–90.0
- `snr_mask_dbhz`: uniform 0.0–60.0
- `tropo`: random `TropoModel`
- `iono`: random `IonoModel`
- `ambiguity`: random `AmbiguityMode`
- `ar_ratio_min`: uniform 1.5–5.0
- `ar_min_lock`: random int 0–10
- `ar_min_elev_deg`: uniform 0.0–30.0
- `ephemeris`: random `EphemerisSource`
- `base_coord_mode`: fixed `SINGLE` (base position always derived from the uploaded base RINEX file itself — sweep never touches `base_coord_mode`/`base_coord`, since there's no per-config user-supplied coordinate to sweep over)

Same N configs generated once per batch submission and reused identically across every base, so results are comparable base-to-base for the same config index.

## Batch model & storage

`BatchManifest` (JSON, `DATA_DIR/batches/{batch_id}/manifest.json`):
```json
{
  "batch_id": "...",
  "created_at": "...",
  "n_configs": 100,
  "bases": [
    {"base_id": "base-0", "filename": "base1.obs", "jobs": ["job-id-0", "job-id-1", ...]}
  ]
}
```
Each `job_id` in the grid is a normal job dir under `DATA_DIR/jobs/{job_id}/` using the existing single-job pipeline verbatim (`config.json`, `input/`, `solution.json`/`error.json` on completion). Each job's `config.json` additionally carries `batch_id`, `base_id`, `config_idx` so the report endpoint can group/sort without re-reading the manifest for every field.

## API

- `POST /batches` — multipart form: `rover` (1 file), `nav` (1+ files), `base` (1+ files), optional `n_configs` (default 100, max 200). Validates like existing `create_job` (422 on bad config/missing nav), generates the sweep once, creates M×N job dirs + enqueues M×N `run_solve_job` RQ tasks, writes manifest. Returns `{batch_id, status: "queued", n_bases, n_configs}` (201).
- `GET /batches/{id}` — status aggregation: per-base `{done, total, failed}` counts derived the same way single-job status is derived (RQ state → fallback to solution.json/error.json presence), plus overall `{done, total}`. Batch-level status is `finished` once every child job reaches finished/failed, `running` otherwise.
- `GET /batches/{id}/report` — per base: `results` = list of `{job_id, config_idx, config: <flattened ProcessingConfig fields>, status, fix_rate_pct, rms_sdn, rms_sde, rms_sdu}` sorted by `fix_rate_pct` desc (failed jobs sorted to the bottom, `fix_rate_pct: null`), plus `summary: {best_job_id, best_fix_rate_pct, worst_fix_rate_pct, mean_fix_rate_pct, median_fix_rate_pct, n_failed}` computed only over finished (non-failed) jobs.

## Worker

No changes. `run_solve_job(job_id)` already operates on a single job id; batch submission just enqueues it M×N times. Existing RQ worker container drains the queue at whatever concurrency it already has.

## Frontend

- `NewJob.tsx`: add a "Single config / Batch: random sweep" radio toggle.
  - Single mode: unchanged (today's `ConfigForm` + single base file).
  - Batch mode: base file input becomes repeatable (`+ Add base` / remove-per-row, min 1), `ConfigForm` replaced by a static note explaining 100 random configs will be generated and base position is taken from each base file. Submit posts multipart to `POST /batches`, navigates to `/batches/{id}`.
- `JobsList`: fetches both `/jobs` and `/batches`, renders batch entries as rows with a progress bar (`done/total`) and status badge, expandable to show the per-base ranked table inline (reuses the report call) — no separate nav page.
- New route `/batches/:id` (`BatchDetail.tsx`): polls `GET /batches/{id}` every 2s while not finished; once finished, fetches `GET /batches/{id}/report` and renders one ranked table + summary tile block per base. Failed rows show error type/message inline. No map (explicitly out of scope).

## Error handling

- A base file that fails validation (bad RINEX) → all N jobs for that base fail fast at the existing `validate_inputs` step; other bases' jobs are unaffected.
- Batch never "fails" outright — it reaches `finished` once every child job is terminal, and the report/summary reflects per-base failure counts. This matches the existing per-job error model (`error.json` + typed `ErrorInfo`), just aggregated.
- `POST /batches` itself 422s the same way `POST /jobs` does today for structurally invalid uploads (no nav file, unparseable multipart) — sweep generation itself cannot fail (pure random draws from already-validated enum/range space).

## Testing

- `gnss_engine`: unit tests for `random_sweep` — correct count, all fields within valid ranges/enums, `base_coord_mode` always `SINGLE`, reproducible with a fixed seed.
- `api`: tests for `POST /batches` (creates M×N jobs + manifest), `GET /batches/{id}` (status aggregation across mixed finished/failed/queued children), `GET /batches/{id}/report` (ranking order, summary stats, failed-job handling) — mirroring existing job-endpoint test patterns/fixtures.
- `web`: component tests for the `NewJob` batch toggle (multi-base add/remove, correct multipart built) and `BatchDetail` (renders ranked table from a mocked report response, polling behavior) — mirroring existing `JobDetail`/`ConfigForm` test patterns.
