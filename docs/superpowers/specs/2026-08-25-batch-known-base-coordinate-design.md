# Known Base Coordinate for Batch Jobs — Design

## Goal

Batch job submission (`POST /batches`) lets the user upload multiple base files but has no way to specify a known/fixed coordinate for any of them — unlike single-job submission, where `ConfigForm.tsx` already exposes `base_coord_mode` (`single` / `known-llh` / `known-xyz`) + a 3-number coordinate input, backed by `ProcessingConfig.base_coord_mode`/`base_coord` (`gnss_engine/models/config.py:60-80`) and rendered to RTKLIB's `ant2-postype`/`ant2-pos1..3` (`gnss_engine/conf/render.py:63-103`).

Add per-base known-coordinate support to batch submission, since each uploaded base file may be a distinct physical station with its own surveyed position.

## Scope decision: per-base, not per-batch

Coordinate is tied to the **physical base station identity** (which base file), not to the randomized sweep. Each base row in the batch upload gets its own coordinate — not one coordinate shared across all bases. This also means `SweepConfig` and `gnss_engine/sweep.py` are **out of scope**: `_draw_config()` keeps hardcoding `base_coord_mode=SINGLE, base_coord=None` for the randomized draw (`gnss_engine/sweep.py:42-43`), since a base's real-world position isn't a sweepable parameter. The known coordinate is applied as a **post-draw override**, per base, in the batch job-creation loop.

## Architecture

```
Frontend (per-base row: mode + coord inputs)
   -> buildBatchForm.ts: base_coords (JSON, order-matched to base files)
   -> POST /batches: base_coords: str | None = Form(None)
   -> parse + validate (length match, coord required when mode != single)
   -> for each base, for each drawn config:
        job_cfg = cfg.model_copy(update={base_coord_mode, base_coord})
        jobstore.write_config(job_id, job_cfg)
   -> bases_manifest entries record base_coord_mode/base_coord for audit
```

## Backend changes

**`api/schemas.py`** — new small model:
```python
class BaseCoordEntry(BaseModel):
    mode: BaseCoordMode = BaseCoordMode.SINGLE
    coord: tuple[float, float, float] | None = None
```

**`api/main.py`** `/batches` (`api/main.py:122-199`):
- Add `base_coords: str | None = Form(None)` — **optional**, not required. `tests/api/test_main.py` has ~30 existing calls to `POST /batches` that don't pass this field; making it required would break all of them for no reason. When omitted, default to one `BaseCoordEntry()` (mode `single`, coord `None`) per base file — identical to today's behavior and to the frontend's own per-row default (see Frontend changes below), so this is a pure backward-compatible addition.
- When provided, parse via `TypeAdapter(list[BaseCoordEntry]).validate_json(...)` (422 on parse failure, consistent with existing `sweep_config` handling at `main.py:137-140`).
- Validate `len(base_coords) == len(base)` — 422 `"base_coords length must match number of base files"` if not.
- Validate, per entry: if `mode != BaseCoordMode.SINGLE` then `coord is not None` — 422 `"base_coords[i]: coord is required when mode is not 'single'"` if not. (This closes a validation gap that already exists on `ProcessingConfig` for single-job submission, but only for this new field — not retrofitted onto the single-job endpoint, which is out of scope.)
- In the base loop (`main.py:172-187`), for each `(base_idx, bf)`, build `job_cfg = cfg.model_copy(update={"base_coord_mode": base_coords[base_idx].mode, "base_coord": base_coords[base_idx].coord})` and `jobstore.write_config(job_id, job_cfg)` instead of writing `cfg` directly.
- Add `"base_coord_mode"` / `"base_coord"` to each `bases_manifest` entry (`main.py:187`) for audit/display, mirroring how `filename` is already recorded.

No changes to `gnss_engine/models/config.py`, `gnss_engine/sweep.py`, or `gnss_engine/conf/render.py` — they already support everything needed once `ProcessingConfig.base_coord_mode`/`base_coord` are set correctly per job.

## Frontend changes

**`web/src/components/BatchFileUploads.tsx`**:
- Change `BatchFiles.bases` (currently `(File | null)[]` in `web/src/lib/buildBatchForm.ts:6`) to `BatchBaseEntry[]`:
  ```ts
  export interface BatchBaseEntry {
    file: File | null;
    base_coord_mode: BaseCoordMode;
    base_coord: [number, number, number] | null;
  }
  ```
  Default per row: `{ file: null, base_coord_mode: "single", base_coord: null }`.
- Each base row gets a mode `<select>` (`single` / `known-llh` / `known-xyz`) + 3 `<input type="number">` fields shown only when mode ≠ `single`, styled/structured like `ConfigForm.tsx:81-102` (default `[0,0,0]` when switching off `single`, cleared to `null` when switching back).

**`web/src/lib/buildBatchForm.ts`**:
- Update `BatchFiles.bases` type to `BatchBaseEntry[]`.
- Append one new field: `fd.append("base_coords", JSON.stringify(bases.map(b => ({ mode: b.base_coord_mode, coord: b.base_coord }))))`, order-matched to the `base` files already appended.

**`web/src/pages/NewJob.tsx`**: update initial `BatchFiles` state shape to match the new `bases: BatchBaseEntry[]`.

No changes to `web/src/components/SweepConfigForm.tsx` (unrelated — sweep ranges only).

## Validation & error handling

- Frontend: no client-side blocking validation beyond what the mode/coord UI naturally enforces (switching to a known mode always populates a default `[0,0,0]` coord, so `coord: null` with `mode != single` can't be produced by the UI itself) — but the 422 backend check stays as the authoritative boundary guard (e.g. future API clients, malformed manual requests).
- Backend 422s (length mismatch, missing coord) surface via the existing `HTTPException` pattern already used for `sweep_config`/`n_configs` validation in the same endpoint — no new error-handling mechanism.

## Testing

**Backend** (`tests/api/test_main.py`, reusing existing `_batch_files`/`_batch_data`/`client` fixtures):
1. Submitting a batch with 2 bases, different `base_coords` per base (e.g. base 0 = `single`, base 1 = `known-llh` with a coord) — assert each job's stored `ProcessingConfig` (`jobstore.read_config(job_id)`) has the `base_coord_mode`/`base_coord` matching its base, not the sweep-drawn default.
2. `base_coords` length mismatch vs `base` files count → 422.
3. A `base_coords` entry with `mode != single` and `coord: null` → 422.
4. `bases_manifest` (via `jobstore.read_batch_manifest`) contains the per-base `base_coord_mode`/`base_coord`.

**Frontend**:
- New `web/src/components/BatchFileUploads.test.tsx` (doesn't exist yet): mode select + coordinate inputs render/update per row, default `single` with no coord fields shown.
- Update any existing test fixtures constructing `BatchFiles`/`buildBatchForm` calls for the new `bases` shape.
- Run `cd web && npx tsc --noEmit && npx vitest run` for regressions.
