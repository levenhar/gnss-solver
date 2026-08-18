# User-Controlled Batch Sweep — Design

## Purpose

Today's `random_sweep()` (see [[2026-08-17-batch-config-sweep-design]]) draws every `ProcessingConfig` field fully at random across its whole domain, including `mode` and `constellations` — so results aren't comparable across positioning modes and constellation sets are unpredictable per job. The user wants control: pick one fixed `mode` for the whole batch, pick which constellations/frequencies/models are even candidates, and bound the numeric masks/AR params to a range they choose, instead of the engine's hardcoded defaults.

## Scope

- New `SweepConfig` model capturing user-chosen sweep bounds, replacing `random_sweep()`'s hardcoded ranges/pools/full-enum-randomization.
- `POST /batches` requires a `sweep_config` JSON field (multipart form), same pattern as `config` on `POST /jobs`.
- `NewJob.tsx` batch mode gets a real form (`SweepConfigForm`) instead of the static "100 random configs will be generated" note.
- Out of scope: `n_configs` UI control (stays a backend-default multipart field, unexposed in the form, as today), `snr_mask_dbhz` range control (const per user decision), `base_coord_mode`/`base_coord` sweep (unchanged — base position still always derived from the uploaded base file).

## `SweepConfig` model

New model in `gnss_engine/models/config.py`, alongside `ProcessingConfig`:

```python
class SweepConfig(BaseModel):
    mode: PositioningMode
    constellation_pool: list[Constellation] = [GLO, GAL, BDS, QZSS, SBAS]
    elev_mask_range: tuple[float, float] = (0.0, 90.0)
    ar_ratio_min_range: tuple[float, float] = (1.5, 5.0)
    ar_min_lock_range: tuple[int, int] = (0, 10)
    ar_min_elev_range: tuple[float, float] = (0.0, 30.0)
    snr_mask_dbhz: float = 15.0
    frequency_pool: list[Frequency] = [all Frequency values]
    tropo_pool: list[TropoModel] = [all TropoModel values]
    iono_pool: list[IonoModel] = [all IonoModel values]
    ambiguity_pool: list[AmbiguityMode] = [all AmbiguityMode values]
    ephemeris_pool: list[EphemerisSource] = [all EphemerisSource values]
```

Validators:
- Every `*_range` field: `min <= max`.
- `elev_mask_range` and `ar_min_elev_range`: both bounds within `[0.0, 90.0]` (same bound `ProcessingConfig._elev_range` already enforces on the single-config path).
- `ar_min_lock_range`: both bounds `>= 0`.
- Every `*_pool` field: non-empty.

`mode` has no default — every batch submission picks one explicitly; there is no "randomize mode" option anymore.

## `random_sweep()` rewrite

`gnss_engine/sweep.py`:

```python
def random_sweep(n: int, sweep: SweepConfig, seed: int | None = None) -> list[ProcessingConfig]
```

`sweep` is required (no default) — every caller must supply bounds. Per generated config:
- `mode`: const `sweep.mode` for every config in the batch.
- `constellations`: GPS always included (unconditionally, as today); each constellation in `sweep.constellation_pool` included independently w/ 50% probability. Constellations outside the pool never appear.
- `elev_mask_deg`: uniform within `sweep.elev_mask_range`.
- `ar_ratio_min`: uniform within `sweep.ar_ratio_min_range`.
- `ar_min_lock`: `rng.randint` within `sweep.ar_min_lock_range`.
- `ar_min_elev_deg`: uniform within `sweep.ar_min_elev_range`.
- `snr_mask_dbhz`: const `sweep.snr_mask_dbhz` (default 15.0) for every config — no longer drawn.
- `frequency` / `tropo` / `iono` / `ambiguity` / `ephemeris`: `rng.choice` from the corresponding `sweep.*_pool` instead of the full enum list.
- `base_coord_mode` / `base_coord`: unchanged (`SINGLE` / `None`).

Same N configs generated once per batch submission and reused across every base, as today.

## API

`POST /batches` gains a required `sweep_config: str = Form(...)` field (JSON-encoded `SweepConfig`), parsed with `SweepConfig.model_validate_json` and 422'd on `ValidationError` — mirrors how `config` is already handled on `POST /jobs`. `random_sweep(n=n_configs, sweep=sweep_config)` replaces the current no-arg call. Batch manifest gains a `"sweep_config"` key (`sweep_config.model_dump(mode="json")`) so the submitted bounds are recoverable for audit/report display. No other endpoint (`GET /batches/{id}`, `GET /batches/{id}/report`) changes — they operate on the already-materialized per-job configs, which are unaffected in shape.

## Frontend

- `web/src/api/types.ts`: add `SweepConfig` interface (mirrors the Python model) and `DEFAULT_SWEEP_CONFIG` (mode `static`, empty optional-constellation pool, ranges/pools matching the Python defaults above).
- New `web/src/components/SweepConfigForm.tsx`, parallel to `ConfigForm.tsx`:
  - **Mode**: single required `<select>` (same `MODES` list `ConfigForm` uses), defaults to `static`.
  - **Constellations**: toggle-button row like `ConfigForm`'s — GPS shown always-on and disabled (not part of the pool, forced by the engine); GLO/GAL/BDS/QZSS/SBAS toggle into `constellation_pool`.
  - **Elevation mask / AR ratio min / AR min lock / AR min elevation**: two number inputs each (min, max) replacing `ConfigForm`'s single slider/number field, with `min`/`max`/`step` HTML attributes matching each field's valid domain (0–90 for elevation fields, `min=0` for AR min lock).
  - **SNR mask**: single disabled number input showing the const value (`15`), labeled `SNR mask (fixed)` — communicates it isn't swept.
  - **Frequency / Troposphere / Ionosphere / Ambiguity resolution / Ephemeris**: toggle-button multiselect groups (same visual pattern as constellations), all options selected by default.
  - **Ephemeris pool note**: if `precise` is left selectable, no special handling needed here — same as today's single-config path, precise ephemeris files are a separate upload concern out of scope for this change.
- `NewJob.tsx`: batch-mode section renders `<SweepConfigForm value={sweepConfig} onChange={setSweepConfig} />` in place of the current static paragraph; `sweepConfig` state initialized from `DEFAULT_SWEEP_CONFIG`.
- `web/src/lib/buildBatchForm.ts`: `buildBatchForm(files, sweepConfig, nConfigs)` appends `fd.append("sweep_config", JSON.stringify(sweepConfig))`.
- Validation: HTML `min`/`max`/`step` on range inputs steers input at the UI layer; authoritative min≤max / non-empty-pool checks stay server-side (422 from `SweepConfig` validators), surfaced through `NewJob.tsx`'s existing `setError` catch block — no new client-side validation layer, matching the app's existing pattern of trusting server validation for structural correctness.

## Testing

- `tests/models/test_config.py`: `SweepConfig` validators — each `*_range` rejects `min > max`; `elev_mask_range`/`ar_min_elev_range` reject bounds outside `[0, 90]`; `ar_min_lock_range` rejects negative bounds; each `*_pool` rejects an empty list.
- `tests/test_sweep.py`: rewrite for the new `random_sweep(n, sweep, seed)` signature — `mode` const `== sweep.mode` across all n generated configs; constellations always `⊆ sweep.constellation_pool ∪ {GPS}` and GPS always present; `elev_mask_deg`/`ar_ratio_min`/`ar_min_lock`/`ar_min_elev_deg` always within their configured range; `snr_mask_dbhz` always `== sweep.snr_mask_dbhz`; `frequency`/`tropo`/`iono`/`ambiguity`/`ephemeris` always `∈` their configured pool; reproducible with a fixed seed (existing coverage, unchanged expectation).
- `tests/api/test_main.py`: update existing `/batches` tests to send `sweep_config`; add a case for malformed/invalid `sweep_config` → 422 (mirrors the existing invalid-`config` case on `/jobs`).
- `web/src/lib/buildBatchForm.test.ts`: update for the new `sweep_config` field and changed function signature.
- `web/src/pages/NewJob.test.tsx`: update batch-mode assertions to interact with `SweepConfigForm` instead of asserting the static note text.
